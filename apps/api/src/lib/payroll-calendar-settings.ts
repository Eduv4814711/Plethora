import type { PayPeriod } from "../services/tax.service.js";

export type PayrollCalendarSettings = {
  /** PAYE tax calculation frequency only — not pay-period date bounds */
  payrollPeriod: PayPeriod;
  payPeriodStartDay: number;
  payPeriodEndDay: number;
  autoRosterHorizonPeriods: number;
};

const DEFAULT_START_DAY = 26;
const DEFAULT_END_DAY = 25;

function clampDay(day: number): number {
  return Math.min(31, Math.max(1, Math.floor(day)));
}

/** Legacy: payrollRunDay 25 implied end on 25th → start 26th */
function legacyStartEndFromRunDay(runDay: number): { start: number; end: number } {
  const end = clampDay(runDay);
  const start = end >= 31 ? 1 : end + 1;
  return { start, end };
}

export function parsePayrollCalendarSettings(settings: unknown): PayrollCalendarSettings {
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const payrollPeriod = raw.payrollPeriod;
  const period: PayPeriod =
    payrollPeriod === "weekly" || payrollPeriod === "biweekly" || payrollPeriod === "monthly"
      ? payrollPeriod
      : "monthly";

  let payPeriodStartDay =
    typeof raw.payPeriodStartDay === "number" ? clampDay(raw.payPeriodStartDay) : undefined;
  let payPeriodEndDay =
    typeof raw.payPeriodEndDay === "number" ? clampDay(raw.payPeriodEndDay) : undefined;

  if (payPeriodStartDay === undefined || payPeriodEndDay === undefined) {
    const legacyRunDay = typeof raw.payrollRunDay === "number" ? raw.payrollRunDay : undefined;
    if (legacyRunDay !== undefined) {
      const mapped = legacyStartEndFromRunDay(legacyRunDay);
      payPeriodStartDay ??= mapped.start;
      payPeriodEndDay ??= mapped.end;
    }
  }

  payPeriodStartDay ??= DEFAULT_START_DAY;
  payPeriodEndDay ??= DEFAULT_END_DAY;

  const horizonRaw = raw.autoRosterHorizonPeriods;
  const autoRosterHorizonPeriods =
    typeof horizonRaw === "number" && Number.isFinite(horizonRaw)
      ? Math.min(6, Math.max(1, Math.floor(horizonRaw)))
      : 2;

  return {
    payrollPeriod: period,
    payPeriodStartDay,
    payPeriodEndDay,
    autoRosterHorizonPeriods,
  };
}
