import { describe, expect, it, vi, beforeEach } from "vitest";
import { auditPayrollCalculation, PAYROLL_AUDIT } from "../payroll-audit.js";
import type { PayrollCalculationSnapshot } from "../../services/payroll-calculation.types.js";

vi.mock("../audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { createAuditLog } from "../audit.js";

const minimalSnapshot: PayrollCalculationSnapshot = {
  version: "1.0.0",
  calculatedAt: "2026-05-15T12:00:00.000Z",
  payrollRunId: "run-1",
  companyId: "co-1",
  inputs: {
    periodStart: "2026-05-01T00:00:00.000Z",
    periodEnd: "2026-05-31T23:59:59.999Z",
    payPeriod: "monthly",
    isSdlLiable: false,
    timezone: "Africa/Johannesburg",
    publicHolidayDates: [],
    employeeCount: 1,
    employeesConsidered: 1,
    employeesIncluded: 1,
    employeesSkipped: 0,
    companyPayRules: {},
    defaultMultipliers: { overtime: 1.5, sunday: 2, public_holiday: 2 },
  },
  employees: [],
  totals: {
    grossPay: 1000,
    deductions: 100,
    netPay: 900,
    tax: 50,
    uifEmployee: 10,
    uifEmployer: 10,
    sdl: 0,
  },
};

describe("payroll audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs payroll.calculation with snapshot summary metadata", async () => {
    await auditPayrollCalculation({
      userId: "user-1",
      companyId: "co-1",
      payrollRunId: "run-1",
      snapshot: minimalSnapshot,
    });

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: PAYROLL_AUDIT.CALCULATION,
        entityType: "payroll_run",
        entityId: "run-1",
        metadata: expect.objectContaining({
          version: "1.0.0",
          employeesIncluded: 1,
          totals: minimalSnapshot.totals,
        }),
      })
    );
  });
});
