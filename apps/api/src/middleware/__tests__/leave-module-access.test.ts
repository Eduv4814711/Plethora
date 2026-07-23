import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireRole } from "../rbac.js";

function requestWithAccess(role: "admin" | "hr_payroll" | "controller", moduleAccess: unknown, method: string) {
  return {
    user: {
      sub: "user-1",
      email: "user@example.test",
      companyId: "company-1",
      role,
      moduleAccess,
    },
    method,
  } as unknown as FastifyRequest;
}

function replyDouble() {
  const send = vi.fn();
  const code = vi.fn(() => ({ send }));
  return { reply: { code } as unknown as FastifyReply, code };
}

const protectLeave = requireRole(
  ["admin", "hr_payroll"],
  { anyOfModules: ["/employees/leave", "/payroll"] }
);

describe("leave module access", () => {
  it.each(["admin", "hr_payroll", "controller"] as const)(
    "allows %s to mutate leave when Team write access is assigned",
    async (role) => {
      const { reply, code } = replyDouble();
      await protectLeave(requestWithAccess(role, { "/employees": "write" }, "POST"), reply);
      expect(code).not.toHaveBeenCalled();
    }
  );

  it("honours a more-specific Team > Leave write permission", async () => {
    const { reply, code } = replyDouble();
    await protectLeave(requestWithAccess(
      "controller",
      { "/employees": "read", "/employees/leave": "write" },
      "POST"
    ), reply);
    expect(code).not.toHaveBeenCalled();
  });

  it("allows read-only access to leave records but rejects leave mutations", async () => {
    const read = replyDouble();
    await protectLeave(requestWithAccess("hr_payroll", { "/employees": "read" }, "GET"), read.reply);
    expect(read.code).not.toHaveBeenCalled();

    const write = replyDouble();
    await protectLeave(requestWithAccess("hr_payroll", { "/employees": "read" }, "POST"), write.reply);
    expect(write.code).toHaveBeenCalledWith(403);
  });

  it("rejects an HR-labelled user without a relevant module assignment", async () => {
    const { reply, code } = replyDouble();
    await protectLeave(requestWithAccess("hr_payroll", { "/attendance": "write" }, "POST"), reply);
    expect(code).toHaveBeenCalledWith(403);
  });
});
