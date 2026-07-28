/**
 * SARS tax brackets and rebates for South Africa.
 * Tax year: 1 March - 28 February.
 * Update annually when SARS publishes new rates.
 *
 * @see https://www.sars.gov.za/tax-rates/income-tax/rates-of-tax-for-individuals/
 */

export interface TaxBracket {
  min: number; // threshold above which this rate applies
  max: number;
  rate: number; // as decimal, e.g. 0.18
  baseTax: number; // tax on income up to min (exclusive)
}

export interface TaxYearConfig {
  year: number; // e.g. 2025 for 2025/2026 tax year
  brackets: TaxBracket[];
  primaryRebate: number;
  secondaryRebate: number; // ages 65-74
  tertiaryRebate: number; // ages 75+
  thresholdUnder65: number;
  threshold65to74: number;
  threshold75Plus: number;
  /**
   * True when these figures are carried forward from the previous year rather than
   * confirmed against a published SARS table. PAYE still calculates, but the payroll
   * snapshot records the fact so a run is never silently filed on unverified rates.
   */
  provisional?: boolean;
}

/**
 * 2025/2026 tax year (1 March 2025 - 28 February 2026)
 */
export const TAX_YEAR_2025_2026: TaxYearConfig = {
  year: 2025,
  brackets: [
    { min: 0, max: 237_100, rate: 0.18, baseTax: 0 },
    { min: 237_100, max: 370_500, rate: 0.26, baseTax: 42_678 },
    { min: 370_500, max: 512_800, rate: 0.31, baseTax: 77_362 },
    { min: 512_800, max: 673_000, rate: 0.36, baseTax: 121_475 },
    { min: 673_000, max: 857_900, rate: 0.39, baseTax: 179_147 },
    { min: 857_900, max: 1_817_000, rate: 0.41, baseTax: 251_258 },
    { min: 1_817_000, max: Infinity, rate: 0.45, baseTax: 644_489 },
  ],
  primaryRebate: 17_235,
  secondaryRebate: 9_444,
  tertiaryRebate: 3_145,
  thresholdUnder65: 95_750,
  threshold65to74: 148_217,
  threshold75Plus: 165_689,
};

/**
 * 2026/2027 tax year (1 March 2026 - 28 February 2027)
 *
 * PROVISIONAL — these are the 2025/2026 figures carried forward. They have NOT been
 * checked against a published SARS table for 2026/2027. Replace the numbers below with
 * the official rates and delete `provisional` once confirmed; if Budget 2026 left the
 * tables unchanged, delete `provisional` and keep the values as they are.
 */
export const TAX_YEAR_2026_2027: TaxYearConfig = {
  ...TAX_YEAR_2025_2026,
  year: 2026,
  provisional: true,
};

/** Every known tax year, keyed by starting calendar year (2025 = 2025/2026). */
export const TAX_YEARS: Record<number, TaxYearConfig> = {
  2025: TAX_YEAR_2025_2026,
  2026: TAX_YEAR_2026_2027,
};

/**
 * The SARS year of assessment a date falls in, as its starting calendar year.
 * The tax year runs 1 March - end February, so January 2026 is still the 2025 year.
 * Uses UTC so the same stored period date always resolves to the same tax year.
 */
export function taxYearStartingYearForDate(date: Date): number {
  // getUTCMonth() is zero-based: 2 = March.
  return date.getUTCMonth() >= 2 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

/** Last day of the year of assessment (end of February in the following year). */
export function taxYearEndDate(startingYear: number): Date {
  // Day 0 of March rolls back to the last day of February, leap years included.
  return new Date(Date.UTC(startingYear + 1, 2, 0));
}

/**
 * Tax tables applying to a payroll period. Falls back to the most recent configured
 * year so a run in an unconfigured future year still calculates rather than throwing —
 * the resulting config is flagged `provisional` for the payroll snapshot to surface.
 */
export function resolveTaxYearConfig(date: Date): TaxYearConfig {
  const startingYear = taxYearStartingYearForDate(date);
  const exact = TAX_YEARS[startingYear];
  if (exact) return exact;

  const configuredYears = Object.keys(TAX_YEARS).map(Number);
  const latest = Math.max(...configuredYears);
  const earliest = Math.min(...configuredYears);
  const fallback = TAX_YEARS[startingYear > latest ? latest : earliest]!;
  return { ...fallback, year: startingYear, provisional: true };
}

/** UIF earnings ceiling per month (2025) */
export const UIF_EARNINGS_CEILING = 17_712;

/** SDL registration threshold - annual payroll above this requires SDL */
export const SDL_THRESHOLD_ANNUAL = 500_000;
