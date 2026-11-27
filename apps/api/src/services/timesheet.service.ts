import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { prisma } from "../lib/prisma.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../lib/timezone.js";
import { employeeTypeConfig } from "../lib/leave-rules.config.js";
import { toLeaveConfigEmployeeType } from "./leave-v3.service.js";
import {
  addDaysToDateKey,
  buildEffectiveHolidaySet,
  parseLabourComplianceSettings,
  resolveEmployeeBceaCategory,
} from "../lib/sa-labour-rules.config.js";
import {
  classifyEmployeePeriodShifts,
  type EmployeeCredentialCheckInput,
  type ShiftClassificationInput,
} from "./sa-hours-classifier.service.js";

export interface TimesheetSegment {
  siteId: string;
  workDate: Date;
  basicHours: number;
  overtimeHours: number;
  sundayHours: number;
  sundayDoubleHours?: number;
  publicHolidayHours: number;
  nightShiftHours: number;
  nightShiftCount?: number;
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
  sundayDoubleHours?: number;
  publicHolidayHours: number;
  nightShiftHours: number;
  nightShiftCount?: number;
  /** Derived from leave hours (hours / 8) for display and legacy consumers. */
  leaveDays: number;
  /** Paid leave hours (annual/sick/family_responsibility/study) approved in the period. */
  leaveHours: number;
  annualLeaveHours: number;
  sickLeaveHours: number;
  familyLeaveHours: number;
  studyLeaveHours: number;
  /** Unpaid leave hours — parental leave only; unpaid by statute. */
  unpaidLeaveHours?: number;
  /** Always 0 — UIF-supported leave is out of scope for the simple leave engine. */
  uifLeaveHours?: number;
  /** Always 0 — injury-on-duty leave is out of scope for the simple leave engine. */
  iodLeaveHours?: number;
  /** Always 0 — information-only leave treatment does not exist in the simple leave engine. */
  informationLeaveHours?: number;
  workedShiftsCount: number;
  sourceSiteTimesheetIds: string[];
  sourceLeaveRequestIds: string[];
  /** Worked hours split by site and date for multi-site reporting and export breakdown. */
  segments?: TimesheetSegment[];
  /** Approved leave days for daily leave breakdown. */
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

export function isNightShift(params: {
  shiftStartTime: Date;
  timeZone: string;
  shiftType?: string | null;
}): boolean {
  const { shiftStartTime, timeZone, shiftType } = params;
  if (shiftType === "night") return true;
  if (shiftType === "day") return false;
  const zoned = toZonedTime(shiftStartTime, timeZone);
  const hour = zoned.getHours();
  return hour >= 18 || hour < 6;
}

function roundHours2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function anchorWorkDateToShiftStart(
  workDate: Date,
  shiftType: string | null | undefined,
): Date {
  const datePart = workDate.toISOString().slice(0, 10);
  const hourPart = shiftType === "night" ? "18:00:00" : "06:00:00";
  return new Date(`${datePart}T${hourPart}+02:00`);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function utcDateKey(d: Date): string {
  return startOfUtcDay(d).toISOString().slice(0, 10);
}

/**
 * Aggregate hours from SiteTimesheet + Shift/Attendance for a period using
 * South African NBCPSS Main Collective Agreement + BCEA classification rules.
 */
export async function aggregateTimesheets(
  companyId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<TimesheetAggregate[]> {
  const timeZone = await getCompanyTimezone(companyId);
  const periodStartKey = utcDateKey(periodStart);
  const periodEndKey = utcDateKey(periodEnd);
  const periodEndExclusive = fromZonedTime(`${addDaysToDateKey(periodEndKey, 1)}T00:00:00`, timeZone);
  const borderStart = new Date(Date.UTC(
    periodStart.getUTCFullYear(),
    periodStart.getUTCMonth(),
    periodStart.getUTCDate() - 6
  ));
  const borderStartPrevDay = new Date(borderStart.getTime() - 86_400_000);
  const borderStartKey = utcDateKey(borderStart);

  const [companyRow, siteMealRows, holidays] = await Promise.all([
    (prisma as any).company?.findUnique?.({
      where: { id: companyId },
      select: { settings: true },
    }) ?? Promise.resolve(null),
    (prisma as any).site?.findMany?.({
      where: { companyId },
      select: { id: true, mealIntervalPaid: true, mealIntervalMinutes: true },
    }) ?? Promise.resolve([]),
    prisma.publicHoliday.findMany({
      where: {
        companyId,
        date: { gte: borderStartPrevDay, lte: periodEndExclusive },
      },
    }),
  ]);

  const labourSettings = parseLabourComplianceSettings(companyRow?.settings);
  const siteMealMap = new Map<string, { mealIntervalPaid: boolean; mealIntervalMinutes: number }>();
  for (const s of (siteMealRows ?? []) as Array<{
    id: string;
    mealIntervalPaid?: boolean;
    mealIntervalMinutes?: number;
  }>) {
    siteMealMap.set(s.id, {
      mealIntervalPaid: s.mealIntervalPaid ?? true,
      mealIntervalMinutes: s.mealIntervalMinutes ?? 60,
    });
  }

  const holidayYears = new Set<number>();
  const maxYear = Math.max(periodEnd.getUTCFullYear(), periodEndExclusive.getUTCFullYear());
  for (let y = borderStart.getUTCFullYear(); y <= maxYear; y++) {
    holidayYears.add(y);
  }
  const effectiveHolidays = buildEffectiveHolidaySet(
    holidayYears,
    holidays.map((h) => ({
      date: new Date(h.date),
      name: (h as { name?: string }).name,
      isRecurring: Boolean((h as { isRecurring?: boolean }).isRecurring),
    })),
    true,
  );

  // Per-site aggregation: a site contributes hours either through its approved/locked
  // site timesheet rows OR through raw shift attendance — never both.
  const approvedTimesheets = await prisma.siteTimesheet.findMany({
    where: {
      companyId,
      status: { in: ["approved", "locked"] },
      periodStart: { lte: periodEnd },
      periodEnd: { gte: borderStart },
    },
    select: { id: true, siteId: true, periodStart: true, periodEnd: true },
  });
  const approvedCoverage = buildApprovedSiteDateCoverage(approvedTimesheets);
  const approvedSiteRowsRaw = approvedTimesheets.length > 0
    ? await prisma.siteTimesheetRow.findMany({
        where: {
          companyId,
          siteTimesheetId: { in: approvedTimesheets.map((timesheet) => timesheet.id) },
          workDate: { gte: borderStart, lte: periodEnd },
          actualGuardId: { not: null },
          attendanceStatus: {
            in: ["present", "late", "left_early", "reliever", "shift_swapped", "leave", "sick_leave", "training"],
          },
        },
        include: {
          actualGuard: {
            select: {
              employeeType: true,
              bceaSectorOverride: true,
              psiraRegistrationExpiry: true,
              firearmCompetency: true,
              firearmCompetencyExpiry: true,
            },
          },
        },
      })
    : [];

  const approvedSiteRows = approvedSiteRowsRaw.filter((row) => {
    const dk = row.workDate.toISOString().slice(0, 10);
    return approvedCoverage.has(`${row.siteId}:${dk}`);
  });
  const inPeriodApprovedSiteRows = approvedSiteRows.filter((row) => {
    const dk = row.workDate.toISOString().slice(0, 10);
    return dk >= periodStartKey && dk <= periodEndKey;
  });
  const approvedSourceShiftIds = new Set(
    inPeriodApprovedSiteRows
      .map((row) => row.sourceShiftId)
      .filter((id): id is string => typeof id === "string")
  );
  const approvedFallbackShiftKeys = new Set(
    inPeriodApprovedSiteRows
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
      endTime: { gt: borderStart },
      attendances: {
        some: {
          clockIn: { not: null },
          clockOut: { not: null },
          validationStatus: { not: "REJECTED_GEOFENCE" },
        },
      },
    },
    include: {
      employee: true,
      attendances: {
        where: {
          clockIn: { not: null },
          clockOut: { not: null },
          validationStatus: { not: "REJECTED_GEOFENCE" },
        },
      },
    },
  });
  const shiftsWithAttendance = shiftsWithAttendanceRaw.filter((shift) => {
    const dk = dateKeyInTimeZone(shift.startTime, timeZone);
    if (approvedCoverage.has(`${shift.siteId}:${dk}`)) return false;
    if (approvedSourceShiftIds.has(shift.id)) return false;
    if (
      approvedFallbackShiftKeys.has(
        siteTimesheetShiftMatchKey(shift.siteId, shift.employeeId, dk, shift.shiftType)
      )
    ) {
      return false;
    }
    return true;
  });

  const approvedLeaveRequests = await prisma.leaveRequest.findMany({
    where: {
      companyId,
      status: "APPROVED",
      startDate: { lte: periodEnd },
      endDate: { gte: periodStart },
    },
    select: {
      id: true,
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
  const employeeHoursPerUnit = new Map<string, number>();
  const periodStartDay = startOfUtcDay(periodStart);
  const periodEndDay = startOfUtcDay(periodEnd);
  const employeeLeaveByType = new Map<
    string,
    { annual: number; sick: number; family: number; study: number }
  >();
  const employeeUnpaidLeaveHours = new Map<string, number>();
  const employeeUifLeaveHours = new Map<string, number>();
  const employeeIodLeaveHours = new Map<string, number>();
  const employeeInformationLeaveHours = new Map<string, number>();
  const knownLeaveDayKeys = new Set<string>();
  const employeeLeaveDaysList = new Map<string, TimesheetLeaveDay[]>();
  const employeeSegmentsMap = new Map<string, Map<string, TimesheetSegment>>();
  const employeeSourceSiteTimesheetIds = new Map<string, Set<string>>();
  const employeeSourceLeaveRequestIds = new Map<string, Set<string>>();

  function addLeaveHoursByType(empId: string, leaveType: string, hours: number) {
    if (!employeeLeaveByType.has(empId)) {
      employeeLeaveByType.set(empId, { annual: 0, sick: 0, family: 0, study: 0 });
    }
    const entry = employeeLeaveByType.get(empId)!;
    if (leaveType === "ANNUAL") entry.annual += hours;
    else if (leaveType === "SICK") entry.sick += hours;
    else if (leaveType === "FAMILY_RESPONSIBILITY") entry.family += hours;
    else if (leaveType === "STUDY") entry.study += hours;
  }

  function addSourceSiteTimesheet(empId: string, siteTimesheetId: string) {
    if (!employeeSourceSiteTimesheetIds.has(empId)) {
      employeeSourceSiteTimesheetIds.set(empId, new Set());
    }
    employeeSourceSiteTimesheetIds.get(empId)!.add(siteTimesheetId);
  }

  function addSourceLeaveRequest(empId: string, leaveRequestId: string) {
    if (!employeeSourceLeaveRequestIds.has(empId)) {
      employeeSourceLeaveRequestIds.set(empId, new Set());
    }
    employeeSourceLeaveRequestIds.get(empId)!.add(leaveRequestId);
  }

  function buildMetaFields(employeeId: string) {
    const leaveTypes = employeeLeaveByType.get(employeeId);
    return {
      annualLeaveHours: Math.round((leaveTypes?.annual ?? 0) * 100) / 100,
      sickLeaveHours: Math.round((leaveTypes?.sick ?? 0) * 100) / 100,
      familyLeaveHours: Math.round((leaveTypes?.family ?? 0) * 100) / 100,
      studyLeaveHours: Math.round((leaveTypes?.study ?? 0) * 100) / 100,
      sourceSiteTimesheetIds: Array.from(employeeSourceSiteTimesheetIds.get(employeeId) ?? []).sort(),
      sourceLeaveRequestIds: Array.from(employeeSourceLeaveRequestIds.get(employeeId) ?? []).sort(),
    };
  }

  function addSegment(
    empId: string,
    siteId: string,
    workDate: Date,
    bucket: {
      basicHours: number;
      overtimeHours: number;
      sundayHours: number;
      sundayDoubleHours: number;
      publicHolidayHours: number;
      nightShiftHours: number;
      nightShiftCount: number;
    }
  ) {
    if (
      bucket.basicHours === 0 &&
      bucket.overtimeHours === 0 &&
      bucket.sundayHours === 0 &&
      bucket.sundayDoubleHours === 0 &&
      bucket.publicHolidayHours === 0 &&
      bucket.nightShiftHours === 0
    ) {
      return;
    }
    if (!employeeSegmentsMap.has(empId)) {
      employeeSegmentsMap.set(empId, new Map());
    }
    const map = employeeSegmentsMap.get(empId)!;
    const dk = workDate.toISOString().slice(0, 10);
    const key = `${siteId}:${dk}`;
    const existing = map.get(key);
    if (existing) {
      existing.basicHours += bucket.basicHours;
      existing.overtimeHours += bucket.overtimeHours;
      existing.sundayHours += bucket.sundayHours;
      existing.sundayDoubleHours = (existing.sundayDoubleHours ?? 0) + bucket.sundayDoubleHours;
      existing.publicHolidayHours += bucket.publicHolidayHours;
      existing.nightShiftHours += bucket.nightShiftHours;
      existing.nightShiftCount = (existing.nightShiftCount ?? 0) + bucket.nightShiftCount;
    } else {
      map.set(key, {
        siteId,
        workDate,
        basicHours: bucket.basicHours,
        overtimeHours: bucket.overtimeHours,
        sundayHours: bucket.sundayHours,
        sundayDoubleHours: bucket.sundayDoubleHours,
        publicHolidayHours: bucket.publicHolidayHours,
        nightShiftHours: bucket.nightShiftHours,
        nightShiftCount: bucket.nightShiftCount,
      });
    }
  }

  for (const request of approvedLeaveRequests) {
    const reqStartDay = startOfUtcDay(request.startDate);
    const reqEndDay = startOfUtcDay(request.endDate);
    const overlapStart = reqStartDay > periodStartDay ? reqStartDay : periodStartDay;
    const overlapEnd = reqEndDay < periodEndDay ? reqEndDay : periodEndDay;
    if (overlapEnd < overlapStart) continue;

    const totalDays = Math.round((reqEndDay.getTime() - reqStartDay.getTime()) / DAY_MS) + 1;
    const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / DAY_MS) + 1;
    const ratio = totalDays > 0 ? overlapDays / totalDays : 0;
    const hoursPerUnit = employeeTypeConfig(toLeaveConfigEmployeeType(request.employee.employeeType)).hoursPerUnit;
    employeeHoursPerUnit.set(request.employeeId, hoursPerUnit);
    const hours = Number(request.unitsRequested) * ratio * hoursPerUnit;

    addSourceLeaveRequest(request.employeeId, request.id);
    const target = request.leaveType === "PARENTAL" ? employeeUnpaidLeaveHours : employeeLeaveHours;
    target.set(request.employeeId, (target.get(request.employeeId) ?? 0) + hours);
    if (request.leaveType !== "PARENTAL") {
      addLeaveHoursByType(request.employeeId, request.leaveType, hours);
    }

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

  interface QueuedWorkedShift {
    classificationInput: ShiftClassificationInput;
    siteId: string;
    workDate: Date;
  }

  const employeeWorkedQueue = new Map<string, QueuedWorkedShift[]>();
  const employeeCredentialsMap = new Map<string, EmployeeCredentialCheckInput>();
  const employeeDefaultCategoryMap = new Map<string, ReturnType<typeof resolveEmployeeBceaCategory>>();
  const totals = new Map<
    string,
    {
      basicHours: number;
      overtimeHours: number;
      sundayHours: number;
      sundayDoubleHours: number;
      publicHolidayHours: number;
      nightShiftHours: number;
      nightShiftCount: number;
      workedShiftsCount: number;
    }
  >();

  function enqueueWorked(empId: string, item: QueuedWorkedShift) {
    if (!employeeWorkedQueue.has(empId)) {
      employeeWorkedQueue.set(empId, []);
    }
    employeeWorkedQueue.get(empId)!.push(item);
  }

  function ensureTotalsEntry(empId: string) {
    if (!totals.has(empId)) {
      totals.set(empId, {
        basicHours: 0,
        overtimeHours: 0,
        sundayHours: 0,
        sundayDoubleHours: 0,
        publicHolidayHours: 0,
        nightShiftHours: 0,
        nightShiftCount: 0,
        workedShiftsCount: 0,
      });
    }
    return totals.get(empId)!;
  }

  for (const row of approvedSiteRows) {
    const empId = row.actualGuardId;
    if (!empId) continue;
    const dk = row.workDate.toISOString().slice(0, 10);
    if (dk < borderStartKey || dk > periodEndKey) continue;
    const isCarryover = dk < periodStartKey;

    if (!isCarryover) {
      addSourceSiteTimesheet(empId, row.siteTimesheetId);
    }

    if (row.attendanceStatus === "leave" || row.attendanceStatus === "sick_leave") {
      if (!isCarryover) {
        const dayKey = `${empId}:${dk}`;
        if (!knownLeaveDayKeys.has(dayKey)) {
          const fallbackHours = row.hoursWorked != null ? Number(row.hoursWorked) : 8;
          if (Number.isFinite(fallbackHours) && fallbackHours > 0 && fallbackHours <= MAX_LEAVE_HOURS_PER_RECORD) {
            employeeLeaveHours.set(empId, (employeeLeaveHours.get(empId) ?? 0) + fallbackHours);
            const leaveType = row.attendanceStatus === "sick_leave" ? "SICK" : "ANNUAL";
            addLeaveHoursByType(empId, leaveType, fallbackHours);
            const date = new Date(row.workDate);
            date.setUTCHours(0, 0, 0, 0);
            if (!employeeLeaveDaysList.has(empId)) {
              employeeLeaveDaysList.set(empId, []);
            }
            employeeLeaveDaysList.get(empId)!.push({
              date,
              leaveType,
              hours: fallbackHours,
              isPaid: true,
            });
          }
        }
      }
      continue;
    }

    if ((row as { actualGuard?: EmployeeCredentialCheckInput | null }).actualGuard) {
      employeeCredentialsMap.set(
        empId,
        (row as { actualGuard: EmployeeCredentialCheckInput }).actualGuard,
      );
    }

    const hoursWorked = row.hoursWorked != null ? Number(row.hoursWorked) : row.attendanceStatus === "training" ? 8 : 0;
    const explicitOt = row.overtimeHours != null ? Number(row.overtimeHours) : 0;
    const totalShiftHours = hoursWorked + explicitOt;
    const siteMeal = siteMealMap.get(row.siteId);
    const startTime =
      row.clockIn ?? anchorWorkDateToShiftStart(row.workDate, row.actualShiftType ?? row.plannedShiftType);
    const endTime = new Date(startTime.getTime() + Math.max(0, totalShiftHours) * 3_600_000);
    const scheduledEndTime =
      explicitOt > 0 ? new Date(startTime.getTime() + Math.max(0, hoursWorked) * 3_600_000) : undefined;
    const guardObj = (row as {
      actualGuard?: { employeeType?: string | null; bceaSectorOverride?: string | null } | null;
    }).actualGuard;
    if (guardObj?.employeeType && !employeeHoursPerUnit.has(empId)) {
      employeeHoursPerUnit.set(
        empId,
        employeeTypeConfig(toLeaveConfigEmployeeType(guardObj.employeeType)).hoursPerUnit,
      );
    }
    const rowCat = resolveEmployeeBceaCategory(
      guardObj?.employeeType,
      guardObj?.bceaSectorOverride,
      companyRow?.settings,
    );
    if (!employeeDefaultCategoryMap.has(empId)) {
      employeeDefaultCategoryMap.set(empId, rowCat);
    }

    const rowWorkDate = new Date(row.workDate);
    rowWorkDate.setUTCHours(0, 0, 0, 0);

    if (!isCarryover) {
      ensureTotalsEntry(empId);
    }

    enqueueWorked(empId, {
      siteId: row.siteId,
      workDate: rowWorkDate,
      classificationInput: {
        id: `row:${row.id}`,
        employeeId: empId,
        siteId: row.siteId,
        startTime,
        endTime,
        scheduledStartTime: explicitOt > 0 ? startTime : undefined,
        scheduledEndTime,
        isScheduledOnRoster: !(row.attendanceStatus === "reliever" && !row.plannedGuardId && !row.sourceShiftId),
        mealIntervalPaid: siteMeal?.mealIntervalPaid ?? true,
        mealIntervalMinutes: siteMeal?.mealIntervalMinutes ?? 60,
        employeeCategory: rowCat,
        isCarryoverContextOnly: isCarryover,
      },
    });
  }

  for (const shift of shiftsWithAttendance) {
    const empId = shift.employeeId;
    const shiftStartKey = dateKeyInTimeZone(shift.startTime, timeZone);
    if (shiftStartKey < borderStartKey || shiftStartKey > periodEndKey) continue;
    const isCarryover = shiftStartKey < periodStartKey;

    if (!isCarryover) {
      ensureTotalsEntry(empId);
    }

    if ((shift as { employee?: EmployeeCredentialCheckInput | null }).employee) {
      employeeCredentialsMap.set(
        empId,
        (shift as { employee: EmployeeCredentialCheckInput }).employee,
      );
    }

    const shiftStartZoned = toZonedTime(shift.startTime, timeZone);
    const shiftWorkDate = new Date(
      Date.UTC(shiftStartZoned.getFullYear(), shiftStartZoned.getMonth(), shiftStartZoned.getDate())
    );
    const siteMeal = siteMealMap.get(shift.siteId);
    const empObj = (shift as {
      employee?: { employeeType?: string | null; bceaSectorOverride?: string | null } | null;
    }).employee;
    if (empObj?.employeeType && !employeeHoursPerUnit.has(empId)) {
      employeeHoursPerUnit.set(
        empId,
        employeeTypeConfig(toLeaveConfigEmployeeType(empObj.employeeType)).hoursPerUnit,
      );
    }
    const shiftCat = resolveEmployeeBceaCategory(
      empObj?.employeeType,
      empObj?.bceaSectorOverride,
      companyRow?.settings,
    );
    if (!employeeDefaultCategoryMap.has(empId)) {
      employeeDefaultCategoryMap.set(empId, shiftCat);
    }

    for (const att of shift.attendances) {
      if (att.validationStatus === "REJECTED_GEOFENCE" || att.status === "absent") continue;
      const hoursWorked = att.hoursWorked != null ? Number(att.hoursWorked) : 0;
      const explicitOt = att.overtimeHours != null ? Number(att.overtimeHours) : 0;
      const totalShiftHours = hoursWorked + explicitOt;
      const useActualTimestamps =
        Boolean(att.clockIn && att.clockOut) &&
        att.clockOut!.getTime() > att.clockIn!.getTime() &&
        totalShiftHours > 0;
      const startTime = useActualTimestamps ? att.clockIn! : shift.startTime;
      const endTime = useActualTimestamps
        ? att.clockOut!
        : new Date(shift.startTime.getTime() + Math.max(0, totalShiftHours) * 3_600_000);
      const scheduledStartTime = useActualTimestamps
        ? shift.startTime
        : explicitOt > 0
          ? shift.startTime
          : undefined;
      const scheduledEndTime = useActualTimestamps
        ? shift.endTime
        : explicitOt > 0
          ? new Date(shift.startTime.getTime() + Math.max(0, hoursWorked) * 3_600_000)
          : undefined;

      enqueueWorked(empId, {
        siteId: shift.siteId,
        workDate: shiftWorkDate,
        classificationInput: {
          id: `att:${att.id}`,
          employeeId: empId,
          siteId: shift.siteId,
          startTime,
          endTime,
          scheduledStartTime,
          scheduledEndTime,
          isScheduledOnRoster: true,
          mealIntervalPaid: siteMeal?.mealIntervalPaid ?? true,
          mealIntervalMinutes: siteMeal?.mealIntervalMinutes ?? 60,
          employeeCategory: shiftCat,
          isCarryoverContextOnly: isCarryover,
        },
      });
    }
  }

  for (const [empId, queue] of employeeWorkedQueue) {
    const hasInPeriod = queue.some((q) => !q.classificationInput.isCarryoverContextOnly);
    if (!hasInPeriod) continue;

    const classifiedPeriod = classifyEmployeePeriodShifts({
      employeeId: empId,
      shifts: queue.map((q) => q.classificationInput),
      holidays: effectiveHolidays,
      settings: labourSettings,
      employeeCredentials: employeeCredentialsMap.get(empId),
      defaultCategory: employeeDefaultCategoryMap.get(empId),
    });

    const t = ensureTotalsEntry(empId);
    for (const item of queue) {
      if (item.classificationInput.isCarryoverContextOnly) continue;
      const res = classifiedPeriod.byShiftId.get(item.classificationInput.id);
      if (!res) continue;

      const effectiveSunday = labourSettings.sundayDoubleRateSplit
        ? res.sundayHours
        : roundHours2(res.sundayHours + res.sundayDoubleHours);
      const effectiveSundayDouble = labourSettings.sundayDoubleRateSplit ? res.sundayDoubleHours : 0;

      if (res.totalHours > 0) {
        t.workedShiftsCount += 1;
      }
      t.basicHours += res.basicHours;
      t.overtimeHours += res.overtimeHours;
      t.sundayHours += effectiveSunday;
      t.sundayDoubleHours += effectiveSundayDouble;
      t.publicHolidayHours += res.publicHolidayHours;
      t.nightShiftHours += res.nightShiftHours;
      t.nightShiftCount += res.nightShiftCount;

      addSegment(empId, item.siteId, item.workDate, {
        basicHours: res.basicHours,
        overtimeHours: res.overtimeHours,
        sundayHours: effectiveSunday,
        sundayDoubleHours: effectiveSundayDouble,
        publicHolidayHours: res.publicHolidayHours,
        nightShiftHours: res.nightShiftHours,
        nightShiftCount: res.nightShiftCount,
      });
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
      sundayDoubleHours: Math.round((s.sundayDoubleHours ?? 0) * 100) / 100,
      publicHolidayHours: Math.round(s.publicHolidayHours * 100) / 100,
      nightShiftHours: Math.round(s.nightShiftHours * 100) / 100,
      nightShiftCount: s.nightShiftCount ?? 0,
    }));
  }

  const result: TimesheetAggregate[] = [];
  const seen = new Set<string>();

  for (const [employeeId, t] of totals) {
    seen.add(employeeId);
    const leaveHours = Math.round((employeeLeaveHours.get(employeeId) ?? 0) * 100) / 100;
    const hpUnit = employeeHoursPerUnit.get(employeeId) ?? 8;
    result.push({
      employeeId,
      basicHours: Math.round(t.basicHours * 100) / 100,
      overtimeHours: Math.round(t.overtimeHours * 100) / 100,
      sundayHours: Math.round(t.sundayHours * 100) / 100,
      sundayDoubleHours: Math.round(t.sundayDoubleHours * 100) / 100,
      publicHolidayHours: Math.round(t.publicHolidayHours * 100) / 100,
      nightShiftHours: Math.round(t.nightShiftHours * 100) / 100,
      nightShiftCount: t.nightShiftCount,
      leaveHours,
      unpaidLeaveHours: Math.round((employeeUnpaidLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      uifLeaveHours: Math.round((employeeUifLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      iodLeaveHours: Math.round((employeeIodLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      informationLeaveHours: Math.round((employeeInformationLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      leaveDays: Math.round((leaveHours / hpUnit) * 100) / 100,
      workedShiftsCount: t.workedShiftsCount,
      ...buildMetaFields(employeeId),
      segments: getSegments(employeeId),
      leaveDaysList: employeeLeaveDaysList.get(employeeId) ?? [],
    });
  }

  // Include approved leave for employees with no attendance shifts in the period.
  for (const [employeeId, leaveHoursRaw] of employeeLeaveHours) {
    if (seen.has(employeeId) || leaveHoursRaw <= 0) continue;
    seen.add(employeeId);
    const leaveHours = Math.round(leaveHoursRaw * 100) / 100;
    const hpUnit = employeeHoursPerUnit.get(employeeId) ?? 8;
    result.push({
      employeeId,
      basicHours: 0,
      overtimeHours: 0,
      sundayHours: 0,
      sundayDoubleHours: 0,
      publicHolidayHours: 0,
      nightShiftHours: 0,
      nightShiftCount: 0,
      leaveHours,
      unpaidLeaveHours: Math.round((employeeUnpaidLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      uifLeaveHours: Math.round((employeeUifLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      iodLeaveHours: Math.round((employeeIodLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      informationLeaveHours: Math.round((employeeInformationLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      leaveDays: Math.round((leaveHours / hpUnit) * 100) / 100,
      workedShiftsCount: 0,
      ...buildMetaFields(employeeId),
      segments: getSegments(employeeId),
      leaveDaysList: employeeLeaveDaysList.get(employeeId) ?? [],
    });
  }

  // Include authorised unpaid leave for fixed-salary employees with no worked or paid-leave hours.
  for (const [employeeId, unpaidLeaveHoursRaw] of employeeUnpaidLeaveHours) {
    if (seen.has(employeeId) || unpaidLeaveHoursRaw <= 0) continue;
    seen.add(employeeId);
    result.push({
      employeeId,
      basicHours: 0,
      overtimeHours: 0,
      sundayHours: 0,
      sundayDoubleHours: 0,
      publicHolidayHours: 0,
      nightShiftHours: 0,
      nightShiftCount: 0,
      leaveHours: 0,
      unpaidLeaveHours: Math.round(unpaidLeaveHoursRaw * 100) / 100,
      uifLeaveHours: Math.round((employeeUifLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      iodLeaveHours: Math.round((employeeIodLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      informationLeaveHours: Math.round((employeeInformationLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      leaveDays: 0,
      workedShiftsCount: 0,
      ...buildMetaFields(employeeId),
      segments: getSegments(employeeId),
      leaveDaysList: employeeLeaveDaysList.get(employeeId) ?? [],
    });
  }

  // Include UIF/IOD/information-only cases even when there are no paid or worked hours.
  for (const employeeId of new Set([...employeeUifLeaveHours.keys(), ...employeeIodLeaveHours.keys(), ...employeeInformationLeaveHours.keys()])) {
    if (seen.has(employeeId) || employeeUnpaidLeaveHours.has(employeeId)) continue;
    result.push({
      employeeId, basicHours: 0, overtimeHours: 0, sundayHours: 0, sundayDoubleHours: 0, publicHolidayHours: 0, nightShiftHours: 0, nightShiftCount: 0,
      leaveHours: 0, unpaidLeaveHours: 0, leaveDays: 0,
      uifLeaveHours: Math.round((employeeUifLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      iodLeaveHours: Math.round((employeeIodLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      informationLeaveHours: Math.round((employeeInformationLeaveHours.get(employeeId) ?? 0) * 100) / 100,
      workedShiftsCount: 0,
      ...buildMetaFields(employeeId),
      segments: getSegments(employeeId),
      leaveDaysList: employeeLeaveDaysList.get(employeeId) ?? [],
    });
  }

  return result;
}
