/**
 * Per-shift weekday cover for a site.
 *
 * Not every site is a seven-day site: an office park may want day guards Monday–Friday
 * and a night guard every night. Days left out of a shift's list produce no roster demand,
 * no generated shifts, and no coverage-gap alerts for that shift on that weekday.
 *
 * Days are JS day-of-week numbers (0=Sunday … 6=Saturday), read in UTC so they agree with
 * the UTC-midnight calendar days and `YYYY-MM-DD` date keys the roster engine works in.
 */

export const ALL_WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Index by day-of-week number, so `DAY_LABELS[1] === "Mon"`. */
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Monday-first display order — how South African rosters are read. */
export const DISPLAY_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export type SiteCoverageDaysInput = {
  rosterDayShiftDays?: number[] | null;
  rosterNightShiftDays?: number[] | null;
};

export type SiteCoverageDays = {
  day: Set<number>;
  night: Set<number>;
};

/**
 * Coerce arbitrary input to a clean, sorted, deduped set of weekday numbers.
 * Non-integers and out-of-range values are dropped rather than clamped: a "7" is a
 * caller mistake, and silently folding it onto Saturday would roster a day nobody chose.
 */
export function normalizeCoverageDays(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  for (const raw of input) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 6) continue;
    seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Resolve a site's stored cover into lookup sets.
 *
 * `null`/absent means the column has never been set (sites created before this feature),
 * which keeps the old seven-day behaviour. An explicitly empty array means "this shift is
 * never covered" and is preserved as such.
 */
export function resolveSiteCoverageDays(site: SiteCoverageDaysInput): SiteCoverageDays {
  const resolve = (value: number[] | null | undefined) =>
    value == null ? new Set<number>(ALL_WEEK_DAYS) : new Set(normalizeCoverageDays(value));

  return {
    day: resolve(site.rosterDayShiftDays),
    night: resolve(site.rosterNightShiftDays),
  };
}

/** True when the given shift type needs cover on the weekday `date` falls on (UTC). */
export function isShiftCoveredOn(
  coverage: SiteCoverageDays,
  shiftType: "day" | "night",
  date: Date
): boolean {
  return coverage[shiftType].has(date.getUTCDay());
}

/**
 * True when the given shift type needs cover on a `YYYY-MM-DD` date key.
 * The key is read as a UTC calendar date, matching how the roster grids build their columns.
 */
export function isShiftCoveredOnDateKey(
  coverage: SiteCoverageDays,
  shiftType: "day" | "night",
  dateKey: string
): boolean {
  const date = new Date(`${dateKey.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return true;
  return isShiftCoveredOn(coverage, shiftType, date);
}

/** Count of calendar days in `days` that the given shift type needs covered. */
export function countCoveredDays(
  coverage: SiteCoverageDays,
  shiftType: "day" | "night",
  days: Date[]
): number {
  return days.reduce((sum, d) => sum + (isShiftCoveredOn(coverage, shiftType, d) ? 1 : 0), 0);
}

/** Calendar days on which either shift type needs cover — used for rest/off-day fairness. */
export function daysWithAnyCoverage(coverage: SiteCoverageDays, days: Date[]): Date[] {
  return days.filter(
    (d) => isShiftCoveredOn(coverage, "day", d) || isShiftCoveredOn(coverage, "night", d)
  );
}

/** Human label for messages and roster sheets, e.g. "Mon–Fri", "Mon, Wed, Fri", "Every day". */
export function describeCoverageDays(days: number[]): string {
  const normalized = normalizeCoverageDays(days);
  if (normalized.length === 0) return "No days";
  if (normalized.length === 7) return "Every day";

  const ordered = DISPLAY_DAY_ORDER.filter((d) => normalized.includes(d));
  const runs: number[][] = [];
  for (const d of ordered) {
    const lastRun = runs[runs.length - 1];
    const prevIndex = DISPLAY_DAY_ORDER.indexOf(d) - 1;
    const isConsecutive =
      lastRun != null && prevIndex >= 0 && lastRun[lastRun.length - 1] === DISPLAY_DAY_ORDER[prevIndex];
    if (isConsecutive) lastRun.push(d);
    else runs.push([d]);
  }

  return runs
    .map((run) =>
      run.length >= 3
        ? `${DAY_LABELS[run[0]!]}–${DAY_LABELS[run[run.length - 1]!]}`
        : run.map((d) => DAY_LABELS[d]).join(", ")
    )
    .join(", ");
}
