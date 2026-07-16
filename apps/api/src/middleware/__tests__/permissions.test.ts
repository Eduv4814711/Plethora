import { describe, it, expect, vi, afterEach } from "vitest";
import * as userAccessService from "../../services/user-access.service.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import type { UserAccessRecord } from "../../services/user-access.service.js";
import { accessMiddleware } from "../permissions.js";
import type { FastifyReply, FastifyRequest } from "fastify";

const { hasPermission, hasAnyPermission } = userAccessService;

function access(permissions: string[], isSystemOwner = false): UserAccessRecord {
  return {
    userId: "u1",
    companyId: "c1",
    accessVersion: 1,
    adminClass: isSystemOwner ? "SYSTEM_ADMIN" : "STANDARD",
    isSystemOwner,
    permissions: new Set(permissions),
    scopes: new Map(),
  };
}

function mockReply() {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply & { code: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

describe("permission helpers", () => {
  it("system owner has all permissions", () => {
    expect(hasPermission(access([], true), PERMISSIONS.PAYROLL_EXPORT)).toBe(true);
  });

  it("checks explicit permission", () => {
    const a = access([PERMISSIONS.EMPLOYEES_READ_OPERATIONAL]);
    expect(hasPermission(a, PERMISSIONS.EMPLOYEES_READ_OPERATIONAL)).toBe(true);
    expect(hasPermission(a, PERMISSIONS.COMPENSATION_READ)).toBe(false);
  });

  it("hasAnyPermission", () => {
    const a = access([PERMISSIONS.PAYROLL_STATUS_READ]);
    expect(
      hasAnyPermission(a, [PERMISSIONS.PAYROLL_RUN_READ, PERMISSIONS.PAYROLL_STATUS_READ])
    ).toBe(true);
  });
});

describe("accessMiddleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects stale accessVersion with ACCESS_STALE", async () => {
    const request = {
      user: { sub: "u-stale", companyId: "c1", accessVersion: 1 },
    } as FastifyRequest;
    const reply = mockReply();

    vi.spyOn(userAccessService, "getUserAccessCached").mockResolvedValue({
      userId: "u-stale",
      companyId: "c1",
      accessVersion: 2,
      adminClass: "STANDARD",
      isSystemOwner: false,
      permissions: new Set(),
      scopes: new Map(),
    });

    await accessMiddleware(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ACCESS_STALE" })
    );
  });
});
