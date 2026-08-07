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

/** What a site runs on the labels the roster and attendance screens read. */
export const NO_SHIFT_LABEL = "No Shift";

export type ShiftCoverageDays = { day: number[]; night: number[] };

/** Read a site config's two stored day lists into the shape the grids consume. */
export function resolveShiftCoverageDays(site: {
  rosterDayShiftDays?: number[] | null;
  rosterNightShiftDays?: number[] | null;
}): ShiftCoverageDays {
  return {
    day: coverageDaysOrAllWeek(site.rosterDayShiftDays),
    night: coverageDaysOrAllWeek(site.rosterNightShiftDays),
  };
}

export type DateShiftCoverage = { day: boolean; night: boolean; anyShift: boolean };

/** Which shifts a site runs on a `YYYY-MM-DD` date. */
export function shiftCoverageOnDateKey(
  coverage: ShiftCoverageDays,
  dateKey: string
): DateShiftCoverage {
  const day = isCoveredOnDateKey(coverage.day, dateKey);
  const night = isCoveredOnDateKey(coverage.night, dateKey);
  return { day, night, anyShift: day || night };
}

/**
 * True when the date runs nothing the viewer is looking at — either no shift at all, or
 * none of the single shift they have filtered to. Those days read as "No Shift".
 */
export function isNoShiftDateKey(
  coverage: ShiftCoverageDays,
  dateKey: string,
  shiftType: "all" | "day" | "night" = "all"
): boolean {
  const covered = shiftCoverageOnDateKey(coverage, dateKey);
  if (shiftType === "day") return !covered.day;
  if (shiftType === "night") return !covered.night;
  return !covered.anyShift;
}

/** Every `YYYY-MM-DD` from `start` to `end` inclusive, read as UTC calendar dates. */
export function dateKeysInRange(start: string, end: string): string[] {
  const from = new Date(`${start.slice(0, 10)}T00:00:00.000Z`);
  const to = new Date(`${end.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return [];
  const keys: string[] = [];
  for (let d = from; d <= to; d = new Date(d.getTime() + 86_400_000)) {
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

/** Dates in the period the site does not run — the days attendance has nothing to capture. */
export function noShiftDateKeys(
  coverage: ShiftCoverageDays,
  start: string,
  end: string,
  shiftType: "all" | "day" | "night" = "all"
): string[] {
  return dateKeysInRange(start, end).filter((key) => isNoShiftDateKey(coverage, key, shiftType));
}
