import { describe, expect, it } from "vitest";
import {
  defaultModulesForRole,
  resolveEffectiveModuleAccess,
} from "../module-access.js";

describe("resolveEffectiveModuleAccess", () => {
  it("prefers explicit moduleAccess", () => {
    expect(
      resolveEffectiveModuleAccess({
        role: "admin",
        moduleAccess: ["/attendance"],
        isSystemOwner: true,
      })
    ).toEqual(["/attendance"]);
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
