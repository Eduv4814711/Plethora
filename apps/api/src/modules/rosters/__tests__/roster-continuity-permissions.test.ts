import { describe, expect, it } from "vitest";
import { rosterActionPermissions } from "../roster-continuity.service.js";

describe("rosterActionPermissions", () => {
  it.each(["admin", "operations_manager"] as const)(
    "allows %s to manage recurring and advanced rosters",
    (role) => {
      expect(rosterActionPermissions(role)).toEqual({
        canManageBaseline: true,
        canManageExceptions: true,
        canUseAdvancedEditor: true,
      });
    }
  );

  it("allows supervisors to resolve daily exceptions without changing the baseline", () => {
    expect(rosterActionPermissions("supervisor")).toEqual({
      canManageBaseline: false,
      canManageExceptions: true,
      canUseAdvancedEditor: false,
    });
  });

  it("keeps controllers read-only", () => {
    expect(rosterActionPermissions("controller")).toEqual({
      canManageBaseline: false,
      canManageExceptions: false,
      canUseAdvancedEditor: false,
    });
  });
});
