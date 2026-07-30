/**
 * Per-shift weekday cover for a site — the web-side mirror of the API's
 * `site-coverage-days` helpers. Days are JS day-of-week numbers (0=Sunday … 6=Saturday).
 */

export const ALL_WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Index by day-of-week number, so `DAY_LABELS[1] === "Mon"`. */
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Monday-first display order — how South African rosters are read. */
export const DISPLAY_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Coerce arbitrary input to a clean, sorted, deduped set of weekday numbers. */
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

/** An unset column means the site predates this feature and keeps seven-day cover. */
export function coverageDaysOrAllWeek(value: number[] | null | undefined): number[] {
  return value == null ? [...ALL_WEEK_DAYS] : normalizeCoverageDays(value);
}

export function toggleCoverageDay(days: number[], day: number): number[] {
  return days.includes(day)
    ? days.filter((d) => d !== day)
    : normalizeCoverageDays([...days, day]);
}

/**
 * True when `days` includes the weekday of a `YYYY-MM-DD` date key.
 * The key is read as a UTC calendar date, matching how the roster grids build their columns.
 */
export function isCoveredOnDateKey(days: number[], dateKey: string): boolean {
  const date = new Date(`${dateKey.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return true;
  return days.includes(date.getUTCDay());
}

/** Human label, e.g. "Mon–Fri", "Mon, Wed, Fri", "Every day". */
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
      lastRun != null &&
      prevIndex >= 0 &&
      lastRun[lastRun.length - 1] === DISPLAY_DAY_ORDER[prevIndex];
    if (isConsecutive) lastRun.push(d);
    else runs.push([d]);
  }

  return runs
    .map((run) =>
      run.length >= 3
        ? `${DAY_LABELS[run[0]]}–${DAY_LABELS[run[run.length - 1]]}`
        : run.map((d) => DAY_LABELS[d]).join(", ")
    )
    .join(", ");
}

/** True when the shift needs guards and has at least one weekday to cover. */
export function shiftRuns(guardsRequired: number, days: number[]): boolean {
  return guardsRequired > 0 && days.length > 0;
}
