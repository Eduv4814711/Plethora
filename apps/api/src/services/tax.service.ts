import type { Employee } from "@prisma/client";
import {
  TAX_YEAR_2025_2026,
  UIF_EARNINGS_CEILING,
  SDL_THRESHOLD_ANNUAL,
  type TaxYearConfig,
} from "../lib/tax-brackets.js";

export type PayPeriod = "weekly" | "biweekly" | "monthly";

const PERIODS_PER_YEAR: Record<PayPeriod, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
};

/**
 * Calculate PAYE (income tax) for a pay period.
 * Uses SARS progressive brackets with annualization.
 */
export function calculatePAYE(
  taxableEarnings: number,
  payPeriod: PayPeriod,
  employee: Pick<Employee, "dateOfBirth">,
  taxYearConfig: TaxYearConfig = TAX_YEAR_2025_2026
): number {
  const periodsPerYear = PERIODS_PER_YEAR[payPeriod];
  const annualTaxable = taxableEarnings * periodsPerYear;

  // Tax threshold - no tax if below
  const age = employee.dateOfBirth ? getAge(employee.dateOfBirth) : 0;
  const threshold =
    age >= 75
      ? taxYearConfig.threshold75Plus
      : age >= 65
        ? taxYearConfig.threshold65to74
        : taxYearConfig.thresholdUnder65;

  if (annualTaxable <= threshold) {
    return 0;
  }

  // Find applicable bracket and calculate tax
  let annualTax = 0;
  for (const bracket of taxYearConfig.brackets) {
    if (annualTaxable > bracket.min && annualTaxable <= bracket.max) {
      annualTax = bracket.baseTax + (annualTaxable - bracket.min) * bracket.rate;
      break;
    }
  }

  // Apply rebates
  const totalRebate =
    taxYearConfig.primaryRebate +
    (age >= 65 ? taxYearConfig.secondaryRebate : 0) +
    (age >= 75 ? taxYearConfig.tertiaryRebate : 0);
  annualTax = Math.max(0, annualTax - totalRebate);

  const periodTax = annualTax / periodsPerYear;
  return Math.round(periodTax * 100) / 100;
}

function getAge(dateOfBirth: Date): number {
  const today = new Date();
  const dob = new Date(dateOfBirth);
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

export interface UIFResult {
  employee: number;
  employer: number;
}

/** Monthly UIF ceiling prorated to the pay period. */
export function uifEarningsCeilingForPeriod(payPeriod: PayPeriod): number {
  const periodsPerYear = PERIODS_PER_YEAR[payPeriod];
  return Math.round(((UIF_EARNINGS_CEILING * 12) / periodsPerYear) * 100) / 100;
}

/**
 * Calculate UIF contributions (employee and employer portions).
 * Capped at the monthly ceiling prorated to the pay period.
 */
export function calculateUIF(grossPay: number, payPeriod: PayPeriod = "monthly"): UIFResult {
  const ceiling = uifEarningsCeilingForPeriod(payPeriod);
  const leviableAmount = Math.min(grossPay, ceiling);
  const contribution = leviableAmount * 0.01; // 1% each
  const amount = Math.round(contribution * 100) / 100;
  return { employee: amount, employer: amount };
}

/**
 * Calculate SDL (Skills Development Levy) - employer only.
 * 1% of leviable payroll, only if company exceeds R500k annual threshold.
 */
export function calculateSDL(
  totalLeviablePayroll: number,
  isSdlLiable: boolean
): number {
  if (!isSdlLiable || totalLeviablePayroll <= 0) return 0;
  const sdl = totalLeviablePayroll * 0.01;
  return Math.round(sdl * 100) / 100;
}

/**
 * Check if a company's rolling 12-month payroll exceeds SDL threshold.
 */
export function exceedsSdlThreshold(rolling12MonthPayroll: number): boolean {
  return rolling12MonthPayroll >= SDL_THRESHOLD_ANNUAL;
}
