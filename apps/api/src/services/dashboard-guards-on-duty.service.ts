import { addDays, startOfDay } from "date-fns";
import { prisma } from "../lib/prisma.js";
import { dateKeyInTimeZone } from "../lib/timezone.js";

/** Attendance statuses that mean a guard was on post (incl. partial capture). */
export const ON_DUTY_ATTENDANCE_STATUSES = [
  "present",
  "late",
  "left_early",
  "reliever",
  "shift_swapped",
  "training",
] as const;

/** Row approval states where attendance has been captured or partially signed off. */
export const CAPTURED_APPROVAL_STATUSES = [
  "partially_reviewed",
  "reviewed",
  "approved",
] as const;

function guardIdFromRow(row: {
  actualGuardId: string | null;
  plannedGuardId: string | null;
}): string | null {
  return row.actualGuardId ?? row.plannedGuardId;
}

/**
 * The seven yyyy-MM-dd keys of the week beginning at `weekStart`.
 * `weekStart` is the UTC instant of local midnight on the Monday.
 */
function weekDayKeys(weekStart: Date, timeZone: string): string[] {
  return Array.from({ length: 7 }, (_, i) =>
    dateKeyInTimeZone(addDays(weekStart, i), timeZone)
  );
}

/**
 * Bucket a true instant (clock-in, shift start) by the calendar day it falls
 * on *in the company's timezone*. Using the server's local day here would
 * shift evening clock-ins into the wrong column on a UTC-hosted API.
 */
function dayIndexForInstant(dayKeys: string[], instant: Date, timeZone: string): number {
  return dayKeys.indexOf(dateKeyInTimeZone(instant, timeZone));
}

/**
 * Bucket a date-only column (`workDate`, stored at UTC midnight). These carry
 * no time-of-day, so they must be read from their UTC components — converting
 * them into a timezone would slide them onto the adjacent day.
 */
function dayIndexForDateOnly(dayKeys: string[], workDate: Date): number {
  return dayKeys.indexOf(workDate.toISOString().slice(0, 10));
}

function isCapturedTimesheetRow(row: {
  approvalStatus: string;
  clockIn: Date | null;
  attendanceStatus: string;
}): boolean {
  if (!(ON_DUTY_ATTENDANCE_STATUSES as readonly string[]).includes(row.attendanceStatus)) {
    return false;
  }
  if ((CAPTURED_APPROVAL_STATUSES as readonly string[]).includes(row.approvalStatus)) {
    return true;
  }
  return row.clockIn != null;
}

type SiteFilter = { siteIds?: string[] };

/**
 * Guards currently on duty: open clock-in (no clock-out) on an in-progress shift,
 * plus site timesheet rows with open clock-in during partial approval capture.
 */
export async function getGuardsOnDutyNow(
  companyId: string,
  now: Date,
  { siteIds }: SiteFilter = {}
): Promise<number> {
  const onDuty = new Set<string>();

  const openAttendance = await prisma.attendance.findMany({
    where: {
      clockIn: { not: null },
      clockOut: null,
      shift: {
        companyId,
        startTime: { lte: now },
        endTime: { gte: now },
        ...(siteIds?.length ? { siteId: { in: siteIds } } : {}),
      },
    },
    select: { shift: { select: { employeeId: true } } },
  });
  for (const row of openAttendance) {
    onDuty.add(row.shift.employeeId);
  }

  const windowStart = addDays(startOfDay(now), -1);
  const windowEnd = addDays(startOfDay(now), 2);

  const openTimesheetRows = await prisma.siteTimesheetRow.findMany({
    where: {
      companyId,
      clockIn: { not: null },
      clockOut: null,
      workDate: { gte: windowStart, lt: windowEnd },
      attendanceStatus: { in: [...ON_DUTY_ATTENDANCE_STATUSES] },
      ...(siteIds?.length ? { siteId: { in: siteIds } } : {}),
      OR: [
        { approvalStatus: { in: [...CAPTURED_APPROVAL_STATUSES] } },
        { approvalStatus: "pending" },
      ],
    },
    select: {
      actualGuardId: true,
      plannedGuardId: true,
      clockIn: true,
    },
  });

  for (const row of openTimesheetRows) {
    if (!row.clockIn || row.clockIn > now) continue;
    const guardId = guardIdFromRow(row);
    if (guardId) onDuty.add(guardId);
  }

  return onDuty.size;
}

/**
 * Distinct guards on duty per day (Mon–Sun) for the current week.
 * Uses site timesheet attendance (incl. partially approved rows) with attendance fallback.
 */
export async function getGuardsOnDutyByDay(
  companyId: string,
  weekStart: Date,
  dayNames: string[],
  timeZone: string,
  { siteIds }: SiteFilter = {}
): Promise<{ name: string; value: number }[]> {
  const weekEnd = addDays(weekStart, 7);
  const dayKeys = weekDayKeys(weekStart, timeZone);
  const guardsByDay = new Map<number, Set<string>>();
  for (let i = 0; i < 7; i++) guardsByDay.set(i, new Set());

  const timesheetRows = await prisma.siteTimesheetRow.findMany({
    where: {
      companyId,
      workDate: { gte: weekStart, lt: weekEnd },
      attendanceStatus: { in: [...ON_DUTY_ATTENDANCE_STATUSES] },
      ...(siteIds?.length ? { siteId: { in: siteIds } } : {}),
    },
    select: {
      workDate: true,
      actualGuardId: true,
      plannedGuardId: true,
      approvalStatus: true,
      clockIn: true,
      attendanceStatus: true,
    },
  });

  for (const row of timesheetRows) {
    if (!isCapturedTimesheetRow(row)) continue;
    const guardId = guardIdFromRow(row);
    if (!guardId) continue;
    const index = dayIndexForDateOnly(dayKeys, row.workDate);
    if (index >= 0) guardsByDay.get(index)!.add(guardId);
  }

  const attendanceInWeek = await prisma.attendance.findMany({
    where: {
      clockIn: { not: null },
      shift: {
        companyId,
        startTime: { lt: weekEnd },
        endTime: { gte: weekStart },
        ...(siteIds?.length ? { siteId: { in: siteIds } } : {}),
      },
    },
    select: {
      clockIn: true,
      shift: { select: { employeeId: true, startTime: true } },
    },
  });

  for (const row of attendanceInWeek) {
    if (!row.clockIn) continue;
    const index = dayIndexForInstant(dayKeys, row.clockIn, timeZone);
    if (index >= 0) {
      guardsByDay.get(index)!.add(row.shift.employeeId);
      continue;
    }
    const shiftIndex = dayIndexForInstant(dayKeys, row.shift.startTime, timeZone);
    if (shiftIndex >= 0) guardsByDay.get(shiftIndex)!.add(row.shift.employeeId);
  }

  return dayNames.map((name, index) => ({
    name,
    value: guardsByDay.get(index)?.size ?? 0,
  }));
}
