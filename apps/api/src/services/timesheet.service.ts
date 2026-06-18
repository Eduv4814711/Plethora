import { toZonedTime } from "date-fns-tz";
import { prisma } from "../lib/prisma.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../lib/timezone.js";

export interface TimesheetAggregate {
  employeeId: string;
  basicHours: number;
  overtimeHours: number;
  sundayHours: number;
  publicHolidayHours: number;
  leaveDays: number;
}

export type TimesheetHourBucket = "basic" | "overtime" | "sunday" | "public_holiday";

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

  const shiftsWithAttendance = await prisma.shift.findMany({
    where: {
      companyId,
      status: { in: ["completed", "verified"] },
      startTime: { lt: periodEnd },
      endTime: { gt: periodStart },
      attendances: {
        some: {
          clockIn: { not: null },
          clockOut: { not: null },
        },
      },
    },
    include: {
      employee: true,
      attendances: {
        where: {
          clockIn: { not: null },
          clockOut: { not: null },
        },
      },
    },
  });

  const leaveRecords = await prisma.leaveRecord.findMany({
    where: {
      employee: { companyId },
      date: { gte: periodStart, lte: periodEnd },
    },
  });

  const employeeLeaveDays = new Map<string, number>();
  for (const lr of leaveRecords) {
    const days = Number(lr.hours) / 8;
    const current = employeeLeaveDays.get(lr.employeeId) ?? 0;
    employeeLeaveDays.set(lr.employeeId, current + days);
  }

  const totals = new Map<
    string,
    { basicHours: number; overtimeHours: number; sundayHours: number; publicHolidayHours: number }
  >();

  for (const shift of shiftsWithAttendance) {
    const empId = shift.employeeId;
    if (!totals.has(empId)) {
      totals.set(empId, {
        basicHours: 0,
        overtimeHours: 0,
        sundayHours: 0,
        publicHolidayHours: 0,
      });
    }
    const t = totals.get(empId)!;

    for (const att of shift.attendances) {
      const hoursWorked = att.hoursWorked != null ? Number(att.hoursWorked) : 0;
      const overtimeHours = att.overtimeHours != null ? Number(att.overtimeHours) : 0;
      const bucket = classifyShiftHours({
        shiftStartTime: shift.startTime,
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
  }

  const result: TimesheetAggregate[] = [];
  for (const [employeeId, t] of totals) {
    result.push({
      employeeId,
      basicHours: Math.round(t.basicHours * 100) / 100,
      overtimeHours: Math.round(t.overtimeHours * 100) / 100,
      sundayHours: Math.round(t.sundayHours * 100) / 100,
      publicHolidayHours: Math.round(t.publicHolidayHours * 100) / 100,
      leaveDays: Math.round((employeeLeaveDays.get(employeeId) ?? 0) * 100) / 100,
    });
  }

  return result;
}
