import { describe, expect, it } from "vitest";
import {
  EMPLOYEE_RESTRICTED_FIELDS,
  canAccessSensitiveData,
  hasRestrictedFields,
  omitFields,
} from "../sensitive-data.js";
import type { JWTPayload } from "../types.js";

const admin: JWTPayload = { sub: "a", email: "admin@test.com", companyId: "c", role: "admin" };
const hr: JWTPayload = {
  sub: "h", email: "hr@test.com", companyId: "c", role: "hr_payroll", moduleAccess: ["/employees"],
};

describe("sensitive data policy", () => {
  it("does not treat broad admin access as private-data access", () => {
    expect(canAccessSensitiveData(admin, "/employees")).toBe(false);
  });

  it("requires HR/payroll and the relevant assigned module", () => {
    expect(canAccessSensitiveData(hr, "/employees")).toBe(true);
    expect(canAccessSensitiveData(hr, "/academy")).toBe(false);
  });

  it("detects protected write fields and redacts them", () => {
    expect(hasRestrictedFields({ monthlySalary: 12000 }, EMPLOYEE_RESTRICTED_FIELDS)).toBe(true);
    expect(omitFields({ id: "e1", bankAccountNumber: "123", firstName: "A" }, EMPLOYEE_RESTRICTED_FIELDS))
      .toEqual({ id: "e1", firstName: "A" });
  });
});
