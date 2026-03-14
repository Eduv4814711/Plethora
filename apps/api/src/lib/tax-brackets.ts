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

/** UIF earnings ceiling per month (2025) */
export const UIF_EARNINGS_CEILING = 17_712;

/** SDL registration threshold - annual payroll above this requires SDL */
export const SDL_THRESHOLD_ANNUAL = 500_000;
