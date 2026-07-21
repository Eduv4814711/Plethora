import { describe, expect, it } from "vitest";
import type { AuthUser } from "../api";
import { canManageEmployeeDetails } from "../permissions";

describe("employee edit permissions", () => {
  it.each(["/employees", "/payroll"])(
    "allows HR/payroll with the relevant %s module",
    (module) => {
      expect(canManageEmployeeDetails({ role: "hr_payroll", moduleAccess: [module] })).toBe(true);
    }
  );

  it("allows HR/payroll when both relevant modules are assigned", () => {
    expect(
      canManageEmployeeDetails({ role: "hr_payroll", moduleAccess: ["/employees", "/payroll"] })
    ).toBe(true);
  });

  it.each(["admin", "operations_manager", "supervisor", "controller", "client"])(
    "allows the %s role when Team is explicitly assigned",
    (role) => {
      expect(
        canManageEmployeeDetails({ role, moduleAccess: ["/employees"] })
      ).toBe(true);
    }
  );

  it("denies users without Team or Payroll module access", () => {
    const user = { role: "supervisor", moduleAccess: ["/attendance"] };
    expect(canManageEmployeeDetails(user)).toBe(false);
  });

  it("keeps read-only Team and Payroll grants read-only", () => {
    expect(canManageEmployeeDetails({ role: "hr_payroll", moduleAccess: { "/employees": "read" } })).toBe(false);
    expect(canManageEmployeeDetails({ role: "hr_payroll", moduleAccess: { "/payroll": "read" } })).toBe(false);
    expect(canManageEmployeeDetails({ role: "hr_payroll", moduleAccess: { "/employees": "write" } })).toBe(true);
  });

  it("does not treat broad full-admin access as an explicit private-data assignment", () => {
    expect(canManageEmployeeDetails({ role: "admin", moduleAccess: null })).toBe(false);
  });

  it("accepts the permission map returned by authentication", () => {
    const user: AuthUser = {
      id: "user-1",
      name: "Read-only controller",
      email: "controller@example.com",
      role: "controller",
      companyId: "company-1",
      moduleAccess: { "/attendance": "read" },
    };

    expect(user.moduleAccess).toEqual({ "/attendance": "read" });
  });
});
