import { describe, expect, it } from "vitest";
import { canAccessRoute, getDefaultRouteForUser, isFullAdmin } from "../permissions";

describe("system owner access", () => {
  it("treats the System Owner as a full administrator", () => {
    expect(isFullAdmin({ role: "admin", isSystemOwner: true, permissions: [] })).toBe(true);
  });

  it("allows the System Owner to use every tenant route", () => {
    expect(canAccessRoute("/payroll", "admin", ["/attendance"], true, [])).toBe(true);
    expect(canAccessRoute("/attendance", "admin", null, false, ["attendance.read"])).toBe(true);
    expect(canAccessRoute("/audit", "admin", null, false, ["audit.read"])).toBe(true);
  });

  it("recognises explicit access-administration capabilities", () => {
    expect(isFullAdmin({ role: "supervisor", permissions: ["users.manage", "permissions.manage_operational"] })).toBe(true);
  });

  it("sends the System Owner to the dashboard", () => {
    expect(getDefaultRouteForUser({ role: "admin", isSystemOwner: true, permissions: [] })).toBe("/");
  });
});
