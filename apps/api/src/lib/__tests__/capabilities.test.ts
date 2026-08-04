import { describe, expect, it } from "vitest";
import {
  CAPABILITY_CATALOG,
  capabilityAssignmentForPath,
  diffCapabilities,
  findUnassignableCapability,
  hasCapability,
  normalizeCapabilities,
  resolveEffectiveCapabilities,
  resolveModulePath,
} from "../capabilities.js";

const subject = (capabilities: Record<string, string[]>, extra: Record<string, unknown> = {}) =>
  ({ isOwner: false, isActive: true, capabilities, ...extra }) as Parameters<typeof hasCapability>[0];

describe("module resolution", () => {
  it("resolves an arbitrary sub-path to its owning module", () => {
    expect(resolveModulePath("/sites/abc123")).toBe("/sites");
    expect(resolveModulePath("/payroll/pay-rules")).toBe("/payroll");
    expect(resolveModulePath("/")).toBe("/");
  });

  it("resolves a declared sub-module to itself, not to its parent", () => {
    expect(resolveModulePath("/payroll/billing")).toBe("/payroll/billing");
    expect(resolveModulePath("/settings/access")).toBe("/settings/access");
    expect(resolveModulePath("/employees/leave")).toBe("/employees/leave");
  });

  it("returns null for a path outside the catalog", () => {
    expect(resolveModulePath("/not-a-module")).toBeNull();
  });
});

describe("grants do not cascade to sub-modules", () => {
  it("does not let /settings reach Settings · User Access", () => {
    // The escalation this closes: a Settings viewer could enumerate every
    // colleague and their complete capability map.
    const user = subject({ "/settings": ["view", "edit"] });
    expect(hasCapability(user, "/settings/access", "view")).toBe(false);
    expect(hasCapability(user, "/settings/access", "manage_access")).toBe(false);
    expect(hasCapability(user, "/settings", "view")).toBe(true);
  });

  it("does not let /payroll reach Client Billing", () => {
    const user = subject({ "/payroll": ["view", "approve", "export"] });
    expect(hasCapability(user, "/payroll/billing", "view")).toBe(false);
    expect(hasCapability(user, "/payroll", "approve")).toBe(true);
  });

  it("does not let /employees reach Leave", () => {
    const user = subject({ "/employees": ["view", "create", "edit", "delete"] });
    expect(hasCapability(user, "/employees/leave", "view")).toBe(false);
  });

  it("does not let a sub-module grant leak back up to its parent", () => {
    const user = subject({ "/payroll/billing": ["view", "approve"] });
    expect(hasCapability(user, "/payroll", "view")).toBe(false);
    expect(hasCapability(user, "/payroll/billing", "approve")).toBe(true);
  });

  it("still applies a module grant to that module's own record paths", () => {
    const user = subject({ "/sites": ["view", "edit"] });
    expect(capabilityAssignmentForPath(user.capabilities, "/sites/abc123")).toContain("edit");
  });
});

describe("owner and deactivation", () => {
  it("gives the owner everything", () => {
    const owner = subject({}, { isOwner: true });
    for (const definition of CAPABILITY_CATALOG) {
      for (const capability of definition.capabilities) {
        expect(hasCapability(owner, definition.path, capability)).toBe(true);
      }
    }
  });

  it("denies a deactivated user everything, owner included", () => {
    const inactiveOwner = subject({}, { isOwner: true, isActive: false });
    const inactiveStaff = subject({ "/payroll": ["view"] }, { isActive: false });
    expect(hasCapability(inactiveOwner, "/payroll", "view")).toBe(false);
    expect(hasCapability(inactiveStaff, "/payroll", "view")).toBe(false);
  });
});

describe("normalizeCapabilities", () => {
  it("drops unknown modules and capabilities a module does not support", () => {
    const normalized = normalizeCapabilities({
      "/payroll": ["view", "not-a-capability"],
      "/reports": ["view", "delete"], // Reports supports view and export only.
      "/nonsense": ["view"],
    });
    expect(normalized["/payroll"]).toEqual(["view"]);
    expect(normalized["/reports"]).toEqual(["view"]);
    expect(normalized["/nonsense"]).toBeUndefined();
  });
});

describe("delegation limits", () => {
  it("never lets a non-owner grant manage_access", () => {
    const accessManager = subject({ "/settings/access": ["view", "edit", "manage_access"] });
    expect(
      findUnassignableCapability(accessManager, { "/settings/access": ["manage_access"] })
    ).toEqual({ path: "/settings/access", capability: "manage_access" });
  });

  it("does not let a non-owner grant what they do not hold themselves", () => {
    const actor = subject({ "/payroll": ["view"] });
    expect(findUnassignableCapability(actor, { "/payroll": ["approve"] })).toEqual({
      path: "/payroll",
      capability: "approve",
    });
    expect(findUnassignableCapability(actor, { "/payroll": ["view"] })).toBeNull();
  });

  it("lets the owner grant anything except through a deactivated account", () => {
    expect(findUnassignableCapability(subject({}, { isOwner: true }), { "/payroll": ["approve"] })).toBeNull();
    expect(
      findUnassignableCapability(subject({}, { isOwner: true, isActive: false }), { "/payroll": ["approve"] })
    ).not.toBeNull();
  });
});

describe("resolveEffectiveCapabilities", () => {
  it("reports explicit grants and marks the rest as no access", () => {
    const modules = resolveEffectiveCapabilities(subject({ "/payroll": ["view", "approve"] }));
    const payroll = modules.find((module) => module.path === "/payroll");
    const billing = modules.find((module) => module.path === "/payroll/billing");
    expect(payroll?.granted).toEqual(["view", "approve"]);
    expect(payroll?.source).toBe("explicit");
    expect(billing?.granted).toEqual([]);
    expect(billing?.source).toBe("none");
  });

  it("agrees with hasCapability for every module and capability", () => {
    const user = subject({ "/payroll": ["view", "approve"], "/employees/leave": ["view"] });
    for (const module of resolveEffectiveCapabilities(user)) {
      for (const capability of module.available) {
        expect(module.granted.includes(capability)).toBe(
          hasCapability(user, module.path, capability)
        );
      }
    }
  });

  it("shows a deactivated account as holding nothing", () => {
    const modules = resolveEffectiveCapabilities(
      subject({ "/payroll": ["view"] }, { isActive: false })
    );
    expect(modules.every((module) => module.granted.length === 0)).toBe(true);
  });
});

describe("diffCapabilities", () => {
  it("reports what was granted and revoked with readable labels", () => {
    const diff = diffCapabilities({ "/payroll": ["view"] }, { "/payroll": ["view", "approve"], "/reports": ["view"] });
    expect(diff.added).toEqual([
      { path: "/payroll", label: "Payroll", capability: "approve" },
      { path: "/reports", label: "Reports", capability: "view" },
    ]);
    expect(diff.removed).toEqual([]);

    const revoked = diffCapabilities({ "/payroll": ["view", "approve"] }, { "/payroll": ["view"] });
    expect(revoked.removed).toEqual([{ path: "/payroll", label: "Payroll", capability: "approve" }]);
  });
});

describe("catalog integrity", () => {
  it("declares a parent that exists for every sub-module", () => {
    const paths = new Set(CAPABILITY_CATALOG.map((definition) => definition.path));
    for (const definition of CAPABILITY_CATALOG) {
      if (definition.parent) expect(paths.has(definition.parent)).toBe(true);
    }
  });

  it("keeps manage_access confined to Settings · User Access", () => {
    for (const definition of CAPABILITY_CATALOG) {
      if (definition.capabilities.includes("manage_access")) {
        expect(definition.path).toBe("/settings/access");
      }
    }
  });
});
