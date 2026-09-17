import { describe, it, expect } from "vitest";
import {
  computeCorrectPayrollCashRequirement,
  type PayrollCashComponents,
} from "../payroll-reserve.service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(
  periodEnd: Date,
  items: Array<{
    grossPay: number;
    netPay: number;
    deductions: number;
    paye: number;
    empUif: number;
    emplrUif: number;
    sdl: number;
  }>
) {
  return {
    periodEnd,
    items: items.map((i) => ({
      grossPay: i.grossPay,
      netPay: i.netPay,
      deductions: i.deductions,
      payslip: {
        tax: i.paye,
        uifEmployee: i.empUif,
        uifEmployer: i.emplrUif,
        sdl: i.sdl,
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

/**
 * Single employee with simple numbers:
 *   grossPay   = 10 000
 *   PAYE       =  1 800
 *   empUIF     =    100    (1% of 10 000)
 *   emplrUIF   =    100    (1% of 10 000)
 *   SDL        =    100    (1% of 10 000)
 *   thirdParty =    300    (pension, etc.)
 *   netPay     =  7 800    (10 000 - 1 800 - 100 - 300)
 *
 * Correct employer cash requirement:
 *   grossPay + emplrUIF + SDL = 10 000 + 100 + 100 = 10 200
 *
 * Old (inflated) calculation:
 *   grossPay + PAYE + empUIF + emplrUIF + SDL
 *   = 10 000 + 1 800 + 100 + 100 + 100 = 12 100  <- over-count of 1 900
 */
const EMPLOYEE_1 = {
  grossPay: 10_000,
  netPay: 7_800,
  deductions: 2_200, // 1 800 PAYE + 100 empUIF + 300 pension
  paye: 1_800,
  empUif: 100,
  emplrUif: 100,
  sdl: 100,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeCorrectPayrollCashRequirement", () => {
  it("returns zeros when runs are empty", () => {
    const result = computeCorrectPayrollCashRequirement([]);
    expect(result.periodsUsed).toBe(0);
    expect(result.correctedMonthlyBurden).toBe(0);
    const c = result.components;
    expect(c.netWagesPayable).toBe(0);
    expect(c.employeeWithholdings).toBe(0);
    expect(c.thirdPartyDeductions).toBe(0);
    expect(c.employerContributions).toBe(0);
    expect(c.totalPayrollCashRequirement).toBe(0);
  });

  it("single period -- does NOT double-count PAYE and employee UIF", () => {
    const run = makeRun(new Date("2025-03-31"), [EMPLOYEE_1]);
    const result = computeCorrectPayrollCashRequirement([run]);

    expect(result.periodsUsed).toBe(1);

    // Correct employer cash requirement = grossPay + emplrUIF + SDL
    expect(result.correctedMonthlyBurden).toBe(10_200);

    // Old (inflated) would have been 12_100 -- verify we are lower
    const inflated =
      EMPLOYEE_1.grossPay +
      EMPLOYEE_1.paye +
      EMPLOYEE_1.empUif +
      EMPLOYEE_1.emplrUif +
      EMPLOYEE_1.sdl;
    expect(inflated).toBe(12_100);
    expect(result.correctedMonthlyBurden).toBeLessThan(inflated);
  });

  it("breaks down into correct components", () => {
    const run = makeRun(new Date("2025-03-31"), [EMPLOYEE_1]);
    const { components: c } = computeCorrectPayrollCashRequirement([run]);

    // Net wages wired to employees
    expect(c.netWagesPayable).toBe(7_800);

    // PAYE + employee UIF (withheld from employees, remitted to SARS/UIF)
    expect(c.employeeWithholdings).toBe(1_900); // 1 800 + 100

    // Third-party deductions (pension, union, garnishee)
    expect(c.thirdPartyDeductions).toBe(300); // 2 200 - 1 800 PAYE - 100 empUIF

    // Employer-only costs
    expect(c.employerUif).toBe(100);
    expect(c.sdl).toBe(100);
    expect(c.employerContributions).toBe(200);

    // Identity: netWages + withholdings + thirdParty = grossPay
    expect(c.netWagesPayable + c.employeeWithholdings + c.thirdPartyDeductions).toBeCloseTo(
      EMPLOYEE_1.grossPay,
      1
    );

    // Identity: totalPayrollCashRequirement = grossPay + employerContributions
    expect(c.totalPayrollCashRequirement).toBe(EMPLOYEE_1.grossPay + c.employerContributions);
  });

  it("averages correctly across two runs in the same month", () => {
    // Two runs in same month -- should count as ONE period
    const runA = makeRun(new Date("2025-03-15"), [EMPLOYEE_1]);
    const runB = makeRun(new Date("2025-03-31"), [EMPLOYEE_1]);
    const result = computeCorrectPayrollCashRequirement([runA, runB]);

    expect(result.periodsUsed).toBe(1);
    // Month accumulates both: gross = 20 000, emplrUIF = 200, SDL = 200
    expect(result.correctedMonthlyBurden).toBe(20_400);
  });

  it("averages correctly across two separate months", () => {
    const marchRun = makeRun(new Date("2025-03-31"), [EMPLOYEE_1]);
    const aprilRun = makeRun(new Date("2025-04-30"), [EMPLOYEE_1]);
    const result = computeCorrectPayrollCashRequirement([marchRun, aprilRun]);

    expect(result.periodsUsed).toBe(2);
    expect(result.correctedMonthlyBurden).toBe(10_200);
  });

  it("handles multiple employees in a single run", () => {
    const emp2 = {
      grossPay: 8_000,
      netPay: 6_300,
      deductions: 1_700,
      paye: 1_500,
      empUif: 80,
      emplrUif: 80,
      sdl: 80,
    };
    const run = makeRun(new Date("2025-03-31"), [EMPLOYEE_1, emp2]);
    const { components: c } = computeCorrectPayrollCashRequirement([run]);

    const expectedGross = EMPLOYEE_1.grossPay + emp2.grossPay; // 18 000
    const expectedEmplrContrib =
      EMPLOYEE_1.emplrUif + EMPLOYEE_1.sdl + emp2.emplrUif + emp2.sdl; // 360

    expect(c.totalPayrollCashRequirement).toBe(expectedGross + expectedEmplrContrib); // 18 360
  });

  it("PAYE is NOT in employerContributions", () => {
    const run = makeRun(new Date("2025-03-31"), [EMPLOYEE_1]);
    const { components: c } = computeCorrectPayrollCashRequirement([run]);

    expect(c.employerContributions).toBe(EMPLOYEE_1.emplrUif + EMPLOYEE_1.sdl);
    // Must NOT include PAYE
    expect(c.employerContributions).not.toBeCloseTo(
      EMPLOYEE_1.paye + EMPLOYEE_1.emplrUif + EMPLOYEE_1.sdl,
      0
    );
  });

  it("handles items with no payslip (legacy data) gracefully", () => {
    const run = {
      periodEnd: new Date("2025-03-31"),
      items: [
        {
          grossPay: 5_000,
          netPay: 4_000,
          deductions: 1_000,
          payslip: null,
        },
      ],
    };
    const { components: c } = computeCorrectPayrollCashRequirement([run]);
    expect(c.totalPayrollCashRequirement).toBe(5_000);
    expect(c.employerContributions).toBe(0);
  });

  it("three-month average matches cash-floor planning formula", () => {
    /**
     * Correct cash floor = avgGross + avgEmplrUIF + avgSDL = 10 200
     * Old formula         = 12 100 (~19% over-estimate)
     */
    const months = [
      makeRun(new Date("2025-01-31"), [EMPLOYEE_1]),
      makeRun(new Date("2025-02-28"), [EMPLOYEE_1]),
      makeRun(new Date("2025-03-31"), [EMPLOYEE_1]),
    ];
    const result = computeCorrectPayrollCashRequirement(months);
    expect(result.periodsUsed).toBe(3);
    expect(result.correctedMonthlyBurden).toBe(10_200);

    const overEstimatePercent =
      ((12_100 - result.correctedMonthlyBurden) / result.correctedMonthlyBurden) * 100;
    expect(overEstimatePercent).toBeGreaterThan(15);
  });
});
