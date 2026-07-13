import { describe, expect, it } from "vitest";
import {
  defaultModulesForRole,
  resolveEffectiveModuleAccess,
} from "../module-access.js";

describe("resolveEffectiveModuleAccess", () => {
  it("gives system owners all modules even when DB has a partial list", () => {
    const mods = resolveEffectiveModuleAccess({
      role: "admin",
      moduleAccess: ["/attendance"],
      isSystemOwner: true,
    });
    expect(mods).toContain("/");
    expect(mods).toContain("/sites");
    expect(mods).toContain("/whatsapp");
    expect(mods).toContain("/settings");
    expect(mods?.length).toBeGreaterThan(1);
  });

  it("gives system owners all modules when DB list is null", () => {
    const mods = resolveEffectiveModuleAccess({
      role: "admin",
      moduleAccess: null,
      isSystemOwner: true,
    });
    expect(mods).toContain("/");
    expect(mods).toContain("/sites");
    expect(mods).toContain("/whatsapp");
  });

  it("prefers explicit moduleAccess for non-owners", () => {
    expect(
      resolveEffectiveModuleAccess({
        role: "admin",
        moduleAccess: ["/attendance"],
        isSystemOwner: false,
      })
    ).toEqual(["/attendance"]);
  });

  it("falls back to role defaults for non-owners with null moduleAccess", () => {
    expect(
      resolveEffectiveModuleAccess({
        role: "controller",
        moduleAccess: null,
        isSystemOwner: false,
      })
    ).toEqual(defaultModulesForRole("controller"));
  });
});
