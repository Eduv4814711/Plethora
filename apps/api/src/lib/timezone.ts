import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import { prisma } from "./prisma.js";

const DEFAULT_TIMEZONE = "Africa/Johannesburg";

/**
 * Parse a date string (yyyy-MM-dd) as UTC midnight. Avoids server timezone affecting the calendar date.
 */
export function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/**
 * Parse a date string (yyyy-MM-dd) as end of day UTC. For use as end date in ranges.
 */
export function parseDateOnlyEnd(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
}

/** Calendar date key (yyyy-MM-dd) for a timestamp in the given timezone. */
export function dateKeyInTimeZone(d: Date, timeZone: string): string {
  const z = toZonedTime(d, timeZone);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, "0");
  const day = String(z.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Get the company's timezone from settings. Falls back to Africa/Johannesburg.
 */
export async function getCompanyTimezone(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  const settings = (company?.settings as Record<string, unknown>) ?? {};
  const tz = settings.timezone as string | undefined;
  return (tz && typeof tz === "string" && tz.trim()) || DEFAULT_TIMEZONE;
}

/**
 * Create a Date in UTC that represents the given local time in the company timezone.
 * e.g. localTimeInZone(2026-02-01, 6, 0, 'Africa/Johannesburg') => 04:00 UTC (6am SA = UTC+2)
 * Uses UTC date components to avoid server timezone affecting the calendar date.
 */
export function localTimeInZone(
  date: Date,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const dUtc = new Date(Date.UTC(y, m, d, hour, minute, 0, 0));
  return fromZonedTime(dUtc, timeZone);
}

export interface SiteShiftTimeConfig {
  rosterDayShiftStartTime?: string | null;
  rosterDayShiftEndTime?: string | null;
  rosterNightShiftStartTime?: string | null;
  rosterNightShiftEndTime?: string | null;
}

export function parseHourMinute(timeStr?: string | null, defaultHour = 6, defaultMinute = 0): { hour: number; minute: number } {
  if (!timeStr) return { hour: defaultHour, minute: defaultMinute };
  const parts = timeStr.trim().split(":");
  if (parts.length >= 2) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return { hour: h, minute: m };
    }
  }
  return { hour: defaultHour, minute: defaultMinute };
}

/**
 * Day shift: default 06:00–18:00 in company timezone.
 * Night shift: default 18:00–06:00 (next day) in company timezone.
 * Site-specific shift hours are respected if configured.
 */
export function getShiftTimes(
  date: Date,
  shiftType: "day" | "night",
  timeZone: string,
  siteConfig?: SiteShiftTimeConfig | null
): { shiftStart: Date; shiftEnd: Date } {
  if (shiftType === "night") {
    const start = parseHourMinute(siteConfig?.rosterNightShiftStartTime, 18, 0);
    const end = parseHourMinute(siteConfig?.rosterNightShiftEndTime, 6, 0);
    const endsNextDay = end.hour < start.hour || (end.hour === start.hour && end.minute <= start.minute);
    return {
      shiftStart: localTimeInZone(date, start.hour, start.minute, timeZone),
      shiftEnd: localTimeInZone(endsNextDay ? addDays(date, 1) : date, end.hour, end.minute, timeZone),
    };
  }
  const start = parseHourMinute(siteConfig?.rosterDayShiftStartTime, 6, 0);
  const end = parseHourMinute(siteConfig?.rosterDayShiftEndTime, 18, 0);
  const endsNextDay = end.hour < start.hour || (end.hour === start.hour && end.minute <= start.minute);
  return {
    shiftStart: localTimeInZone(date, start.hour, start.minute, timeZone),
    shiftEnd: localTimeInZone(endsNextDay ? addDays(date, 1) : date, end.hour, end.minute, timeZone),
  };
}

/**
 * Infer day vs night from shift start time using company timezone.
 * Canonical boundary: night starts at 18:00 (or site-configured night start),
 * day at 06:00 (or site-configured day start).
 */
export function inferShiftTypeFromStartTime(
  startTime: Date,
  timeZone: string,
  siteConfig?: SiteShiftTimeConfig | null
): "day" | "night" {
  const z = toZonedTime(startTime, timeZone);
  const minutes = z.getHours() * 60 + z.getMinutes();
  const dayStart = parseHourMinute(siteConfig?.rosterDayShiftStartTime, 6, 0);
  const nightStart = parseHourMinute(siteConfig?.rosterNightShiftStartTime, 18, 0);
  const dayStartMins = dayStart.hour * 60 + dayStart.minute;
  const nightStartMins = nightStart.hour * 60 + nightStart.minute;

  if (nightStartMins > dayStartMins) {
    return minutes >= nightStartMins || minutes < dayStartMins ? "night" : "day";
  }
  return minutes >= nightStartMins && minutes < dayStartMins ? "night" : "day";
}

