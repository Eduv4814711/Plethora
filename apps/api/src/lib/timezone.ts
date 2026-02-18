import { fromZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import { prisma } from "./prisma.js";

const DEFAULT_TIMEZONE = "Africa/Johannesburg";

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
 */
export function localTimeInZone(
  date: Date,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
  return fromZonedTime(d, timeZone);
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
