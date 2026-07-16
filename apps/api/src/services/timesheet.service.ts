import { toZonedTime } from "date-fns-tz";
import { prisma } from "../lib/prisma.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../lib/timezone.js";

export interface TimesheetAggregate {
  employeeId: string;
  basicHours: number;
  overtimeHours: number;
  sundayHours: number;
  publicHolidayHours: number;
  /** Derived from leave hours (hours / 8) for display and legacy consumers. */
  leaveDays: number;
  /** Actual paid leave hours from LeaveRecord entries in the period. */
  leaveHours: number;
}

/** Maximum leave hours accepted per single leave record (guards against bad data). */
export const MAX_LEAVE_HOURS_PER_RECORD = 24;

/**
 * Sum leave hours from records, ignoring invalid entries.
 */
export function sumLeaveHoursFromRecords(
  records: Array<{ employeeId: string; hours: unknown }>
): Map<string, number> {
  const employeeLeaveHours = new Map<string, number>();
  for (const lr of records) {
    const hours = Number(lr.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_LEAVE_HOURS_PER_RECORD) {
      continue;
    }
    const current = employeeLeaveHours.get(lr.employeeId) ?? 0;
    employeeLeaveHours.set(lr.employeeId, current + hours);
  }
  return employeeLeaveHours;
}

/**
 * Classify worked hours by shift start date in company timezone.
 * Overnight shifts use the calendar day of shift start (not clock-out day).
 */
export function classifyShiftHours(params: {
  shiftStartTime: Date;
  hoursWorked: number;
  overtimeHours: number;
  timeZone: string;
  holidayDates: Set<string>;
}): { basicHours: number; overtimeHours: number; sundayHours: number; publicHolidayHours: number } {
  const { shiftStartTime, hoursWorked, overtimeHours, timeZone, holidayDates } = params;
  const shiftStartZoned = toZonedTime(shiftStartTime, timeZone);
  const y = shiftStartZoned.getFullYear();
  const m = String(shiftStartZoned.getMonth() + 1).padStart(2, "0");
  const d = String(shiftStartZoned.getDate()).padStart(2, "0");
  const shiftDateKey = `${y}-${m}-${d}`;
  const isSunday = shiftStartZoned.getDay() === 0;
  const isPublicHoliday = holidayDates.has(shiftDateKey);
  const total = hoursWorked + overtimeHours;

  if (isPublicHoliday) {
    return { basicHours: 0, overtimeHours: 0, sundayHours: 0, publicHolidayHours: total };
  }
  if (isSunday) {
    return { basicHours: 0, overtimeHours: 0, sundayHours: total, publicHolidayHours: 0 };
  }
  return { basicHours: hoursWorked, overtimeHours, sundayHours: 0, publicHolidayHours: 0 };
}

/**
 * Aggregate hours from Shift + Attendance for a period.
 * Classifies hours into basic, overtime, sunday, public holiday using company timezone.
 */
export async function aggregateTimesheets(
  companyId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<TimesheetAggregate[]> {
  const timeZone = await getCompanyTimezone(companyId);

  const holidayDates = new Set<string>();
  const holidays = await prisma.publicHoliday.findMany({
    where: {
      companyId,
      date: { gte: periodStart, lte: periodEnd },
    },
  });
  for (const h of holidays) {
    holidayDates.add(dateKeyInTimeZone(new Date(h.date), timeZone));
  }

  const approvedSiteRows = await prisma.siteTimesheetRow.findMany({
    where: {
      companyId,
      workDate: { gte: periodStart, lte: periodEnd },
      actualGuardId: { not: null },
      siteTimesheet: { status: { in: ["approved", "locked"] } },
      attendanceStatus: {
        in: ["present", "late", "left_early", "reliever", "shift_swapped", "leave", "sick_leave", "training"],
      },
    },
  });

  // Per-site aggregation: a site contributes hours either through its approved/locked
  // site timesheet rows OR through raw shift attendance — never both. This avoids the
  // legacy all-or-nothing switch where one approved site disabled raw attendance for all.
  // Approved or locked site timesheets are the sole payroll authority. Raw
  // attendance feeds capture and exception workflows, never payroll directly.

  const leaveRecords = await prisma.leaveRecord.findMany({
    where: {
      employee: { companyId },
      date: { gte: periodStart, lte: periodEnd },
      voidedAt: null,
    },
  });

  const employeeLeaveHours = sumLeaveHoursFromRecords(leaveRecords);

  const totals = new Map<
    string,
    { basicHours: number; overtimeHours: number; sundayHours: number; publicHolidayHours: number }
  >();

  for (const row of approvedSiteRows) {
    const empId = row.actualGuardId;
    if (!empId) continue;
    if (!totals.has(empId)) {
      totals.set(empId, {
        basicHours: 0,
        overtimeHours: 0,
        sundayHours: 0,
        publicHolidayHours: 0,
      });
    }
    const t = totals.get(empId)!;
    const hoursWorked = row.hoursWorked != null ? Number(row.hoursWorked) : row.attendanceStatus === "leave" || row.attendanceStatus === "sick_leave" || row.attendanceStatus === "training" ? 8 : 0;
    const overtimeHours = row.overtimeHours != null ? Number(row.overtimeHours) : 0;
    const bucket = classifyShiftHours({
      shiftStartTime: row.clockIn ?? row.workDate,
      hoursWorked,
      overtimeHours,
      timeZone,
      holidayDates,
    });
    t.basicHours += bucket.basicHours;
    t.overtimeHours += bucket.overtimeHours;
    t.sundayHours += bucket.sundayHours;
    t.publicHolidayHours += bucket.publicHolidayHours;
  }

  const result: TimesheetAggregate[] = [];
  const seen = new Set<string>();

  for (const [employeeId, t] of totals) {
    seen.add(employeeId);
    const leaveHours = Math.round((employeeLeaveHours.get(employeeId) ?? 0) * 100) / 100;
    result.push({
      employeeId,
      basicHours: Math.round(t.basicHours * 100) / 100,
      overtimeHours: Math.round(t.overtimeHours * 100) / 100,
      sundayHours: Math.round(t.sundayHours * 100) / 100,
      publicHolidayHours: Math.round(t.publicHolidayHours * 100) / 100,
      leaveHours,
      leaveDays: Math.round((leaveHours / 8) * 100) / 100,
    });
  }

  // Include approved leave for employees with no attendance shifts in the period.
  for (const [employeeId, leaveHoursRaw] of employeeLeaveHours) {
    if (seen.has(employeeId) || leaveHoursRaw <= 0) continue;
    const leaveHours = Math.round(leaveHoursRaw * 100) / 100;
    result.push({
      employeeId,
      basicHours: 0,
      overtimeHours: 0,
      sundayHours: 0,
      publicHolidayHours: 0,
      leaveHours,
      leaveDays: Math.round((leaveHours / 8) * 100) / 100,
    });
  }

  return result;
}
