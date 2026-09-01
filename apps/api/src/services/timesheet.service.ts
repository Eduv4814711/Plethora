import { toZonedTime } from "date-fns-tz";
import { prisma } from "../lib/prisma.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../lib/timezone.js";
import { employeeTypeConfig } from "../lib/leave-rules.config.js";
import { toLeaveConfigEmployeeType } from "./leave-v3.service.js";

export interface TimesheetSegment {
  siteId: string;
  workDate: Date;
  basicHours: number;
  overtimeHours: number;
  sundayHours: number;
  publicHolidayHours: number;
}

export interface TimesheetLeaveDay {
  date: Date;
  leaveType: string;
  hours: number;
  isPaid: boolean;
}

export interface TimesheetAggregate {
  employeeId: string;
  basicHours: number;
  overtimeHours: number;
  sundayHours: number;
  publicHolidayHours: number;
  /** Derived from leave hours (hours / 8) for display and legacy consumers. */
  leaveDays: number;
  /** Paid leave hours (annual/sick/family_responsibility/study) approved in the period. */
  leaveHours: number;
  /** Unpaid leave hours — parental leave only; unpaid by statute. */
  unpaidLeaveHours?: number;
  /** Always 0 — UIF-supported leave is out of scope for the simple leave engine. */
  uifLeaveHours?: number;
  /** Always 0 — injury-on-duty leave is out of scope for the simple leave engine. */
  iodLeaveHours?: number;
  /** Always 0 — information-only leave treatment does not exist in the simple leave engine. */
  informationLeaveHours?: number;
  /** Worked hours split by site and date for multi-site rate calculation. */
  segments?: TimesheetSegment[];
  /** Approved leave days for daily rate calculation. */
  leaveDaysList?: TimesheetLeaveDay[];
}

/** Maximum leave hours accepted per single leave record (guards against bad data). */
export const MAX_LEAVE_HOURS_PER_RECORD = 24;

export function buildApprovedSiteDateCoverage(
  timesheets: Array<{ siteId: string; periodStart: Date; periodEnd: Date }>
): Set<string> {
  const covered = new Set<string>();
  for (const timesheet of timesheets) {
    const cursor = new Date(Date.UTC(
      timesheet.periodStart.getUTCFullYear(),
      timesheet.periodStart.getUTCMonth(),
      timesheet.periodStart.getUTCDate()
    ));
    const end = new Date(Date.UTC(
      timesheet.periodEnd.getUTCFullYear(),
      timesheet.periodEnd.getUTCMonth(),
      timesheet.periodEnd.getUTCDate()
    ));
    while (cursor <= end) {
      covered.add(`${timesheet.siteId}:${cursor.toISOString().slice(0, 10)}`);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return covered;
}

export function siteTimesheetShiftMatchKey(
  siteId: string,
  employeeId: string,
  dateKey: string,
  shiftType: string | null | undefined
): string {
  return `${siteId}:${employeeId}:${dateKey}:${shiftType ?? "unknown"}`;
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
    select: { id: true, siteId: true, periodStart: true, periodEnd: true },
  });
  const approvedCoverage = buildApprovedSiteDateCoverage(approvedTimesheets);
  const approvedSiteRowsRaw = approvedTimesheets.length > 0
    ? await prisma.siteTimesheetRow.findMany({
        where: {
          companyId,
          siteTimesheetId: { in: approvedTimesheets.map((timesheet) => timesheet.id) },
          workDate: { gte: periodStart, lte: periodEnd },
          actualGuardId: { not: null },
          attendanceStatus: {
            in: ["present", "late", "left_early", "reliever", "shift_swapped", "leave", "sick_leave", "training"],
          },
        },
      })
    : [];
  const approvedSiteRows = approvedSiteRowsRaw.filter((row) =>
    approvedCoverage.has(`${row.siteId}:${row.workDate.toISOString().slice(0, 10)}`)
  );
  const approvedSourceShiftIds = new Set(
    approvedSiteRows
      .map((row) => row.sourceShiftId)
      .filter((id): id is string => typeof id === "string")
  );
  const approvedFallbackShiftKeys = new Set(
    approvedSiteRows
      .filter((row) => row.sourceShiftId == null && row.actualGuardId != null)
      .map((row) =>
        siteTimesheetShiftMatchKey(
          row.siteId,
          row.actualGuardId!,
          row.workDate.toISOString().slice(0, 10),
          row.actualShiftType
        )
      )
  );

  const shiftsWithAttendanceRaw = await prisma.shift.findMany({
    where: {
      companyId,
      status: { in: ["completed", "verified"] },
      startTime: { lt: periodEndExclusive },
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
  const shiftsWithAttendance = shiftsWithAttendanceRaw.filter(
    (shift) =>
      !approvedSourceShiftIds.has(shift.id) &&
      !approvedFallbackShiftKeys.has(
        siteTimesheetShiftMatchKey(
          shift.siteId,
          shift.employeeId,
          dateKeyInTimeZone(shift.startTime, timeZone),
          shift.shiftType
        )
      )
  );

  // Paid leave types (annual/sick/family_responsibility/study) contribute
  // leaveHours; parental leave is unpaid by statute and contributes
  // unpaidLeaveHours instead. UIF/IOD/information-only treatments no longer
  // exist as leave types in the simple engine, so those buckets always
  // report zero — out of scope per the leave rebuild (see README).
  const approvedLeaveRequests = await prisma.leaveRequest.findMany({
    where: {
      companyId,
      status: "APPROVED",
      startDate: { lte: periodEnd },
      endDate: { gte: periodStart },
    },
    select: {
      employeeId: true,
      leaveType: true,
      startDate: true,
      endDate: true,
      unitsRequested: true,
      employee: { select: { employeeType: true } },
    },
  });

  const DAY_MS = 24 * 60 * 60 * 1000;
  const employeeLeaveHours = new Map<string, number>();
  const employeeUnpaidLeaveHours = new Map<string, number>();
  const employeeUifLeaveHours = new Map<string, number>();
  const employeeIodLeaveHours = new Map<string, number>();
  const employeeInformationLeaveHours = new Map<string, number>();
  const knownLeaveDayKeys = new Set<string>();
  const employeeLeaveDaysList = new Map<string, TimesheetLeaveDay[]>();
  const employeeSegmentsMap = new Map<string, Map<string, TimesheetSegment>>();

  function addSegment(
    empId: string,
    siteId: string,
    workDate: Date,
    bucket: { basicHours: number; overtimeHours: number; sundayHours: number; publicHolidayHours: number }
  ) {
    if (
      bucket.basicHours === 0 &&
      bucket.overtimeHours === 0 &&
      bucket.sundayHours === 0 &&
      bucket.publicHolidayHours === 0
    ) {
      return;
    }
    if (!employeeSegmentsMap.has(empId)) {
      employeeSegmentsMap.set(empId, new Map());
    }
    const map = employeeSegmentsMap.get(empId)!;
    const dateKey = workDate.toISOString().slice(0, 10);
    const key = `${siteId}:${dateKey}`;
    const existing = map.get(key);
    if (existing) {
      existing.basicHours += bucket.basicHours;
      existing.overtimeHours += bucket.overtimeHours;
      existing.sundayHours += bucket.sundayHours;
      existing.publicHolidayHours += bucket.publicHolidayHours;
    } else {
      map.set(key, {
        siteId,
        workDate,
        basicHours: bucket.basicHours,
        overtimeHours: bucket.overtimeHours,
        sundayHours: bucket.sundayHours,
        publicHolidayHours: bucket.publicHolidayHours,
      });
    }
  }

  for (const request of approvedLeaveRequests) {
    const overlapStart = request.startDate > periodStart ? request.startDate : periodStart;
    const overlapEnd = request.endDate < periodEnd ? request.endDate : periodEnd;
    if (overlapEnd < overlapStart) continue;

    // A request spanning a pay-period boundary contributes only the
    // proportion of its units that fall within this period, split evenly
    // across the calendar days of the request (an approximation, not a
    // roster-aware day-by-day allocation).
    const totalDays = Math.round((request.endDate.getTime() - request.startDate.getTime()) / DAY_MS) + 1;
    const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / DAY_MS) + 1;
    const ratio = totalDays > 0 ? overlapDays / totalDays : 0;
    const hoursPerUnit = employeeTypeConfig(toLeaveConfigEmployeeType(request.employee.employeeType)).hoursPerUnit;
    const hours = Number(request.unitsRequested) * ratio * hoursPerUnit;

    const target = request.leaveType === "PARENTAL" ? employeeUnpaidLeaveHours : employeeLeaveHours;
    target.set(request.employeeId, (target.get(request.employeeId) ?? 0) + hours);

    const isPaid = request.leaveType !== "PARENTAL";
    const hoursPerDay = overlapDays > 0 ? hours / overlapDays : hours;

    for (
      let day = new Date(overlapStart);
      day <= overlapEnd;
      day = new Date(day.getTime() + DAY_MS)
    ) {
      knownLeaveDayKeys.add(`${request.employeeId}:${day.toISOString().slice(0, 10)}`);
      const date = new Date(day);
      date.setUTCHours(0, 0, 0, 0);
      if (!employeeLeaveDaysList.has(request.employeeId)) {
        employeeLeaveDaysList.set(request.employeeId, []);
      }
      employeeLeaveDaysList.get(request.employeeId)!.push({
        date,
        leaveType: request.leaveType,
        hours: Math.round(hoursPerDay * 100) / 100,
        isPaid,
      });
    }
  }

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
          const date = new Date(row.workDate);
          date.setUTCHours(0, 0, 0, 0);
          if (!employeeLeaveDaysList.has(empId)) {
            employeeLeaveDaysList.set(empId, []);
          }
          employeeLeaveDaysList.get(empId)!.push({
            date,
            leaveType: row.attendanceStatus === "sick_leave" ? "SICK" : "ANNUAL",
            hours: fallbackHours,
            isPaid: true,
          });
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

    const rowWorkDate = new Date(row.workDate);
    rowWorkDate.setUTCHours(0, 0, 0, 0);
    addSegment(empId, row.siteId, rowWorkDate, bucket);
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

    const shiftStartZoned = toZonedTime(shift.startTime, timeZone);
    const shiftWorkDate = new Date(
      Date.UTC(shiftStartZoned.getFullYear(), shiftStartZoned.getMonth(), shiftStartZoned.getDate())
    );

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

      addSegment(empId, shift.siteId, shiftWorkDate, bucket);
    }
  }

  function getSegments(employeeId: string): TimesheetSegment[] {
    const map = employeeSegmentsMap.get(employeeId);
    if (!map) return [];
    return [...map.values()].map((s) => ({
      siteId: s.siteId,
      workDate: s.workDate,
      basicHours: Math.round(s.basicHours * 100) / 100,
      overtimeHours: Math.round(s.overtimeHours * 100) / 100,
      sundayHours: Math.round(s.sundayHours * 100) / 100,
      publicHolidayHours: Math.round(s.publicHolidayHours * 100) / 100,
    }));
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
      segments: getSegments(employeeId),
      leaveDaysList: employeeLeaveDaysList.get(employeeId) ?? [],
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
      segments: getSegments(employeeId),
      leaveDaysList: employeeLeaveDaysList.get(employeeId) ?? [],
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
      segments: getSegments(employeeId),
      leaveDaysList: employeeLeaveDaysList.get(employeeId) ?? [],
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
      segments: getSegments(employeeId),
      leaveDaysList: employeeLeaveDaysList.get(employeeId) ?? [],
    });
  }

  return result;
}
