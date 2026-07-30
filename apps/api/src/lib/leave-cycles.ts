/**
 * Entitlement cycles for South African leave.
 *
 * The BCEA grants leave per *cycle*, not per calendar year, and every cycle is
 * anchored to the individual employee's employment start date:
 *
 *   - annual leave  — 12-month cycle (s20), plus a six-month grace period in
 *                     which the leave must still be granted (s20(4)). Leave not
 *                     taken by the end of that grace period is forfeited, which
 *                     is the 18-month window confirmed in Jooste v Kohler
 *                     Packaging and Hartley v SMD Trading Group.
 *   - sick leave    — 36-month cycle (s22) with no grace period and no
 *                     carry-over: the balance resets on the cycle boundary.
 *   - family resp.  — 12-month cycle (s27), no grace period.
 *
 * Everything here is pure UTC date arithmetic on midnight-normalised dates so
 * it can be unit-tested without a database, and so it agrees with the
 * `YYYY-MM-DD` date keys the rest of the leave module works in.
 */

/** A single entitlement cycle for one employee and one leave type. */
export type LeaveCycleWindow = {
  /** 0 for the first cycle from the anchor; never negative. */
  cycleIndex: number;
  /**
   * Stable identifier stamped onto every ledger entry so accrual, consumption,
   * carry-over and forfeiture can be attributed to the cycle that granted them.
   */
  cycleKey: string;
  /** First day of the cycle, inclusive. */
  start: Date;
  /** Last day of the cycle, inclusive. */
  end: Date;
  /**
   * Last day on which leave from this cycle may still be taken, inclusive.
   * Equals `end` when the leave type has no grace period.
   */
  graceEnd: Date;
};

export type LeaveCycleSpec = {
  /** Leave type code, e.g. "annual". Namespaces the cycle key. */
  leaveTypeCode: string;
  /** Employment anchor — employment term start, else commencement date. */
  anchor: Date;
  /** Cycle length in months. Must be positive. */
  cycleMonths: number;
  /** BCEA s20(4)-style grace months after the cycle end. Defaults to 0. */
  graceMonths?: number;
};

export class LeaveCycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaveCycleError";
  }
}

/** Midnight-UTC date key, matching `formatLeaveDateKey`. */
function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toUtcMidnight(date: Date): Date {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new LeaveCycleError("Invalid date supplied to the leave cycle engine");
  }
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

/**
 * Add whole months in UTC, clamping to the last day of the target month.
 *
 * An employee who started on 31 January must not have their cycle boundary
 * silently roll into March, so 31 Jan + 1 month is 28/29 February.
 */
export function addUtcMonths(date: Date, months: number): Date {
  const base = toUtcMidnight(date);
  const targetMonthStart = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1)
  );
  const daysInTargetMonth = new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth() + 1,
      0
    )
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth(),
      Math.min(base.getUTCDate(), daysInTargetMonth)
    )
  );
}

function addUtcDays(date: Date, days: number): Date {
  const base = toUtcMidnight(date);
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + days)
  );
}

function assertSpec(spec: LeaveCycleSpec): void {
  if (!Number.isInteger(spec.cycleMonths) || spec.cycleMonths <= 0) {
    throw new LeaveCycleError(
      `Leave cycle length must be a positive whole number of months (got ${spec.cycleMonths})`
    );
  }
  const grace = spec.graceMonths ?? 0;
  if (!Number.isInteger(grace) || grace < 0) {
    throw new LeaveCycleError(
      `Leave cycle grace period must be zero or a positive whole number of months (got ${grace})`
    );
  }
}

/** Build the cycle at a given index without needing an `asOf` date. */
export function buildLeaveCycle(
  spec: LeaveCycleSpec,
  cycleIndex: number
): LeaveCycleWindow {
  assertSpec(spec);
  const index = Math.max(0, Math.trunc(cycleIndex));
  const anchor = toUtcMidnight(spec.anchor);
  const start = addUtcMonths(anchor, index * spec.cycleMonths);
  // The cycle ends the day before the next cycle opens, so consecutive cycles
  // tile the calendar with no gap and no overlap.
  const end = addUtcDays(addUtcMonths(anchor, (index + 1) * spec.cycleMonths), -1);
  const graceEnd = addUtcMonths(end, spec.graceMonths ?? 0);
  return {
    cycleIndex: index,
    cycleKey: `${spec.leaveTypeCode}:${index}:${dateKey(start)}`,
    start,
    end,
    graceEnd,
  };
}

/**
 * Index of the cycle containing `asOf`.
 *
 * Dates before the anchor clamp to cycle 0: leave cannot be captured before
 * commencement anyway, and clamping keeps the caller free of negative indexes.
 */
export function leaveCycleIndexAt(spec: LeaveCycleSpec, asOf: Date): number {
  assertSpec(spec);
  const anchor = toUtcMidnight(spec.anchor);
  const target = toUtcMidnight(asOf);
  if (target < anchor) return 0;

  let elapsedMonths =
    (target.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (target.getUTCMonth() - anchor.getUTCMonth());
  // A partial month has not completed until the anniversary day is reached.
  if (target.getUTCDate() < anchor.getUTCDate()) elapsedMonths -= 1;
  return Math.max(0, Math.floor(elapsedMonths / spec.cycleMonths));
}

/** The cycle containing `asOf`. */
export function resolveLeaveCycle(
  spec: LeaveCycleSpec,
  asOf: Date
): LeaveCycleWindow {
  return buildLeaveCycle(spec, leaveCycleIndexAt(spec, asOf));
}

/**
 * Every cycle that overlaps `[from, to]`, oldest first.
 *
 * Used by the balance reader (to bucket the ledger), the accrual catch-up
 * runner (to find periods that were never posted) and the cycle-close runner
 * (to find cycles whose grace period has lapsed).
 */
export function enumerateLeaveCycles(
  spec: LeaveCycleSpec,
  from: Date,
  to: Date
): LeaveCycleWindow[] {
  assertSpec(spec);
  const rangeStart = toUtcMidnight(from);
  const rangeEnd = toUtcMidnight(to);
  if (rangeEnd < rangeStart) return [];

  const firstIndex = leaveCycleIndexAt(spec, rangeStart);
  const lastIndex = leaveCycleIndexAt(spec, rangeEnd);
  const cycles: LeaveCycleWindow[] = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    cycles.push(buildLeaveCycle(spec, index));
  }
  return cycles;
}

/**
 * Cycles whose grace period closed on or before `asOf` — i.e. those ready to
 * have their unused balance carried over or forfeited.
 *
 * The current cycle is never returned, even when `graceMonths` is zero, because
 * a cycle cannot be closed while it is still running.
 */
export function closableLeaveCycles(
  spec: LeaveCycleSpec,
  asOf: Date
): LeaveCycleWindow[] {
  assertSpec(spec);
  const currentIndex = leaveCycleIndexAt(spec, asOf);
  const target = toUtcMidnight(asOf);
  const closable: LeaveCycleWindow[] = [];
  for (let index = 0; index < currentIndex; index += 1) {
    const cycle = buildLeaveCycle(spec, index);
    if (cycle.graceEnd < target) closable.push(cycle);
  }
  return closable;
}

/**
 * Fraction of a cycle an employee was actually employed for, in [0, 1].
 *
 * Drives pro-rated entitlement for mid-cycle joiners and leavers, which is how
 * BCEA s40 arrives at the pro-rata portion payable for the incomplete cycle in
 * which employment ends.
 */
export function cycleEmploymentFraction(params: {
  cycle: LeaveCycleWindow;
  employedFrom: Date;
  employedTo?: Date | null;
}): number {
  const cycleStart = toUtcMidnight(params.cycle.start);
  const cycleEnd = toUtcMidnight(params.cycle.end);
  const from = toUtcMidnight(params.employedFrom);
  const to = params.employedTo ? toUtcMidnight(params.employedTo) : null;

  const effectiveStart = from > cycleStart ? from : cycleStart;
  const effectiveEnd = to && to < cycleEnd ? to : cycleEnd;
  if (effectiveEnd < effectiveStart) return 0;

  const dayMs = 86_400_000;
  const cycleDays = (cycleEnd.getTime() - cycleStart.getTime()) / dayMs + 1;
  const employedDays =
    (effectiveEnd.getTime() - effectiveStart.getTime()) / dayMs + 1;
  if (cycleDays <= 0) return 0;
  return Math.min(1, Math.max(0, employedDays / cycleDays));
}
