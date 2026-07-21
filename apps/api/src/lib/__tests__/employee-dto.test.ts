import { describe, expect, it } from "vitest";
import {
  canEditEmployeeDetails,
  canViewEmployeeSensitiveFields,
  sanitizeEmployeeForList,
} from "../employee-dto.js";
import type { JWTPayload } from "../types.js";

describe("employee sensitive fields", () => {
  const fullAdmin: JWTPayload = {
    sub: "u1",
    email: "a@test.com",
    companyId: "c1",
    role: "admin",
  };

  const supervisor: JWTPayload = {
    sub: "u2",
    email: "s@test.com",
    companyId: "c1",
    role: "supervisor",
    moduleAccess: ["/rostering"],
  };

  const payrollUser: JWTPayload = {
    sub: "u3",
    email: "hr@test.com",
    companyId: "c1",
    role: "hr_payroll",
    moduleAccess: ["/employees", "/payroll"],
  };

  it("does not allow a broad admin to view private employee data", () => {
    expect(canViewEmployeeSensitiveFields(fullAdmin)).toBe(false);
  });

  it("allows users assigned a relevant module to view employee details", () => {
    expect(canViewEmployeeSensitiveFields(payrollUser)).toBe(true);
    expect(canViewEmployeeSensitiveFields({ ...supervisor, moduleAccess: ["/employees"] })).toBe(true);
  });

  it.each(["/employees", "/payroll"])(
    "allows HR/payroll to edit with the relevant %s module",
    (module) => {
      expect(canEditEmployeeDetails({ ...payrollUser, moduleAccess: [module] })).toBe(true);
    }
  );

  it("allows any role explicitly assigned a relevant module", () => {
    expect(canEditEmployeeDetails(fullAdmin)).toBe(false);
    expect(canEditEmployeeDetails({ ...fullAdmin, moduleAccess: ["/employees"] })).toBe(true);
    expect(canEditEmployeeDetails({ ...supervisor, moduleAccess: ["/employees"] })).toBe(true);
    expect(canEditEmployeeDetails({ ...supervisor, moduleAccess: ["/payroll"] })).toBe(true);
  });

  it("requires every user to have a relevant explicit module assignment", () => {
    expect(canEditEmployeeDetails({ ...supervisor, moduleAccess: ["/attendance"] })).toBe(false);
    expect(canEditEmployeeDetails({ ...payrollUser, moduleAccess: null })).toBe(false);
  });

  it("strips sensitive fields for roster-only supervisor", () => {
    const row = { id: "e1", idNumber: "900101", bankAccountNumber: "123" };
    const out = sanitizeEmployeeForList(row, supervisor) as Record<string, unknown>;
    expect(out.idNumber).toBeUndefined();
    expect(out.bankAccountNumber).toBeUndefined();
    expect(out.id).toBe("e1");
  });
});
