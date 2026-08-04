import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireCrudCapability, __resetDenialDedupe } from "../authorization.js";

vi.mock("../../lib/audit.js", () => ({
  auditFromRequest: vi.fn(async () => {}),
}));

function requestWithAccess(capabilities: unknown, method: string) {
  return {
    user: { sub: "u1", companyId: "c1", isOwner: false, isActive: true, capabilities },
    method,
    url: "/leave",
    headers: {},
    log: { error: vi.fn(), warn: vi.fn() },
  } as unknown as FastifyRequest;
}

function replyDouble() {
  const send = vi.fn();
  const code = vi.fn(() => ({ send }));
  return { reply: { code } as unknown as FastifyReply, code };
}

// Leave is its own grantable module. Neither Team nor Payroll reaches it.
const protectLeave = requireCrudCapability({ module: "/employees/leave" });

describe("leave capability access", () => {
  it("does not grant leave through the parent Team module", async () => {
    __resetDenialDedupe();
    const result = replyDouble();
    await protectLeave(requestWithAccess({ "/employees": ["create"] }, "POST"), result.reply);
    expect(result.code).toHaveBeenCalledWith(403);
  });

  it("does not grant leave through Payroll", async () => {
    __resetDenialDedupe();
    const result = replyDouble();
    await protectLeave(
      requestWithAccess({ "/payroll": ["view", "create", "approve"] }, "POST"),
      result.reply
    );
    expect(result.code).toHaveBeenCalledWith(403);
  });

  it("grants leave only on an explicit leave assignment", async () => {
    __resetDenialDedupe();
    const result = replyDouble();
    await protectLeave(requestWithAccess({ "/employees/leave": ["create"] }, "POST"), result.reply);
    expect(result.code).not.toHaveBeenCalled();
  });

  it("allows view but rejects mutation when only view is granted", async () => {
    __resetDenialDedupe();
    const read = replyDouble();
    await protectLeave(requestWithAccess({ "/employees/leave": ["view"] }, "GET"), read.reply);
    expect(read.code).not.toHaveBeenCalled();

    const write = replyDouble();
    await protectLeave(requestWithAccess({ "/employees/leave": ["view"] }, "POST"), write.reply);
    expect(write.code).toHaveBeenCalledWith(403);
  });
});
