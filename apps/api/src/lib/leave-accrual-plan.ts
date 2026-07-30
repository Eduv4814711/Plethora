/**
 * Works out which accrual entries are missing and should be posted.
 *
 * The previous runner only ever posted for the month it was invoked with, so a
 * month nobody ran was lost permanently. This planner instead computes the
 * complete set of periods between the employment anchor and `asOf`, subtracts
 * what the ledger already holds, and returns the difference. Running it twice
 * is therefore a no-op, and running it after a six-month gap back-fills all six
 * months.
 *
 * Accrual methods:
 *
 *   MONTHLY / MONTHLY_FIXED  a flat rate per calendar month.
 *   EVEN_MONTHLY             the cycle entitlement spread evenly per month.
 *   ANNUAL_GRANT             the whole cycle entitlement, granted up front.
 *   PRORATED_CYCLE_GRANT     accrues towards the cycle entitlement in
 *                            proportion to the part of the cycle actually
 *                            worked. This is the BCEA-shaped default: a
 *                            mid-cycle joiner earns a fair share, and a leaver
 *                            stops earning on their last day.
 *   DAYS_WORKED_RATIO        BCEA s20(2)(b) and s22(2): one day of leave for
 *                            every N days worked (17 annual, 26 sick).
 *
 * Pure and database-free.
 */

import {
  cycleEmploymentFraction,
  enumerateLeaveCycles,
  type LeaveCycleSpec,
  type LeaveCycleWindow,
} from "./leave-cycles.js";

export type AccrualPlanEntry = {
  /** Idempotency scope for this grant; never reused across periods. */
  periodKey: string;
  cycleKey: string;
  effectiveDate: Date;
  minutes: number;
  reason: string;
};

export type AccrualPlanInput = {
  method: string;
  spec: LeaveCycleSpec;
  /** Full-cycle entitlement, already reconciled against the statutory floor. */
  entitlementMinutes: number;
  /** Flat monthly rate for MONTHLY / MONTHLY_FIXED. */
  accrualRateMinutes?: number | null;
  /** Days worked that earn one day, for DAYS_WORKED_RATIO. */
  accrualRatioDays?: number | null;
  /** Ordinary paid minutes in one working day. */
  minutesPerShift: number;
  employedFrom: Date;
  /** Last day of employment, for a leaver. */
  employedTo?: Date | null;
  asOf: Date;
  /** Period keys already present in the ledger. */
  postedPeriodKeys: Set<string>;
  /** Minutes already accrued, by cycle key — drives top-up methods. */
  postedMinutesByCycleKey?: Map<string, number>;
  /** Days actually worked, keyed `YYYY-MM`, for the ratio method. */
  daysWorkedByMonth?: Map<string, number>;
  /**
   * Months in which accrual is suspended, keyed `YYYY-MM` — unpaid leave does
   * not earn entitlement.
   */
  suspendedMonths?: Set<string>;
};

const dateKey = (date: Date): string => date.toISOString().slice(0, 10);
const monthKey = (date: Date): string => date.toISOString().slice(0, 7);

function utcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function utcMonthEnd(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function earlier(a: Date, b: Date): Date {
  return a <= b ? a : b;
}

function later(a: Date, b: Date): Date {
  return a >= b ? a : b;
}

/** Inclusive month starts covering `[from, to]`. */
function enumerateMonths(from: Date, to: Date): Date[] {
  const months: Date[] = [];
  let cursor = utcMonthStart(from);
  const last = utcMonthStart(to);
  while (cursor <= last) {
    months.push(cursor);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return months;
}

/** The window in which this employee earns entitlement. */
function employmentWindow(input: AccrualPlanInput): { from: Date; to: Date } | null {
  const from = input.employedFrom;
  const to = input.employedTo
    ? earlier(input.employedTo, input.asOf)
    : input.asOf;
  if (to < from) return null;
  return { from, to };
}

export function buildAccrualPlan(input: AccrualPlanInput): AccrualPlanEntry[] {
  const method = input.method.trim().toUpperCase();
  const window = employmentWindow(input);
  if (!window) return [];

  const cycles = enumerateLeaveCycles(input.spec, window.from, window.to);
  if (cycles.length === 0) return [];

  switch (method) {
    case "MONTHLY":
    case "MONTHLY_FIXED":
      return planFlatMonthly(input, cycles, window, () =>
        Math.round(Number(input.accrualRateMinutes ?? 0))
      );
    case "EVEN_MONTHLY":
      return planFlatMonthly(input, cycles, window, () =>
        input.spec.cycleMonths > 0
          ? Math.round(input.entitlementMinutes / input.spec.cycleMonths)
          : 0
      );
    case "ANNUAL_GRANT":
      return planCycleGrant(input, cycles, window);
    case "PRORATED_CYCLE_GRANT":
      return planProratedCycleGrant(input, cycles, window);
    case "DAYS_WORKED_RATIO":
      return planDaysWorkedRatio(input, cycles, window);
    default:
      return [];
  }
}

/**
 * A fixed amount per calendar month.
 *
 * The period key stays `YYYY-MM`, matching what earlier runs wrote, so
 * enabling back-fill cannot re-grant a month that was already posted.
 */
function planFlatMonthly(
  input: AccrualPlanInput,
  cycles: LeaveCycleWindow[],
  window: { from: Date; to: Date },
  minutesFor: (month: Date) => number
): AccrualPlanEntry[] {
  const entries: AccrualPlanEntry[] = [];
  for (const month of enumerateMonths(window.from, window.to)) {
    const period = monthKey(month);
    if (input.postedPeriodKeys.has(period)) continue;
    if (input.suspendedMonths?.has(period)) continue;
    const minutes = minutesFor(month);
    if (minutes <= 0) continue;
    // Post on the last day of the month, or today for the month in progress,
    // so an accrual is never dated in the future.
    const effectiveDate = earlier(utcMonthEnd(month), input.asOf);
    const cycle = cycleContaining(cycles, effectiveDate);
    entries.push({
      periodKey: period,
      cycleKey: cycle.cycleKey,
      effectiveDate,
      minutes,
      reason: `${input.method} accrual for ${period}`,
    });
  }
  return entries;
}

/** The full cycle entitlement, granted once at the start of each cycle. */
function planCycleGrant(
  input: AccrualPlanInput,
  cycles: LeaveCycleWindow[],
  window: { from: Date; to: Date }
): AccrualPlanEntry[] {
  const entries: AccrualPlanEntry[] = [];
  for (const cycle of cycles) {
    const effectiveDate = later(cycle.start, window.from);
    if (effectiveDate > input.asOf) continue;
    const period = `cycle-${cycle.cycleIndex}-${dateKey(cycle.start)}`;
    if (input.postedPeriodKeys.has(period)) continue;
    if (input.entitlementMinutes <= 0) continue;
    entries.push({
      periodKey: period,
      cycleKey: cycle.cycleKey,
      effectiveDate,
      minutes: input.entitlementMinutes,
      reason: `Cycle entitlement granted for ${dateKey(cycle.start)}`,
    });
  }
  return entries;
}

/**
 * Accrue towards the cycle entitlement in proportion to the part of the cycle
 * actually worked, topped up month by month.
 *
 * Each month posts the difference between the pro-rata target at month end and
 * what the cycle has already been granted. That makes the method self-correcting:
 * a back-filled run lands on exactly the same total as a monthly one, and an
 * employee who joins or leaves mid-cycle gets a fair share rather than a full
 * grant they did not earn.
 */
function planProratedCycleGrant(
  input: AccrualPlanInput,
  cycles: LeaveCycleWindow[],
  window: { from: Date; to: Date }
): AccrualPlanEntry[] {
  const entries: AccrualPlanEntry[] = [];
  if (input.entitlementMinutes <= 0) return entries;

  for (const cycle of cycles) {
    let granted = input.postedMinutesByCycleKey?.get(cycle.cycleKey) ?? 0;
    const cycleFrom = later(cycle.start, window.from);
    const cycleTo = earlier(cycle.end, window.to);
    if (cycleTo < cycleFrom) continue;

    for (const month of enumerateMonths(cycleFrom, cycleTo)) {
      const period = `prorata:${cycle.cycleKey}:${monthKey(month)}`;
      const measuredTo = earlier(earlier(utcMonthEnd(month), cycleTo), input.asOf);
      if (measuredTo < cycleFrom) continue;

      const fraction = cycleEmploymentFraction({
        cycle,
        employedFrom: window.from,
        employedTo: measuredTo,
      });
      const target = Math.round(input.entitlementMinutes * fraction);
      const minutes = target - granted;

      if (input.postedPeriodKeys.has(period)) continue;
      if (input.suspendedMonths?.has(monthKey(month))) continue;
      if (minutes <= 0) continue;

      entries.push({
        periodKey: period,
        cycleKey: cycle.cycleKey,
        effectiveDate: measuredTo,
        minutes,
        reason: `Pro-rata cycle accrual to ${dateKey(measuredTo)}`,
      });
      granted = target;
    }
  }
  return entries;
}

/**
 * BCEA s20(2)(b) / s22(2): one day of leave for every N days worked.
 *
 * Capped at the cycle entitlement, because the ratio is an alternative way of
 * reaching the same annual amount, not a way of exceeding it.
 */
function planDaysWorkedRatio(
  input: AccrualPlanInput,
  cycles: LeaveCycleWindow[],
  window: { from: Date; to: Date }
): AccrualPlanEntry[] {
  const entries: AccrualPlanEntry[] = [];
  // Validate before clamping: a missing ratio must post nothing, not collapse
  // to "one day per one day worked" and grant a full day for every day worked.
  const rawRatio = Number(input.accrualRatioDays);
  if (!Number.isFinite(rawRatio) || rawRatio < 1) return entries;
  const ratio = Math.floor(rawRatio);
  const minutesPerDay = Math.max(0, Math.round(input.minutesPerShift));
  if (minutesPerDay <= 0) return entries;

  for (const cycle of cycles) {
    let granted = input.postedMinutesByCycleKey?.get(cycle.cycleKey) ?? 0;
    const cycleFrom = later(cycle.start, window.from);
    const cycleTo = earlier(cycle.end, window.to);
    if (cycleTo < cycleFrom) continue;

    // Days worked accumulate across the cycle so that leftovers carry from one
    // month to the next: 13 days worked in each of two months is one day of
    // leave, not none.
    let cumulativeDaysWorked = 0;
    for (const month of enumerateMonths(cycleFrom, cycleTo)) {
      const mKey = monthKey(month);
      cumulativeDaysWorked += Math.max(0, Math.floor(input.daysWorkedByMonth?.get(mKey) ?? 0));

      const period = `ratio:${cycle.cycleKey}:${mKey}`;
      const earnedDays = Math.floor(cumulativeDaysWorked / ratio);
      const uncapped = earnedDays * minutesPerDay;
      const target =
        input.entitlementMinutes > 0
          ? Math.min(uncapped, input.entitlementMinutes)
          : uncapped;
      const minutes = target - granted;

      if (input.postedPeriodKeys.has(period)) continue;
      if (input.suspendedMonths?.has(mKey)) continue;
      if (minutes <= 0) continue;

      const effectiveDate = earlier(earlier(utcMonthEnd(month), cycleTo), input.asOf);
      entries.push({
        periodKey: period,
        cycleKey: cycle.cycleKey,
        effectiveDate,
        minutes,
        reason: `One day per ${ratio} days worked, to ${dateKey(effectiveDate)}`,
      });
      granted = target;
    }
  }
  return entries;
}

function cycleContaining(cycles: LeaveCycleWindow[], date: Date): LeaveCycleWindow {
  for (const cycle of cycles) {
    if (date <= cycle.end) return cycle;
  }
  return cycles[cycles.length - 1];
}

/**
 * BCEA s22(4): in the first sick-leave cycle the entitlement that becomes
 * available after six months may be reduced by the sick days already taken
 * during those first six months.
 *
 * Returns the entitlement to use for the remainder of the first cycle.
 */
export function firstCycleSickEntitlementMinutes(params: {
  fullCycleEntitlementMinutes: number;
  minutesTakenInFirstSixMonths: number;
}): number {
  return Math.max(
    0,
    params.fullCycleEntitlementMinutes - Math.max(0, params.minutesTakenInFirstSixMonths)
  );
}
