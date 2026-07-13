import { describe, it, expect } from "vitest";
import {
  canReadCompensation,
  canReadEmployeePrivate,
  compensationSetupPending,
  rejectForbiddenOperationalFields,
  enrichOperationalEmployee,
} from "../employee-dto.js";
import { PERMISSIONS } from "../permissions.js";
import type { UserAccessRecord } from "../../services/user-access.service.js";

function access(permissions: string[]): UserAccessRecord {
  return {
    userId: "u1",
    companyId: "c1",
    accessVersion: 1,
    isSystemOwner: false,
    permissions: new Set(permissions),
  };
}

describe("employee permission helpers", () => {
  it("grants private read with employees.read_private", () => {
    expect(canReadEmployeePrivate(access([PERMISSIONS.EMPLOYEES_READ_PRIVATE]))).toBe(true);
    expect(canReadEmployeePrivate(access([PERMISSIONS.EMPLOYEES_READ_OPERATIONAL]))).toBe(false);
  });

  it("grants compensation read with compensation.read", () => {
    expect(canReadCompensation(access([PERMISSIONS.COMPENSATION_READ]))).toBe(true);
    expect(canReadCompensation(access([]))).toBe(false);
  });

  it("rejects forbidden operational payload fields", () => {
    const rejected = rejectForbiddenOperationalFields({ firstName: "A", monthlySalary: 1000 });
    expect(rejected?.forbidden).toContain("monthlySalary");
  });

  it("computes compensationSetupPending", () => {
    expect(compensationSetupPending({ employeeType: "office", monthlySalary: null })).toBe(true);
    expect(compensationSetupPending({ employeeType: "security", hourlyRate: 50 })).toBe(false);
  });

  it("enriches operational employee without exposing rates", () => {
    const out = enrichOperationalEmployee(
      { id: "e1", firstName: "Jane", employeeType: "office" },
      { monthlySalary: null, employeeType: "office" }
    );
    expect(out.compensationSetupPending).toBe(true);
    expect((out as Record<string, unknown>).monthlySalary).toBeUndefined();
  });
});
