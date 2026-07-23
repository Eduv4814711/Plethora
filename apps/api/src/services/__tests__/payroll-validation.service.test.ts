import { describe, expect, it } from "vitest";
import {
  reconcileStatutoryTotals,
  validateBankDetailsForItems,
  validatePayrollFinancialValues,
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
