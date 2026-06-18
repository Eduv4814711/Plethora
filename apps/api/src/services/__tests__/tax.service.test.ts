import { describe, expect, it } from "vitest";
import {
  calculatePAYE,
  calculateSDL,
  calculateUIF,
  exceedsSdlThreshold,
  uifEarningsCeilingForPeriod,
} from "../tax.service.js";
import { SDL_THRESHOLD_ANNUAL, UIF_EARNINGS_CEILING } from "../../lib/tax-brackets.js";

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
