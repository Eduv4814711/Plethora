import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireCrudCapability, __resetDenialDedupe } from "../authorization.js";
import { SITE_TIMESHEET_MODULES } from "../../modules/rosters/site-timesheet-access.js";

vi.mock("../../lib/audit.js", () => ({
  auditFromRequest: vi.fn(async () => {}),
}));

function requestWithCapabilities(capabilities: unknown, method = "GET", isOwner = false) {
  __resetDenialDedupe();
  return {
    user: { sub: "u1", companyId: "c1", isOwner, isActive: true, capabilities },
    method,
    url: "/rosters/site-timesheets",
    headers: {},
    log: { error: vi.fn(), warn: vi.fn() },
  } as unknown as FastifyRequest;
}

function replyDouble() {
  const send = vi.fn();
  const code = vi.fn(() => ({ send }));
  return { reply: { code } as unknown as FastifyReply, code, send };
}

const protectTimesheets = requireCrudCapability({ anyOfModules: [...SITE_TIMESHEET_MODULES] });

describe("site timesheet capability access", () => {
  it.each(["/attendance", "/rostering"])("allows view access assigned through %s", async (modulePath) => {
    const result = replyDouble();
    await protectTimesheets(requestWithCapabilities({ [modulePath]: ["view"] }), result.reply);
    expect(result.code).not.toHaveBeenCalled();
  });

  it("allows the company owner", async () => {
    const result = replyDouble();
    await protectTimesheets(requestWithCapabilities({}, "GET", true), result.reply);
    expect(result.code).not.toHaveBeenCalled();
  });

  it("rejects an unrelated assignment", async () => {
    const result = replyDouble();
    await protectTimesheets(requestWithCapabilities({ "/tasks": ["view"] }), result.reply);
    expect(result.code).toHaveBeenCalledWith(403);
    expect(result.send).toHaveBeenCalledWith({
      error: "Forbidden",
      message: "You do not have permission to perform this action",
    });
  });

  it("requires the capability matching the operation", async () => {
    const read = replyDouble();
    await protectTimesheets(requestWithCapabilities({ "/attendance": ["view"] }, "GET"), read.reply);
    expect(read.code).not.toHaveBeenCalled();
    const write = replyDouble();
    await protectTimesheets(requestWithCapabilities({ "/attendance": ["view"] }, "POST"), write.reply);
    expect(write.code).toHaveBeenCalledWith(403);
  });
});
