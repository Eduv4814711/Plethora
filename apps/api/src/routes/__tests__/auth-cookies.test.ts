import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  REFRESH_COOKIE_NAME,
} from "../../lib/auth-cookies.js";

const loginMock = vi.fn();
const refreshAccessTokenMock = vi.fn();
const logoutUserMock = vi.fn();
const issueTokensForUserMock = vi.fn();

vi.mock("../../services/auth.service.js", () => ({
  login: (...args: unknown[]) => loginMock(...args),
  refreshAccessToken: (...args: unknown[]) => refreshAccessTokenMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  issueTokensForUser: (...args: unknown[]) => issueTokensForUserMock(...args),
  hashPassword: vi.fn(),
  hashPasswordSetupToken: vi.fn(),
}));

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    user: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../../lib/user-access.js", () => ({
  findUniqueUserForMe: vi.fn(),
}));

vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: async (request: { user?: { sub: string } }) => {
    request.user = { sub: "user-1" };
  },
}));

const mockAuthResult = {
  user: {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    companyId: "co-1",
    accountType: "staff" as const,
    jobTitle: null,
    isActive: true,
    isOwner: true,
    capabilities: {},
  },
  accessToken: "access.jwt.token",
  refreshToken: "refresh.jwt.token",
  expiresIn: 900,
};

function parseSetCookies(header: string | string[] | undefined): Record<string, string> {
  const lines = Array.isArray(header) ? header : header ? [header] : [];
  const out: Record<string, string> = {};
  for (const line of lines) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) {
      out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }
  return out;
}

async function buildTestApp(): Promise<FastifyInstance> {
  const { authRoutes } = await import("../auth.js");
  const app = Fastify();
  await app.register(cookie);
  await app.register(authRoutes, { prefix: "/auth" });
  return app;
}

describe("auth refresh cookie flow", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    loginMock.mockResolvedValue({ ...mockAuthResult });
    refreshAccessTokenMock.mockResolvedValue({
      ...mockAuthResult,
      accessToken: "access.rotated",
      refreshToken: "refresh.rotated",
    });
    logoutUserMock.mockResolvedValue(undefined);
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("login sets HttpOnly refresh cookie and omits refreshToken from JSON", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "test@example.com", password: "secret" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { accessToken: string; refreshToken?: string };
    expect(body.accessToken).toBe("access.jwt.token");
    expect(body.refreshToken).toBeUndefined();

    const cookies = parseSetCookies(res.headers["set-cookie"]);
    expect(cookies[REFRESH_COOKIE_NAME]).toBe("refresh.jwt.token");
    expect(cookies[CSRF_COOKIE_NAME]).toBeTruthy();
    expect(String(res.headers["set-cookie"])).toContain("HttpOnly");
  });

  it("refresh rotates token when cookie and CSRF header are valid", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "test@example.com", password: "secret" },
    });
    const loginCookies = parseSetCookies(loginRes.headers["set-cookie"]);

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        cookie: `${REFRESH_COOKIE_NAME}=${loginCookies[REFRESH_COOKIE_NAME]}; ${CSRF_COOKIE_NAME}=${loginCookies[CSRF_COOKIE_NAME]}`,
        [CSRF_HEADER_NAME]: loginCookies[CSRF_COOKIE_NAME],
      },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(refreshAccessTokenMock).toHaveBeenCalledWith("refresh.jwt.token", expect.any(Object));
    const body = res.json() as { accessToken: string; refreshToken?: string };
    expect(body.accessToken).toBe("access.rotated");
    expect(body.refreshToken).toBeUndefined();

    const cookies = parseSetCookies(res.headers["set-cookie"]);
    expect(cookies[REFRESH_COOKIE_NAME]).toBe("refresh.rotated");
  });

  it("refresh accepts legacy body token without CSRF (one-time migration)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: "legacy.refresh.token" },
    });

    expect(res.statusCode).toBe(200);
    expect(refreshAccessTokenMock).toHaveBeenCalledWith("legacy.refresh.token", expect.any(Object));
  });

  it("refresh fails without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("refresh fails when refresh cookie present but CSRF is invalid", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        cookie: `${REFRESH_COOKIE_NAME}=refresh.jwt.token; ${CSRF_COOKIE_NAME}=csrf-token`,
        [CSRF_HEADER_NAME]: "wrong-token",
      },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("refresh fails for invalid refresh token and clears cookies", async () => {
    refreshAccessTokenMock.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: "invalid.token" },
    });

    expect(res.statusCode).toBe(401);
    expect(String(res.headers["set-cookie"] ?? "")).toMatch(/Max-Age=0|Expires=/i);
  });

  it("logout revokes token and clears auth cookies", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "test@example.com", password: "secret" },
    });
    const loginCookies = parseSetCookies(loginRes.headers["set-cookie"]);

    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        authorization: "Bearer access.jwt.token",
        cookie: `${REFRESH_COOKIE_NAME}=${loginCookies[REFRESH_COOKIE_NAME]}; ${CSRF_COOKIE_NAME}=${loginCookies[CSRF_COOKIE_NAME]}`,
        [CSRF_HEADER_NAME]: loginCookies[CSRF_COOKIE_NAME],
      },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(logoutUserMock).toHaveBeenCalledWith("user-1", "refresh.jwt.token");
    expect(String(res.headers["set-cookie"] ?? "")).toMatch(/Max-Age=0|Expires=/i);
  });
});
