import { describe, expect, it } from "vitest";
import {
  reconcileStatutoryTotals,
  validateBankDetailsForItems,
  validateConflictingPayConfiguration,
  validatePayrollFinancialValues,
  validateTaxYearConfiguration,
} from "../payroll-validation.service.js";
import type { PayrollCalculationSnapshot } from "../payroll-calculation.types.js";

describe("validateBankDetailsForItems", () => {
  it("flags employees missing bank account numbers", () => {
    const result = validateBankDetailsForItems([
      {
        id: "item-1",
        employeeId: "emp-1",
        netPay: 5000,
        employee: {
          firstName: "Jane",
          lastName: "Doe",
          employeeNumber: "E001",
          bankAccountNumber: null,
          bankBranchCode: "632005",
        },
      },
      {
        id: "item-2",
        employeeId: "emp-2",
        netPay: 3000,
        employee: {
          firstName: "John",
          lastName: "Smith",
          employeeNumber: "E002",
          bankAccountNumber: "1234567890",
          bankBranchCode: "632005",
        },
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.excludedEmployees).toHaveLength(1);
    expect(result.exportTotal).toBe(3000);
    expect(result.totalNetPay).toBe(8000);
  });
});

describe("reconcileStatutoryTotals", () => {
  it("detects mismatch between snapshot and payslip totals", () => {
    const snapshot = {
      totals: {
        grossPay: 10000,
        deductions: 2000,
        netPay: 8000,
        tax: 1000,
        uifEmployee: 100,
        uifEmployer: 100,
        sdl: 50,
      },
    } as PayrollCalculationSnapshot;

    const result = reconcileStatutoryTotals({
      snapshot,
      items: [
        {
          grossPay: 10000,
          netPay: 8000,
          payslip: { tax: 900, uifEmployee: 100, uifEmployer: 100, sdl: 50 },
        },
      ],
    });

    expect(result.matched).toBe(false);
    expect(result.paye.matched).toBe(false);
    expect(result.mismatches.some((m) => m.startsWith("PAYE"))).toBe(true);
  });
});

describe("validatePayrollFinancialValues", () => {
  it("blocks negative net pay and deductions above gross pay", () => {
    const issues = validatePayrollFinancialValues([{
      id: "item-1",
      employeeId: "emp-1",
      grossPay: 1_000,
      deductions: 1_200,
      netPay: -200,
      employee: { firstName: "Test", lastName: "Employee" },
    }]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: "invalid_payment_values",
      severity: "critical",
      employeeId: "emp-1",
    });
  });
});

function snapshotWith(
  overrides: Partial<PayrollCalculationSnapshot>
): PayrollCalculationSnapshot {
  return {
    version: "1.4.0",
    calculatedAt: "2026-07-28T00:00:00.000Z",
    payrollRunId: "run-1",
    companyId: "co-1",
    inputs: {
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-30T00:00:00.000Z",
      payPeriod: "monthly",
      isSdlLiable: false,
      sdlStatus: {
        isLiable: false,
        liableFrom: null,
        rolling12MonthPayroll: 0,
        projectedRolling12Month: 0,
        threshold: 500_000,
        includeRelieversWithAttendance: true,
      },
      taxYear: {
        year: 2026,
        label: "2026/2027",
        provisional: false,
        primaryRebate: 17_235,
        thresholdUnder65: 95_750,
      },
      timezone: "Africa/Johannesburg",
      publicHolidayDates: [],
      employeeCount: 0,
      employeesConsidered: 0,
      employeesIncluded: 0,
      employeesSkipped: 0,
      companyPayRules: {},
      defaultMultipliers: { overtime: 1.5, sunday: 2, public_holiday: 2 },
    },
    employees: [],
    totals: {
      grossPay: 0,
      deductions: 0,
      netPay: 0,
      tax: 0,
      uifEmployee: 0,
      uifEmployer: 0,
      sdl: 0,
    },
    ...overrides,
  } as PayrollCalculationSnapshot;
}

function employeeSnapshot(context: Record<string, unknown>, skipped = false) {
  return {
    context: {
      employeeId: "emp-1",
      employeeNumber: "E001",
      firstName: "Jane",
      lastName: "Doe",
      status: "active",
      employeeType: "security_officer",
      groupId: null,
      siteId: null,
      postId: null,
      gradeId: null,
      gradeName: null,
      hourlyRate: 0,
      monthlySalary: 0,
      taxDirectiveNumber: null,
      taxDirectiveRate: null,
      ...context,
    },
    rules: {
      overtimeMultiplier: 1.5,
      sundayMultiplier: 2,
      publicHolidayMultiplier: 2,
      source: "company",
    },
    earningsRulesApplied: [],
    timesheet: null,
    output: { skipped },
  } as never;
}

describe("validateTaxYearConfiguration", () => {
  it("warns when a run was taxed on provisional tables", () => {
    const snapshot = snapshotWith({});
    snapshot.inputs.taxYear.provisional = true;
    const issues = validateTaxYearConfiguration(snapshot, "run-1");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.ruleId).toBe("provisional_tax_year");
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.message).toContain("2026/2027");
  });

  it("stays silent on confirmed tables", () => {
    expect(validateTaxYearConfiguration(snapshotWith({}), "run-1")).toEqual([]);
  });

  it("stays silent when there is no snapshot", () => {
    expect(validateTaxYearConfiguration(null, "run-1")).toEqual([]);
  });
});

describe("validateConflictingPayConfiguration", () => {
  it("warns when an employee has both a monthly salary and an hourly rate", () => {
    const snapshot = snapshotWith({
      employees: [employeeSnapshot({ monthlySalary: 5000, hourlyRate: 100 })],
    });
    const issues = validateConflictingPayConfiguration(snapshot);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.ruleId).toBe("conflicting_pay_configuration");
    expect(issues[0]!.employeeId).toBe("emp-1");
  });

  it("accepts an employee with only one pay basis", () => {
    expect(
      validateConflictingPayConfiguration(
        snapshotWith({ employees: [employeeSnapshot({ hourlyRate: 100 })] })
      )
    ).toEqual([]);
    expect(
      validateConflictingPayConfiguration(
        snapshotWith({ employees: [employeeSnapshot({ monthlySalary: 5000 })] })
      )
    ).toEqual([]);
  });

  it("ignores employees who were skipped by the calculation", () => {
    const snapshot = snapshotWith({
      employees: [employeeSnapshot({ monthlySalary: 5000, hourlyRate: 100 }, true)],
    });
    expect(validateConflictingPayConfiguration(snapshot)).toEqual([]);
  });
});
