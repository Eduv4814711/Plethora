import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";

const getUserAccessCached = vi.fn();
const createPlatformAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("../../services/user-access.service.js", () => ({ getUserAccessCached }));
vi.mock("../../lib/audit.js", () => ({
  auditContextFromRequest: () => ({ requestId: "request-1", source: "api" }),
  createPlatformAuditEvent,
}));

const { platformAccessMiddleware } = await import("../platform-auth.js");

function request(): FastifyRequest {
  return { method: "GET", routeOptions: { url: "/platform/companies" }, user: { sub: "user-1", email: "a@example.com", companyId: "company-1", role: "admin", accessVersion: 2 } } as FastifyRequest;
}

function reply() {
  const value = { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
  return value as unknown as FastifyReply & typeof value;
}

function access(adminClass: "STANDARD" | "SYSTEM_ADMIN" | "ROOT_ADMIN", disabledAt: Date | null = null) {
  return { userId: "user-1", companyId: "company-1", accessVersion: 2, adminClass, isSystemOwner: false,
    permissions: new Set<string>(), scopes: new Map(), disabledAt };
}

describe("platform access boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows an active root administrator", async () => {
    getUserAccessCached.mockResolvedValue(access("ROOT_ADMIN"));
    const req = request(); const res = reply();
    await platformAccessMiddleware(req, res);
    expect(req.access?.adminClass).toBe("ROOT_ADMIN");
    expect(res.code).not.toHaveBeenCalled();
  });

  it("denies and audits a tenant administrator", async () => {
    getUserAccessCached.mockResolvedValue(access("SYSTEM_ADMIN"));
    const req = request(); const res = reply();
    await platformAccessMiddleware(req, res);
    expect(res.code).toHaveBeenCalledWith(403);
    expect(createPlatformAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "authorization.platform_access_denied", result: "denied" }));
  });

  it("rejects a disabled root account", async () => {
    getUserAccessCached.mockResolvedValue(access("ROOT_ADMIN", new Date()));
    const res = reply();
    await platformAccessMiddleware(request(), res);
    expect(res.code).toHaveBeenCalledWith(401);
  });
});
