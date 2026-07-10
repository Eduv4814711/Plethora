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

/**
 * Day shift: 06:00–18:00 in company timezone.
 * Night shift: 18:00–06:00 (next day) in company timezone.
 */
export function getShiftTimes(
  date: Date,
  shiftType: "day" | "night",
  timeZone: string
): { shiftStart: Date; shiftEnd: Date } {
  if (shiftType === "night") {
    return {
      shiftStart: localTimeInZone(date, 18, 0, timeZone),
      shiftEnd: localTimeInZone(addDays(date, 1), 6, 0, timeZone),
    };
  }
  return {
    shiftStart: localTimeInZone(date, 6, 0, timeZone),
    shiftEnd: localTimeInZone(date, 18, 0, timeZone),
  };
}

/**
 * Infer day vs night from shift start time using company timezone.
 * Canonical boundary: night starts at 18:00, day at 06:00 (matches getShiftTimes).
 */
export function inferShiftTypeFromStartTime(startTime: Date, timeZone: string): "day" | "night" {
  const z = toZonedTime(startTime, timeZone);
  const minutes = z.getHours() * 60 + z.getMinutes();
  return minutes >= 18 * 60 || minutes < 6 * 60 ? "night" : "day";
}
