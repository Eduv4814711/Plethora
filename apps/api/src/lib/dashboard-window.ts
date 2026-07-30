import { addDays, addHours } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { dateKeyInTimeZone, parseDateOnly } from "./timezone.js";

/** Ranges the dashboard date toggle can request. */
export const DASHBOARD_RANGES = ["today", "week", "month"] as const;

export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

/** Granularity the time-series buckets use for a given range. */
export type DashboardBucket = "hour" | "day";

export interface DashboardWindow {
  range: DashboardRange;
  /** Inclusive lower bound: the UTC instant of local midnight on the first day. */
  start: Date;
  /** Exclusive upper bound. */
  end: Date;
  bucket: DashboardBucket;
}

function isDashboardRange(value: string | undefined): value is DashboardRange {
  return (DASHBOARD_RANGES as readonly string[]).includes(value ?? "");
}

/**
 * UTC instant of local midnight for a calendar date given as yyyy-MM-dd.
 *
 * Uses the *string* form of `fromZonedTime` deliberately: passing a Date makes
 * date-fns-tz read that Date's system-local components, which silently turns
 * the conversion into a no-op whenever the server clock already matches the
 * target zone. The string form has no such dependency on the host timezone.
 */
export function zonedMidnight(dateKey: string, timeZone: string): Date {
  return fromZonedTime(`${dateKey}T00:00:00`, timeZone);
}

/** Shift a yyyy-MM-dd key by whole days, staying on the calendar. */
function shiftDateKey(dateKey: string, days: number): string {
  const shifted = addDays(parseDateOnly(dateKey), days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Resolve the dashboard's `dateRange` query param into a concrete window.
 *
 * Boundaries are computed in the company timezone (not the server's), so a
 * UTC-hosted API still buckets a South African day correctly. Unknown or
 * missing input falls back to "month", matching the web client's default.
 */
export function resolveDashboardWindow(
  raw: string | undefined,
  now: Date,
  timeZone: string
): DashboardWindow {
  const range: DashboardRange = isDashboardRange(raw) ? raw : "month";

  // The calendar date `now` falls on *in the company's timezone*.
  const todayKey = dateKeyInTimeZone(now, timeZone);

  if (range === "today") {
    return {
      range,
      start: zonedMidnight(todayKey, timeZone),
      end: zonedMidnight(shiftDateKey(todayKey, 1), timeZone),
      bucket: "hour",
    };
  }

  if (range === "week") {
    // ISO week: Monday-based. parseDateOnly yields UTC midnight, so getUTCDay()
    // reads the calendar weekday without server-timezone interference.
    const dow = (parseDateOnly(todayKey).getUTCDay() + 6) % 7;
    const weekStartKey = shiftDateKey(todayKey, -dow);
    return {
      range,
      start: zonedMidnight(weekStartKey, timeZone),
      end: zonedMidnight(shiftDateKey(weekStartKey, 7), timeZone),
      bucket: "day",
    };
  }

  // month: the current calendar month, in company-local time.
  const [year, month] = todayKey.split("-").map(Number);
  const monthStartKey = `${todayKey.slice(0, 7)}-01`;
  const nextMonthKey =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return {
    range,
    start: zonedMidnight(monthStartKey, timeZone),
    end: zonedMidnight(nextMonthKey, timeZone),
    bucket: "day",
  };
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Bucket key for an instant, in the company timezone.
 * Must stay byte-identical to the `to_char` format used in the SQL below —
 * `'YYYY-MM-DD HH24'` for hourly buckets, `'YYYY-MM-DD'` for daily.
 */
export function bucketKey(instant: Date, timeZone: string, bucket: DashboardBucket): string {
  const dayKey = dateKeyInTimeZone(instant, timeZone);
  if (bucket === "day") return dayKey;
  const hour = String(toZonedTime(instant, timeZone).getHours()).padStart(2, "0");
  return `${dayKey} ${hour}`;
}

/** The `to_char` pattern Postgres must use to produce keys matching `bucketKey`. */
export function bucketFormat(bucket: DashboardBucket): string {
  return bucket === "day" ? "YYYY-MM-DD" : "YYYY-MM-DD HH24";
}

/**
 * Every bucket in the window, in order, with the axis label the chart should
 * show. Used to zero-fill so a quiet period renders as a flat line rather
 * than a gap.
 */
export function enumerateBuckets(
  window: DashboardWindow,
  timeZone: string
): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const step = window.bucket === "hour" ? addHours : addDays;
  // Guard against a pathological window producing an unbounded loop.
  const maxBuckets = window.bucket === "hour" ? 48 : 62;

  for (
    let cursor = window.start;
    cursor < window.end && out.length < maxBuckets;
    cursor = step(cursor, 1)
  ) {
    const zoned = toZonedTime(cursor, timeZone);
    let label: string;
    if (window.bucket === "hour") {
      label = `${String(zoned.getHours()).padStart(2, "0")}:00`;
    } else if (window.range === "week") {
      label = WEEKDAY_LABELS[zoned.getDay()];
    } else {
      label = String(zoned.getDate());
    }
    out.push({ key: bucketKey(cursor, timeZone, window.bucket), label });
  }

  return out;
}
