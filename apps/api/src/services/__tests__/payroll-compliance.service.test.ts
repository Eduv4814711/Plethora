import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkNegativeValues } from "../payroll-compliance/rules/negative-values.rule.js";
import { checkMissingTaxId } from "../payroll-compliance/rules/missing-tax-id.rule.js";
import { checkZeroPayActive } from "../payroll-compliance/rules/zero-pay-active.rule.js";
import { checkPremiumPay } from "../payroll-compliance/rules/premium-checks.rule.js";
import { checkHighOvertime } from "../payroll-compliance/rules/high-overtime.rule.js";
import type { ComplianceContext } from "../payroll-compliance/types.js";

function createMockContext(overrides?: Partial<ComplianceContext>): ComplianceContext {
  return {
    companyId: "company1",
    payrollRunId: "run1",
    payrollRun: {
      periodStart: new Date("2025-03-01"),
      periodEnd: new Date("2025-03-31"),
      status: "calculated",
    },
    items: [
      {
        id: "item1",
        employeeId: "emp1",
        grossPay: 8000,
        basePay: 7500,
        overtimePay: 500,
        sundayPay: 0,
        publicHolidayPay: 0,
        deductions: 1200,
        netPay: 6800,
        hoursWorked: 160,
        overtimeHours: 10,
        sundayHours: 0,
        publicHolidayHours: 0,
        employee: {
          id: "emp1",
          idNumber: "8001015001087",
          taxNumber: null,
          status: "active",
          employeeType: "security",
        },
        payslip: {
          tax: 1000,
          uifEmployee: 80,
          uifEmployer: 80,
          sdl: 80,
          earnings: [],
          deductions: [],
        },
      },
    ],
    ...overrides,
  };
}

describe("PayrollComplianceRules", () => {
  describe("checkNegativeValues", () => {
    it("flags negative gross pay", async () => {
      const base = createMockContext();
      const context = createMockContext({
        items: [
          {
            ...base.items[0],
            grossPay: -100,
            netPay: -200,
            deductions: 100,
          },
        ],
      });

      const results = await checkNegativeValues(context);

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.severity === "critical")).toBe(true);
    });

    it("passes when all values are positive", async () => {
      const context = createMockContext();
      const results = await checkNegativeValues(context);
      expect(results).toHaveLength(0);
    });
  });

  describe("checkMissingTaxId", () => {
    it("flags employee with no idNumber or taxNumber", async () => {
      const base = createMockContext();
      const context = createMockContext({
        items: [
          {
            ...base.items[0],
            employee: {
              id: "emp1",
              idNumber: null,
              taxNumber: null,
              status: "active",
              employeeType: "security",
            },
          },
        ],
      });

      const results = await checkMissingTaxId(context);

      expect(results).toHaveLength(1);
      expect(results[0].ruleName).toContain("tax identifier");
    });

    it("passes when employee has idNumber", async () => {
      const context = createMockContext();
      const results = await checkMissingTaxId(context);
      expect(results).toHaveLength(0);
    });
  });

  describe("checkZeroPayActive", () => {
    it("flags active employee with zero gross pay", async () => {
      const base = createMockContext();
      const context = createMockContext({
        items: [
          {
            ...base.items[0],
            grossPay: 0,
            employee: {
              ...base.items[0].employee,
              status: "active",
            },
          },
        ],
      });

      const results = await checkZeroPayActive(context);

      expect(results).toHaveLength(1);
      expect(results[0].severity).toBe("warning");
    });

    it("passes when active employee has positive pay", async () => {
      const context = createMockContext();
      const results = await checkZeroPayActive(context);
      expect(results).toHaveLength(0);
    });
  });

  describe("checkPremiumPay", () => {
    it("flags Sunday hours worked with zero Sunday pay", async () => {
      const base = createMockContext();
      const context = createMockContext({
        items: [{ ...base.items[0], sundayHours: 8, sundayPay: 0 }],
      });

      const results = await checkPremiumPay(context);

      expect(results).toHaveLength(1);
      expect(results[0].ruleId).toBe("sunday_no_premium");
    });

    it("flags public holiday hours worked with zero premium", async () => {
      const base = createMockContext();
      const context = createMockContext({
        items: [{ ...base.items[0], publicHolidayHours: 12, publicHolidayPay: 0 }],
      });

      const results = await checkPremiumPay(context);

      expect(results).toHaveLength(1);
      expect(results[0].ruleId).toBe("public_holiday_no_premium");
    });

    it("does not flag when Sunday hours were paid a premium", async () => {
      const base = createMockContext();
      const context = createMockContext({
        items: [{ ...base.items[0], sundayHours: 8, sundayPay: 1600 }],
      });

      const results = await checkPremiumPay(context);

      expect(results).toHaveLength(0);
    });

    it("does not flag an employee who simply didn't work Sunday/holiday hours", async () => {
      const context = createMockContext();
      const results = await checkPremiumPay(context);
      expect(results).toHaveLength(0);
    });
  });

  describe("checkHighOvertime maxWeeklyHours", () => {
    it("flags average weekly hours above the configured limit", async () => {
      const base = createMockContext();
      // 31-day period ~ 4 weeks; 200 total hours / 4 weeks = 50 avg/week
      const context = createMockContext({
        items: [{ ...base.items[0], hoursWorked: 180, overtimeHours: 20, grossPay: 8000, overtimePay: 500 }],
      });

      const results = await checkHighOvertime(context, 0.25, 45);

      expect(results.some((r) => r.ruleId === "excessive_weekly_hours")).toBe(true);
    });

    it("does not flag when maxWeeklyHours is not configured", async () => {
      const base = createMockContext();
      const context = createMockContext({
        items: [{ ...base.items[0], hoursWorked: 180, overtimeHours: 20 }],
      });

      const results = await checkHighOvertime(context, 0.25, undefined);

      expect(results.some((r) => r.ruleId === "excessive_weekly_hours")).toBe(false);
    });

    it("does not flag average weekly hours within the configured limit", async () => {
      const context = createMockContext();
      const results = await checkHighOvertime(context, 0.25, 45);
      expect(results.some((r) => r.ruleId === "excessive_weekly_hours")).toBe(false);
    });
  });
});
