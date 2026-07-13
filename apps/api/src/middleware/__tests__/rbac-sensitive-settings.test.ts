import { describe, it, expect } from "vitest";
import { canViewSensitiveCompanyFields } from "../rbac.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import type { UserAccessRecord } from "../../services/user-access.service.js";

function access(permissions: string[], isSystemOwner = false): UserAccessRecord {
  return {
    userId: "u1",
    companyId: "c1",
    accessVersion: 1,
    isSystemOwner,
    permissions: new Set(permissions),
  };
}

describe("canViewSensitiveCompanyFields", () => {
  it("allows system owners", () => {
    expect(canViewSensitiveCompanyFields(access([], true))).toBe(true);
  });

  it("allows users with settings.manage_statutory permission", () => {
    expect(canViewSensitiveCompanyFields(access([PERMISSIONS.SETTINGS_MANAGE_STATUTORY]))).toBe(true);
  });

  it("denies operational users without statutory permission", () => {
    expect(canViewSensitiveCompanyFields(access([PERMISSIONS.SETTINGS_MANAGE_OPERATIONAL]))).toBe(false);
    expect(canViewSensitiveCompanyFields(undefined)).toBe(false);
  });
});

describe("normalizeModuleAccess", () => {
  it("treats empty array as null", async () => {
    const { normalizeModuleAccess } = await import("../rbac.js");
    expect(normalizeModuleAccess([])).toBeNull();
    expect(normalizeModuleAccess(["/employees"])).toEqual(["/employees"]);
  });
});
