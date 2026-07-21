import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireRole } from "../rbac.js";
import { SITE_TIMESHEET_MODULES } from "../../modules/rosters/site-timesheet-access.js";

function requestWithModules(role: "admin" | "controller", moduleAccess: unknown, method = "GET") {
  return {
    user: {
      sub: "user-1",
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
  return { reply: { code } as unknown as FastifyReply, code, send };
}

const protectTimesheets = requireRole(
  ["admin", "operations_manager", "hr_payroll", "supervisor", "controller"],
  { anyOfModules: [...SITE_TIMESHEET_MODULES] }
);

describe("site timesheet module access", () => {
  it.each([["/attendance"], ["/rostering"]])("allows a controller assigned to %s", async (modulePath) => {
    const { reply, code } = replyDouble();
    await protectTimesheets(requestWithModules("controller", [modulePath]), reply);
    expect(code).not.toHaveBeenCalled();
  });

  it("allows a full administrator", async () => {
    const { reply, code } = replyDouble();
    await protectTimesheets(requestWithModules("admin", null), reply);
    expect(code).not.toHaveBeenCalled();
  });

  it("rejects a user assigned only to an unrelated module", async () => {
    const { reply, code, send } = replyDouble();
    await protectTimesheets(requestWithModules("controller", ["/tasks"]), reply);
    expect(code).toHaveBeenCalledWith(403);
    expect(send).toHaveBeenCalledWith({ error: "Forbidden", message: "No access to this module" });
  });

  it("allows read-only access for GET but rejects writes", async () => {
    const read = requireRole(["controller"], { module: "/attendance" });
    const get = replyDouble();
    await read(requestWithModules("controller", { "/attendance": "read" }, "GET"), get.reply);
    expect(get.code).not.toHaveBeenCalled();
    const post = replyDouble();
    await read(requestWithModules("controller", { "/attendance": "read" }, "POST"), post.reply);
    expect(post.code).toHaveBeenCalledWith(403);
  });
});
