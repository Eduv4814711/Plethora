import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireCrudCapability } from "../authorization.js";

function requestWithAccess(capabilities: unknown, method: string) {
  return {
    user: { isOwner: false, isActive: true, capabilities },
    method,
  } as unknown as FastifyRequest;
}

function replyDouble() {
  const send = vi.fn();
  const code = vi.fn(() => ({ send }));
  return { reply: { code } as unknown as FastifyReply, code };
}

const protectLeave = requireCrudCapability({
  anyOfModules: ["/employees/leave", "/payroll"],
});

describe("leave capability access", () => {
  it("allows creation through a parent Team capability", async () => {
    const result = replyDouble();
    await protectLeave(requestWithAccess({ "/employees": ["create"] }, "POST"), result.reply);
    expect(result.code).not.toHaveBeenCalled();
  });

  it("honours a more-specific leave assignment over its parent", async () => {
    const denied = replyDouble();
    await protectLeave(
      requestWithAccess(
        { "/employees": ["create"], "/employees/leave": ["view"] },
        "POST"
      ),
      denied.reply
    );
    expect(denied.code).toHaveBeenCalledWith(403);
  });

  it("allows view but rejects mutation when only view is granted", async () => {
    const read = replyDouble();
    await protectLeave(requestWithAccess({ "/employees/leave": ["view"] }, "GET"), read.reply);
    expect(read.code).not.toHaveBeenCalled();
    const write = replyDouble();
    await protectLeave(requestWithAccess({ "/employees/leave": ["view"] }, "POST"), write.reply);
    expect(write.code).toHaveBeenCalledWith(403);
  });
});
