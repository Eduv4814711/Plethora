import { describe, expect, it } from "vitest";
import { capabilityDefinition } from "../capabilities.js";
import {
  LEGACY_MODULE_FALLBACKS,
  LEGACY_PARENT_INHERITANCE,
  MIGRATION_MODULE_SEED,
} from "../legacy-access-fallbacks.js";

describe("legacy access fallbacks", () => {
  it("never back-fills Settings · User Access from Settings", () => {
    // Copying this down would hand the escalation surface to every Settings
    // viewer — exactly the hole the change closes.
    expect(
      LEGACY_PARENT_INHERITANCE.some((rule) => rule.child === "/settings/access")
    ).toBe(false);
    expect(LEGACY_MODULE_FALLBACKS.some((rule) => rule.to === "/settings/access")).toBe(false);
  });

  it("back-fills the sub-modules that really were inherited", () => {
    const children = LEGACY_PARENT_INHERITANCE.map((rule) => rule.child);
    expect(children).toContain("/employees/leave");
    expect(children).toContain("/payroll/billing");
  });

  it("never carries manage_access through any fallback", () => {
    for (const fallback of LEGACY_MODULE_FALLBACKS) {
      expect(fallback.capabilities).not.toContain("manage_access");
    }
  });

  it("only references modules that exist in the catalog", () => {
    for (const { parent, child } of LEGACY_PARENT_INHERITANCE) {
      expect(capabilityDefinition(parent)).toBeDefined();
      expect(capabilityDefinition(child)).toBeDefined();
    }
    for (const fallback of LEGACY_MODULE_FALLBACKS) {
      expect(capabilityDefinition(fallback.from)).toBeDefined();
      expect(capabilityDefinition(fallback.to)).toBeDefined();
    }
  });

  it("seeds Data Import / Export from the grants that used to reach it", () => {
    expect(MIGRATION_MODULE_SEED.grant({ "/employees": ["export"] })).toEqual(
      expect.arrayContaining(["view", "export"])
    );
    expect(MIGRATION_MODULE_SEED.grant({ "/sites": ["create"] })).toEqual(
      expect.arrayContaining(["view", "create"])
    );
    // Settings access alone never opened the import/export tooling.
    expect(MIGRATION_MODULE_SEED.grant({ "/settings": ["export"] })).toEqual([]);
    expect(MIGRATION_MODULE_SEED.grant({ "/employees": ["view"] })).toEqual([]);
  });
});
