import { describe, expect, it } from "vitest";
import { canViewSensitiveCompanyFields, normalizeModuleAccess } from "../rbac.js";
import type { JWTPayload } from "../../lib/types.js";

function user(partial: Partial<JWTPayload>): JWTPayload {
  return {
    sub: "u1",
    email: "u@example.com",
    companyId: "c1",
    role: "controller",
    ...partial,
  };
}

describe("canViewSensitiveCompanyFields", () => {
  it("allows full admins (admin with no moduleAccess list)", () => {
    expect(
      canViewSensitiveCompanyFields(user({ role: "admin", moduleAccess: null }))
    ).toBe(true);
  });

  it("allows users with /settings or /payroll module access", () => {
    expect(
      canViewSensitiveCompanyFields(user({ moduleAccess: ["/settings"] }))
    ).toBe(true);
    expect(
      canViewSensitiveCompanyFields(user({ moduleAccess: ["/payroll", "/attendance"] }))
    ).toBe(true);
  });

  it("denies scoped admins and controllers without settings/payroll", () => {
    expect(
      canViewSensitiveCompanyFields(user({ role: "admin", moduleAccess: ["/rostering"] }))
    ).toBe(false);
    expect(
      canViewSensitiveCompanyFields(user({ role: "controller", moduleAccess: ["/attendance"] }))
    ).toBe(false);
  });

  it("normalizeModuleAccess treats empty arrays as null", () => {
    expect(normalizeModuleAccess([])).toBeNull();
    expect(normalizeModuleAccess(["/employees"])).toEqual(["/employees"]);
  });
});
