/**
 * Shared currency helpers for money that arrives from the API as decimal strings.
 * Values are kept as strings end-to-end and only converted for display.
 */

const DEFAULT_LOCALE = "en-ZA";
const DEFAULT_CURRENCY = "ZAR";

export interface FormatCurrencyOptions {
  currency?: string;
  locale?: string;
  /** Drop the cents (useful for dense summary tiles). */
  whole?: boolean;
}

/** Formats a decimal string or number as currency, falling back to a plain value if Intl rejects the code. */
export function formatCurrency(
  value: string | number | null | undefined,
  options: FormatCurrencyOptions = {}
): string {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  const safe = Number.isFinite(amount) ? amount : 0;
  const currency = options.currency?.trim() || DEFAULT_CURRENCY;
  const locale = options.locale || DEFAULT_LOCALE;
  const fractionDigits = options.whole ? 0 : 2;

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(safe);
  } catch {
    // Non-ISO currency configured (e.g. a bare symbol) — render it manually.
    return `${currency} ${safe.toFixed(fractionDigits)}`;
  }
}

/** Formats a quantity, trimming trailing zeros so "1.00" shows as "1". */
export function formatQuantity(value: string | number | null | undefined): string {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0";
  return String(Number(amount.toFixed(2)));
}

/**
 * Normalises free-text money input to something the API accepts.
 * Keeps it a string so precision is never lost to a float round-trip.
 */
export function parseDecimalInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return "0";
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? cleaned : "0";
}

/** Reads the configured currency out of the company settings object. */
export function currencyFromSettings(
  settings: { settings?: { currency?: string } | null } | null | undefined
): string | undefined {
  const code = settings?.settings?.currency;
  return typeof code === "string" && code.trim() ? code.trim() : undefined;
}

/** Sum of decimal strings, returned as a fixed-2 string. */
export function sumDecimalStrings(values: readonly (string | number)[]): string {
  const total = values.reduce<number>((sum, value) => sum + (Number(value) || 0), 0);
  return total.toFixed(2);
}
