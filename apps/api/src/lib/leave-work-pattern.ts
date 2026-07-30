/**
 * Infers an employee's ordinary working pattern from observed roster data.
 *
 * Statutory leave is proportional to what a person ordinarily works: BCEA s20
 * grants the days worked in three weeks, s22 the days worked in six weeks. A
 * twelve-hour guard on a three-on-three-off rotation and an eight-hour
 * administrator on a five-day week are therefore entitled to different amounts,
 * and both are correct.
 *
 * `EmploymentTerm` is the authoritative source for that pattern. This is the
 * fallback for tenants that have not captured terms, and it uses real observed
 * shifts rather than an assumed contract.
 *
 * Pure and database-free.
 */

/** Days of roster history below which a rotation cannot be inferred. */
export const MIN_PATTERN_SPAN_DAYS = 21;

export type ObservedWorkPattern = {
  /** Median rostered shift length in minutes. */
  minutesPerShift: number;
  /**
   * Average distinct days worked per week, or 0 when the roster history is too
   * short to describe a rotation. Zero means "unknown", never "never works".
   */
  daysPerWeek: number;
};

/**
 * Summarise one employee's shifts.
 *
 * The median shift length is used rather than the mean so a single unusual
 * double shift cannot inflate an entitlement.
 *
 * Days per week is measured across the span the roster actually covers, not a
 * nominal lookback window. Dividing by the lookback would treat a roster
 * published four weeks ahead as if the employee had been idle for the rest of
 * it — which under-states a three-on-three-off guard several times over.
 *
 * The span ends on the last worked day, so a trailing rest period is not
 * counted and the result sits slightly above the true steady state (a
 * three-on-three-off rotation reads about 3.7 rather than 3.5). The bias is
 * small and favours the employee, which is the safe direction for a statutory
 * minimum. Capture an `EmploymentTerm` where the exact pattern matters.
 */
export function summariseWorkPattern(params: {
  /** Length of each rostered shift, in minutes. */
  shiftMinutes: number[];
  /** Distinct `YYYY-MM-DD` days on which a shift started. */
  workedDayKeys: string[];
}): ObservedWorkPattern | null {
  const lengths = params.shiftMinutes.filter(
    (minutes) => Number.isFinite(minutes) && minutes > 0
  );
  if (lengths.length === 0) return null;

  const sorted = [...lengths].sort((a, b) => a - b);
  const minutesPerShift = sorted[Math.floor(sorted.length / 2)];
  if (minutesPerShift <= 0) return null;

  const dayKeys = [...new Set(params.workedDayKeys)].sort();
  if (dayKeys.length === 0) return { minutesPerShift, daysPerWeek: 0 };

  const first = Date.parse(`${dayKeys[0]}T00:00:00.000Z`);
  const last = Date.parse(`${dayKeys[dayKeys.length - 1]}T00:00:00.000Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return { minutesPerShift, daysPerWeek: 0 };
  }

  const spanDays = (last - first) / 86_400_000 + 1;
  if (spanDays < MIN_PATTERN_SPAN_DAYS) {
    return { minutesPerShift, daysPerWeek: 0 };
  }

  // Cap at seven: a data error must never inflate a statutory entitlement.
  const daysPerWeek = Math.min(7, dayKeys.length / (spanDays / 7));
  if (!Number.isFinite(daysPerWeek) || daysPerWeek <= 0) {
    return { minutesPerShift, daysPerWeek: 0 };
  }
  return { minutesPerShift, daysPerWeek: Math.round(daysPerWeek * 100) / 100 };
}
