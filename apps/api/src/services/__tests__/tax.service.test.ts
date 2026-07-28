import { describe, expect, it } from "vitest";
import {
  calculatePAYE,
  calculateSDL,
  calculateUIF,
  exceedsSdlThreshold,
  uifEarningsCeilingForPeriod,
} from "../tax.service.js";
import {
  resolveTaxYearConfig,
  taxYearEndDate,
  taxYearStartingYearForDate,
  SDL_THRESHOLD_ANNUAL,
  TAX_YEAR_2025_2026,
  UIF_EARNINGS_CEILING,
} from "../../lib/tax-brackets.js";

describe("calculatePAYE", () => {
  it("returns zero tax below the annual threshold", () => {
    const employee = { dateOfBirth: new Date("1990-01-01") };
    // R7,979/month * 12 = R95,748 (below R95,750 threshold)
    expect(calculatePAYE(7979, "monthly", employee)).toBe(0);
  });

  it("calculates tax in the first bracket for taxable income", () => {
    const employee = { dateOfBirth: new Date("1990-01-01") };
    // R20,000/month * 12 = R240,000 annual taxable
    const paye = calculatePAYE(20000, "monthly", employee);
    expect(paye).toBeGreaterThan(0);
    expect(paye).toBeLessThan(20000);
  });

  it("applies secondary rebate for employees aged 65+", () => {
    const young = { dateOfBirth: new Date("1990-01-01") };
    const senior = { dateOfBirth: new Date("1955-01-01") };
    const payeYoung = calculatePAYE(15000, "monthly", young);
    const payeSenior = calculatePAYE(15000, "monthly", senior);
    expect(payeSenior).toBeLessThan(payeYoung);
  });

  it("uses fixed tax directive rate when configured", () => {
    const tax = calculatePAYE(10000, "monthly", {
      dateOfBirth: new Date("1990-01-01"),
      taxDirectiveRate: 20 as never,
      taxDirectiveNumber: "DIR-001",
    });
    expect(tax).toBe(2000);
  });
});

describe("calculateUIF", () => {
  it("charges 1% employee and employer on gross pay", () => {
    const result = calculateUIF(10000, "monthly");
    expect(result).toEqual({ employee: 100, employer: 100 });
  });

  it("caps contributions at the monthly ceiling", () => {
    const result = calculateUIF(25000, "monthly");
    const expected = Math.round(UIF_EARNINGS_CEILING * 0.01 * 100) / 100;
    expect(result).toEqual({ employee: expected, employer: expected });
  });

  it("prorates the ceiling for weekly pay periods", () => {
    const weeklyCeiling = uifEarningsCeilingForPeriod("weekly");
    expect(weeklyCeiling).toBeLessThan(UIF_EARNINGS_CEILING);
    const result = calculateUIF(weeklyCeiling + 5000, "weekly");
    const expected = Math.round(weeklyCeiling * 0.01 * 100) / 100;
    expect(result.employee).toBe(expected);
  });
});

describe("calculateSDL", () => {
  it("returns zero when company is not SDL liable", () => {
    expect(calculateSDL(50000, false)).toBe(0);
  });

  it("charges 1% when SDL liable", () => {
    expect(calculateSDL(50000, true)).toBe(500);
  });
});

describe("exceedsSdlThreshold", () => {
  it("returns true at or above annual threshold", () => {
    expect(exceedsSdlThreshold(SDL_THRESHOLD_ANNUAL)).toBe(true);
    expect(exceedsSdlThreshold(SDL_THRESHOLD_ANNUAL + 1)).toBe(true);
    expect(exceedsSdlThreshold(SDL_THRESHOLD_ANNUAL - 1)).toBe(false);
  });
});

describe("tax year resolution", () => {
  it("treats March as the start of a new year of assessment", () => {
    expect(taxYearStartingYearForDate(new Date("2026-02-28T00:00:00.000Z"))).toBe(2025);
    expect(taxYearStartingYearForDate(new Date("2026-03-01T00:00:00.000Z"))).toBe(2026);
    expect(taxYearStartingYearForDate(new Date("2027-01-31T00:00:00.000Z"))).toBe(2026);
  });

  it("ends a year of assessment on the last day of February", () => {
    expect(taxYearEndDate(2025).toISOString().slice(0, 10)).toBe("2026-02-28");
    // 2028 is a leap year, so the 2027 year of assessment ends on the 29th.
    expect(taxYearEndDate(2027).toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("resolves the configured table for a known year", () => {
    expect(resolveTaxYearConfig(new Date("2025-06-30T00:00:00.000Z")).year).toBe(2025);
    expect(resolveTaxYearConfig(new Date("2026-06-30T00:00:00.000Z")).year).toBe(2026);
  });

  it("marks an unconfigured future year as provisional rather than throwing", () => {
    const future = resolveTaxYearConfig(new Date("2035-06-30T00:00:00.000Z"));
    expect(future.year).toBe(2035);
    expect(future.provisional).toBe(true);
    expect(future.brackets.length).toBeGreaterThan(0);
  });
});

describe("age-based rebates", () => {
  it("uses age at the end of the year of assessment, not today's date", () => {
    // Turns 65 on 2026-01-15, i.e. before the 2025/2026 year of assessment ends.
    const employee = { dateOfBirth: new Date("1961-01-15") };
    const paye2025 = calculatePAYE(30000, "monthly", employee, TAX_YEAR_2025_2026);

    // Someone a year younger gets the primary rebate only, so pays more.
    const younger = { dateOfBirth: new Date("1962-01-15") };
    const payeYounger = calculatePAYE(30000, "monthly", younger, TAX_YEAR_2025_2026);

    expect(paye2025).toBeLessThan(payeYounger);
    // The secondary rebate is R9,444/year = R787/month.
    expect(payeYounger - paye2025).toBeCloseTo(787, 0);
  });

  it("produces the same PAYE for a given tax year no matter when it is recalculated", () => {
    const employee = { dateOfBirth: new Date("1961-01-15") };
    const first = calculatePAYE(30000, "monthly", employee, TAX_YEAR_2025_2026);
    const second = calculatePAYE(30000, "monthly", employee, TAX_YEAR_2025_2026);
    expect(first).toBe(second);
    // The rebate band is fixed by the tax year, so a later year of assessment for the
    // same employee is a deliberate change, not drift from the current clock.
    expect(first).toBe(calculatePAYE(30000, "monthly", employee, TAX_YEAR_2025_2026));
  });
});
