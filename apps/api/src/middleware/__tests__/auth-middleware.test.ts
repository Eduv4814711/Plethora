import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

import { authMiddleware } from "../auth.js";
import { config } from "../../lib/config.js";

function requestWithToken(token?: string) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as FastifyRequest;
}

function replyDouble() {
  const send = vi.fn();
  const code = vi.fn(() => ({ send }));
  return { reply: { code } as unknown as FastifyReply, code, send };
}

describe("authMiddleware", () => {
  it("rejects a refresh token presented as an access token", async () => {
    const refreshShapedToken = jwt.sign(
      { sub: "user-1", email: "user@test.local", companyId: "co-1", type: "refresh" },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );
    const result = replyDouble();

    await authMiddleware(requestWithToken(refreshShapedToken), result.reply);

    expect(result.code).toHaveBeenCalledWith(401);
    expect(result.send).toHaveBeenCalledWith({
      error: "Unauthorized",
      message: "Invalid or expired token",
    });
  });

  it("rejects a request with no token", async () => {
    const result = replyDouble();

    await authMiddleware(requestWithToken(), result.reply);

    expect(result.code).toHaveBeenCalledWith(401);
  });
});
