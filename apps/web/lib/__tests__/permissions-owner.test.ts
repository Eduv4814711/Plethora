import { describe, expect, it } from "vitest";
import { canAccessRoute, getDefaultRouteForUser, isFullAdmin } from "../permissions";

describe("system owner module access", () => {
  it("isFullAdmin for system owners even with a partial module list", () => {
    expect(
      isFullAdmin({
        role: "admin",
        moduleAccess: ["/attendance"],
        isSystemOwner: true,
      })
    ).toBe(true);
  });

  it("canAccessRoute allows every nav module for system owners", () => {
    expect(canAccessRoute("/payroll", "admin", ["/attendance"], true)).toBe(true);
    expect(canAccessRoute("/whatsapp", "admin", ["/attendance"], true)).toBe(true);
    expect(canAccessRoute("/settings", "admin", ["/attendance"], true)).toBe(true);
    expect(canAccessRoute("/audit", "admin", ["/attendance"], true)).toBe(true);
  });

  it("canAccessRoute still restricts non-owners to their module list", () => {
    expect(canAccessRoute("/payroll", "admin", ["/attendance"], false)).toBe(false);
    expect(canAccessRoute("/attendance", "admin", ["/attendance"], false)).toBe(true);
  });

  it("getDefaultRouteForUser sends system owners to dashboard", () => {
    expect(
      getDefaultRouteForUser({
        role: "admin",
        moduleAccess: ["/attendance"],
        isSystemOwner: true,
      })
    ).toBe("/");
  });
});
