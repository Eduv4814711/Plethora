import { describe, expect, it } from "vitest";
import type { CapabilityMap } from "../api";
import {
  canAccessRoute,
  canAccessMigrationTools,
  canManageEmployeeDetails,
  capabilitiesForPath,
  hasCapability,
  resolveModulePath,
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

  it("resolves a record path to its owning module", () => {
    expect(resolveModulePath("/sites/abc123")).toBe("/sites");
    expect(resolveModulePath("/employees/leave/requests")).toBe("/employees/leave");
  });

  it("does not let a parent module grant reach a sub-module", () => {
    const user = subject({ "/employees": ["view", "edit"] });
    expect(hasCapability(user, "/employees/leave", "view")).toBe(false);
    expect(capabilitiesForPath(user.capabilities, "/employees/leave/requests")).toBeNull();
  });

  it("uses the sub-module's own assignment when it has one", () => {
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

  it("opens the leave workspace only through explicit Leave view access", () => {
    expect(canAccessRoute("/employees/leave", subject({ "/employees/leave": ["view"] }))).toBe(true);
    // Payroll no longer implies Leave; the access migration granted it explicitly
    // to everyone who relied on that.
    expect(canAccessRoute("/employees/leave", subject({ "/payroll": ["view"] }))).toBe(false);
    expect(
      canAccessRoute("/employees/leave", subject({ "/employees": ["view"], "/employees/leave": ["edit"] }))
    ).toBe(false);
  });

  it("opens Clients only through explicit Clients view access", () => {
    expect(canAccessRoute("/clients", subject({ "/clients": ["view"] }))).toBe(true);
    expect(canAccessRoute("/clients", subject({ "/sites": ["view"] }))).toBe(false);
    expect(canAccessRoute("/clients", subject({ "/settings": ["view"] }))).toBe(false);
  });

  it("opens migration tools only through the Data Import / Export module", () => {
    const importer = subject({ "/settings/migrate": ["view", "export"] });
    expect(canAccessMigrationTools(importer)).toBe(true);
    expect(canAccessRoute("/settings/migrate", importer)).toBe(true);
    expect(canAccessRoute("/settings", importer)).toBe(false);
    // A Team export grant used to be a back door into bulk import/export.
    expect(canAccessMigrationTools(subject({ "/employees": ["export"] }))).toBe(false);
  });

  it("treats /overview as the Dashboard module it was split out of", () => {
    // The charts moved off `/` when it became the module launcher. /overview is
    // an alias, not a grantable module: Dashboard view is exactly what opens it.
    const dashboardUser = subject({ "/": ["view"] });
    expect(resolveModulePath("/overview")).toBe("/");
    expect(canAccessRoute("/overview", dashboardUser)).toBe(true);
    expect(canAccessRoute("/overview", subject({ "/tasks": ["view"] }))).toBe(false);
    expect(canAccessRoute("/overview", subject({}, true))).toBe(true);
  });

  it("does not let a Settings grant open Settings · User Access", () => {
    const settingsUser = subject({ "/settings": ["view", "edit"] });
    expect(hasCapability(settingsUser, "/settings/access", "view")).toBe(false);
    expect(hasCapability(settingsUser, "/settings/access", "manage_access")).toBe(false);
  });
});

describe("employee management helpers", () => {
  it("allows employee edits through Team or Payroll edit capability", () => {
    expect(canManageEmployeeDetails(subject({ "/employees": ["edit"] }))).toBe(true);
    expect(canManageEmployeeDetails(subject({ "/payroll": ["edit"] }))).toBe(true);
    expect(canManageEmployeeDetails(subject({ "/employees": ["view"] }))).toBe(false);
  });
});
