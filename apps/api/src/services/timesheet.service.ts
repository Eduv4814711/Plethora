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
  /** Authorised unpaid leave hours. */
  unpaidLeaveHours?: number;
  /** UIF-supported leave, retained separately from ordinary unpaid leave. */
  uifLeaveHours?: number;
  /** Injury-on-duty hours, retained for compensation reconciliation. */
  iodLeaveHours?: number;
  /** Information-only leave that must not alter pay automatically. */
  informationLeaveHours?: number;
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
  const periodEndExclusive = new Date(Date.UTC(
    periodEnd.getUTCFullYear(),
    periodEnd.getUTCMonth(),
    periodEnd.getUTCDate() + 1
  ));

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
  const approvedTimesheets = await prisma.siteTimesheet.findMany({
    where: {
      companyId,
      status: { in: ["approved", "locked"] },
      periodStart: { lte: periodEnd },
      periodEnd: { gte: periodStart },
    },
    select: { siteId: true },
  });
  const approvedSiteIds = [...new Set(approvedTimesheets.map((t) => t.siteId))];

  const shiftsWithAttendance = await prisma.shift.findMany({
    where: {
      companyId,
      status: { in: ["completed", "verified"] },
      startTime: { lt: periodEndExclusive },
      endTime: { gt: periodStart },
      ...(approvedSiteIds.length > 0 ? { siteId: { notIn: approvedSiteIds } } : {}),
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

  const [leaveOccurrences, legacyLeaveRecords] = await Promise.all([
    prisma.leaveOccurrence.findMany({
      where: {
        companyId,
        status: { in: ["APPROVED", "PAYROLL_PROCESSED"] },
        leaveDate: { gte: periodStart, lte: periodEnd },
      },
      select: { employeeId: true, leaveDate: true, paidMinutes: true, unpaidMinutes: true, requestedMinutes: true, payrollTreatment: true },
    }),
    prisma.leaveRecord.findMany({
      where: {
        employee: { companyId },
        date: { gte: periodStart, lte: periodEnd },
      },
    }),
  ]);

  const authoritativeKeys = new Set(
    leaveOccurrences.map((row) => `${row.employeeId}:${row.leaveDate.toISOString().slice(0, 10)}`)
  );
  const legacyWithoutAuthoritativeOccurrence = legacyLeaveRecords.filter(
    (row) => !authoritativeKeys.has(`${row.employeeId}:${row.date.toISOString().slice(0, 10)}`)
  );
  // Exact duplicate legacy rows are a known migration anomaly. Payroll
  // readiness blocks them for HR resolution; aggregation also de-duplicates
  // them defensively so a direct calculation can never pay the same day twice.
  const uniqueLegacyRecords = [...new Map(legacyWithoutAuthoritativeOccurrence.map((row) => [
    `${row.employeeId}:${row.date.toISOString().slice(0, 10)}:${row.type}:${Number(row.hours)}`,
    row,
  ])).values()];
  // Keep legacy payroll semantics available during the staged per-company
  // migration. Once an authoritative occurrence exists for a day it wins;
  // otherwise every legacy treatment is still classified rather than silently
  // dropping unpaid/UIF/IOD deductions before that tenant is imported.
  const legacyUifTypes = new Set(["maternity", "parental", "adoption", "commissioning_parental"]);
  const employeeLeaveHours = sumLeaveHoursFromRecords(
    uniqueLegacyRecords.filter(
      (row) => row.type !== "unpaid" && row.type !== "injury_on_duty" && !legacyUifTypes.has(row.type)
    )
  );
  const employeeUnpaidLeaveHours = sumLeaveHoursFromRecords(
    uniqueLegacyRecords.filter((row) => row.type === "unpaid")
  );
  const employeeUifLeaveHours = sumLeaveHoursFromRecords(
    uniqueLegacyRecords.filter((row) => legacyUifTypes.has(row.type))
  );
  const employeeIodLeaveHours = sumLeaveHoursFromRecords(
    uniqueLegacyRecords.filter((row) => row.type === "injury_on_duty")
  );
  const employeeInformationLeaveHours = new Map<string, number>();
  for (const occurrence of leaveOccurrences) {
    employeeLeaveHours.set(
      occurrence.employeeId,
      (employeeLeaveHours.get(occurrence.employeeId) ?? 0) + occurrence.paidMinutes / 60
    );
    const target = occurrence.payrollTreatment === "UIF_NO_EMPLOYER_PAY"
      ? employeeUifLeaveHours
      : occurrence.payrollTreatment === "IOD_COMPENSATION"
        ? employeeIodLeaveHours
        : occurrence.payrollTreatment === "INFORMATION_ONLY"
          ? employeeInformationLeaveHours
          : employeeUnpaidLeaveHours;
    const minutes = occurrence.payrollTreatment === "IOD_COMPENSATION" || occurrence.payrollTreatment === "INFORMATION_ONLY"
      ? occurrence.requestedMinutes
      : occurrence.unpaidMinutes;
    target.set(occurrence.employeeId, (target.get(occurrence.employeeId) ?? 0) + minutes / 60);
  }

  const knownLeaveDayKeys = new Set([
    ...authoritativeKeys,
    ...legacyLeaveRecords.map((row) => `${row.employeeId}:${row.date.toISOString().slice(0, 10)}`),
  ]);

  const totals = new Map<
    string,
    { basicHours: number; overtimeHours: number; sundayHours: number; publicHolidayHours: number }
  >();

  for (const row of approvedSiteRows) {
    const empId = row.actualGuardId;
    if (!empId) continue;
    if (row.attendanceStatus === "leave" || row.attendanceStatus === "sick_leave") {
      const dayKey = `${empId}:${row.workDate.toISOString().slice(0, 10)}`;
      if (!knownLeaveDayKeys.has(dayKey)) {
        const fallbackHours = row.hoursWorked != null ? Number(row.hoursWorked) : 8;
        if (Number.isFinite(fallbackHours) && fallbackHours > 0 && fallbackHours <= MAX_LEAVE_HOURS_PER_RECORD) {
          employeeLeaveHours.set(empId, (employeeLeaveHours.get(empId) ?? 0) + fallbackHours);
        }
      }
      // Leave is paid or deducted from the leave source of truth. It is never
      // also ordinary worked time from the site-timesheet row.
      continue;
    }
    if (!totals.has(empId)) {
      totals.set(empId, {
        basicHours: 0,
        overtimeHours: 0,
        sundayHours: 0,
        publicHolidayHours: 0,
      });
    }
    const t = totals.get(empId)!;
    const hoursWorked = row.hoursWorked != null ? Number(row.hoursWorked) : row.attendanceStatus === "training" ? 8 : 0;
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
      unpaidLeaveHours: Math.round((employeeUnpaidLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      uifLeaveHours: Math.round((employeeUifLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      iodLeaveHours: Math.round((employeeIodLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      informationLeaveHours: Math.round((employeeInformationLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      leaveDays: Math.round((leaveHours / 8) * 100) / 100,
    });
  }

  // Include approved leave for employees with no attendance shifts in the period.
  for (const [employeeId, leaveHoursRaw] of employeeLeaveHours) {
    if (seen.has(employeeId) || leaveHoursRaw <= 0) continue;
    seen.add(employeeId);
    const leaveHours = Math.round(leaveHoursRaw * 100) / 100;
    result.push({
      employeeId,
      basicHours: 0,
      overtimeHours: 0,
      sundayHours: 0,
      publicHolidayHours: 0,
      leaveHours,
      unpaidLeaveHours: Math.round((employeeUnpaidLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      uifLeaveHours: Math.round((employeeUifLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      iodLeaveHours: Math.round((employeeIodLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      informationLeaveHours: Math.round((employeeInformationLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      leaveDays: Math.round((leaveHours / 8) * 100) / 100,
    });
  }

  // Include authorised unpaid leave for fixed-salary employees with no worked or paid-leave hours.
  for (const [employeeId, unpaidLeaveHoursRaw] of employeeUnpaidLeaveHours) {
    if (seen.has(employeeId) || unpaidLeaveHoursRaw <= 0) continue;
    result.push({
      employeeId,
      basicHours: 0,
      overtimeHours: 0,
      sundayHours: 0,
      publicHolidayHours: 0,
      leaveHours: 0,
      unpaidLeaveHours: Math.round(unpaidLeaveHoursRaw * 100) / 100,
      uifLeaveHours: Math.round((employeeUifLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      iodLeaveHours: Math.round((employeeIodLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      informationLeaveHours: Math.round((employeeInformationLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      leaveDays: 0,
    });
  }

  // Include UIF/IOD/information-only cases even when there are no paid or worked hours.
  for (const employeeId of new Set([...employeeUifLeaveHours.keys(), ...employeeIodLeaveHours.keys(), ...employeeInformationLeaveHours.keys()])) {
    if (seen.has(employeeId) || employeeUnpaidLeaveHours.has(employeeId)) continue;
    result.push({
      employeeId, basicHours: 0, overtimeHours: 0, sundayHours: 0, publicHolidayHours: 0,
      leaveHours: 0, unpaidLeaveHours: 0, leaveDays: 0,
      uifLeaveHours: Math.round((employeeUifLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      iodLeaveHours: Math.round((employeeIodLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      informationLeaveHours: Math.round((employeeInformationLeaveHours.get(employeeId) ?? 0) * 100) / 100,
    });
  }

  return result;
}
