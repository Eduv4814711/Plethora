import { describe, expect, it } from "vitest";
import type { CapabilityMap } from "../api";
import {
  canAccessRoute,
  canAccessMigrationTools,
  canManageEmployeeDetails,
  capabilitiesForPath,
  hasCapability,
} from "../permissions";

const subject = (capabilities: CapabilityMap = {}, isOwner = false) => ({
  isOwner,
  isActive: true,
  capabilities,
});

describe("capability access", () => {
  it("denies missing capabilities by default", () => {
    expect(hasCapability(subject(), "/employees", "view")).toBe(false);
    expect(canManageEmployeeDetails(subject())).toBe(false);
  });

  it("keeps capabilities explicit and non-hierarchical", () => {
    const user = subject({ "/employees": ["edit"] });
    expect(hasCapability(user, "/employees", "edit")).toBe(true);
    expect(hasCapability(user, "/employees", "view")).toBe(false);
  });

  it("uses the most-specific submodule assignment", () => {
    const user = subject({
      "/employees": ["view", "edit"],
      "/employees/leave": ["view"],
    });
    expect(capabilitiesForPath(user.capabilities, "/employees/leave/requests")).toEqual(["view"]);
    expect(hasCapability(user, "/employees/leave/requests", "edit")).toBe(false);
  });

  it("allows the owner bypass while the account is active", () => {
    expect(hasCapability(subject({}, true), "/payroll", "delete")).toBe(true);
    expect(hasCapability({ ...subject({}, true), isActive: false }, "/payroll", "view")).toBe(false);
  });

  it("allows the leave workspace through explicit Leave or Payroll view access", () => {
    expect(canAccessRoute("/employees/leave", subject({ "/employees/leave": ["view"] }))).toBe(true);
    expect(canAccessRoute("/employees/leave", subject({ "/payroll": ["view"] }))).toBe(true);
    expect(canAccessRoute("/employees/leave", subject({ "/employees": ["view"], "/employees/leave": ["edit"] }))).toBe(false);
  });

  it("opens migration tools only through the affected module actions", () => {
    const teamExporter = subject({ "/employees": ["export"] });
    expect(canAccessMigrationTools(teamExporter)).toBe(true);
    expect(canAccessRoute("/settings/migrate", teamExporter)).toBe(true);
    expect(canAccessRoute("/settings", teamExporter)).toBe(false);
    expect(canAccessMigrationTools(subject({ "/settings": ["export"] }))).toBe(false);
  });
});

describe("employee management helpers", () => {
  it("allows employee edits through Team or Payroll edit capability", () => {
    expect(canManageEmployeeDetails(subject({ "/employees": ["edit"] }))).toBe(true);
    expect(canManageEmployeeDetails(subject({ "/payroll": ["edit"] }))).toBe(true);
    expect(canManageEmployeeDetails(subject({ "/employees": ["view"] }))).toBe(false);
  });
});
