import { format } from "date-fns";
import type { Prisma, SiteRosterShiftCode, SiteTimesheetAttendance, SiteTimesheetRowStatus } from "@prisma/client";
import { createAuditLog } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { getCompanyTimezone, inferShiftTypeFromStartTime } from "../../lib/timezone.js";
import { findApprovedLeaveConflict } from "../../services/attendance.service.js";
import { dateKey, dateOnly, ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX } from "./rosters.service.js";
import { buildConfirmAsScheduledPatch, type ConfirmAsScheduledPatch } from "./site-timesheet-derive.js";
import {
  isShiftCoveredOnDateKey,
  resolveSiteCoverageDays,
} from "../../lib/site-coverage-days.js";

type Tx = Prisma.TransactionClient | typeof prisma;

const WORKING_CODES = new Set(["D", "N", "R"]);
const WORKING_SHIFT_CODES: SiteRosterShiftCode[] = ["D", "N", "R"];
const PAYABLE_STATUSES = new Set<SiteTimesheetAttendance>([
  "present",
  "late",
  "left_early",
  "reliever",
  "shift_swapped",
  "leave",
  "sick_leave",
  "training",
]);

function addCalendarDays(d: Date, days: number): Date {
  const next = dateOnly(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isWorkDateWithinTimesheetPeriod(
  workDate: string,
  periodStart: Date | string,
  periodEnd: Date | string
): boolean {
  if (!DATE_KEY_PATTERN.test(workDate)) return false;
  const parsed = dateOnly(workDate);
  if (Number.isNaN(parsed.getTime()) || dateKey(parsed) !== workDate) return false;
  return workDate >= dateKey(periodStart) && workDate <= dateKey(periodEnd);
}

function dayOfWeek(date: Date): string {
  return format(date, "EEE");
}

export type CaptureShiftTypeFilter = "day" | "night" | "all";

export function normalizeShiftType(value: string | null | undefined): "day" | "night" | null {
  if (!value) return null;
  if (value === "day" || value === "D") return "day";
  if (value === "night" || value === "N") return "night";
  return null;
}

/** Prefer planned shift so uncaptured rostered rows still classify correctly. */
export function resolveRowShiftType(row: {
  plannedShiftType?: string | null;
  plannedShiftCode?: string | null;
  actualShiftType?: string | null;
  actualShiftCode?: string | null;
}): "day" | "night" | null {
  return (
    normalizeShiftType(row.plannedShiftType ?? row.plannedShiftCode) ??
    normalizeShiftType(row.actualShiftType ?? row.actualShiftCode)
  );
}

export function rowMatchesShiftTypeFilter(
  row: {
    plannedShiftType?: string | null;
    plannedShiftCode?: string | null;
    actualShiftType?: string | null;
    actualShiftCode?: string | null;
  },
  shiftType: CaptureShiftTypeFilter
): boolean {
  if (shiftType === "all") return true;
  return resolveRowShiftType(row) === shiftType;
}

function rosterShiftWhereForFilter(
  companyId: string,
  start: Date,
  captureEnd: Date,
  shiftType: CaptureShiftTypeFilter
): Prisma.SiteRosterGeneratedShiftWhereInput {
  const base = {
    companyId,
    rosterDate: { gte: start, lte: captureEnd },
  };
  if (shiftType === "all") {
    return { ...base, shiftCode: { in: WORKING_SHIFT_CODES } };
  }
  const primaryCode = shiftType === "day" ? "D" : "N";
  return {
    ...base,
    OR: [
      { shiftCode: primaryCode },
      { shiftCode: "R", shiftType },
    ],
  };
}

function rowShiftSortOrder(row: {
  plannedShiftType?: string | null;
  plannedShiftCode?: string | null;
  actualShiftType?: string | null;
  actualShiftCode?: string | null;
}): number {
  const shift = resolveRowShiftType(row);
  if (shift === "day") return 0;
  if (shift === "night") return 1;
  return 2;
}

/** Match key: guard + operational date + day|night (avoids day/night collisions). */
function shiftMatchKey(guardId: string, date: Date | string, shiftType: "day" | "night" | null | undefined): string {
  const d = typeof date === "string" ? date : dateKey(date);
  return `${guardId}:${d}:${shiftType ?? "unknown"}`;
}

function plannedRowMatchKey(row: {
  plannedGuardId?: string | null;
  workDate: Date | string;
  plannedShiftType?: string | null;
  plannedShiftCode?: string | null;
  actualShiftType?: string | null;
  actualShiftCode?: string | null;
}): string | null {
  if (!row.plannedGuardId) return null;
  return shiftMatchKey(row.plannedGuardId, row.workDate, resolveRowShiftType(row));
}

function countPendingByShift(
  rows: Array<{
    approvalStatus: string;
    plannedShiftType?: string | null;
    plannedShiftCode?: string | null;
    actualShiftType?: string | null;
    actualShiftCode?: string | null;
  }>
): { pendingDayRows: number; pendingNightRows: number } {
  let pendingDayRows = 0;
  let pendingNightRows = 0;
  for (const row of rows) {
    if (!isRowPendingReview(row.approvalStatus)) continue;
    const shift = resolveRowShiftType(row);
    if (shift === "day") pendingDayRows += 1;
    else if (shift === "night") pendingNightRows += 1;
  }
  return { pendingDayRows, pendingNightRows };
}

function compareSiteTimesheetRows<
  T extends {
    id: string;
    workDate: Date | string;
    plannedShiftType?: string | null;
    plannedShiftCode?: string | null;
    actualShiftType?: string | null;
    actualShiftCode?: string | null;
  },
>(a: T, b: T): number {
  const dateA = typeof a.workDate === "string" ? a.workDate : dateKey(a.workDate);
  const dateB = typeof b.workDate === "string" ? b.workDate : dateKey(b.workDate);
  if (dateA !== dateB) return dateA.localeCompare(dateB);
  const shiftDiff = rowShiftSortOrder(a) - rowShiftSortOrder(b);
  if (shiftDiff !== 0) return shiftDiff;
  return a.id.localeCompare(b.id);
}

function inferredAttendanceStatus(input: {
  plannedShiftCode?: string | null;
  actualShiftCode?: string | null;
  clockIn?: Date | null;
  clockOut?: Date | null;
  isOnApprovedLeave?: boolean;
}): SiteTimesheetAttendance {
  if (input.clockIn || input.clockOut) return "present";
  if (input.actualShiftCode === "R") return "reliever";
  if (input.actualShiftCode === "L") return "leave";
  if (input.actualShiftCode === "SL") return "sick_leave";
  if (input.actualShiftCode === "TR") return "training";
  if (input.actualShiftCode === "O" || input.actualShiftCode === "blank") return "off";
  // No shift/clock data resolved this row yet — if the roster row is stale (leave was
  // approved after generation, or continuity hasn't reconciled it to "L" yet), fall back
  // to the real leave record rather than leaving the row stuck on "pending" forever.
  if (input.isOnApprovedLeave) return "leave";
  if (WORKING_CODES.has(input.plannedShiftCode ?? "")) return "pending";
  return "off";
}

function calculateDiscrepancies(input: {
  plannedGuardId?: string | null;
  actualGuardId?: string | null;
  plannedShiftType?: string | null;
  actualShiftType?: string | null;
  plannedShiftCode?: string | null;
  actualShiftCode?: string | null;
  attendanceStatus: SiteTimesheetAttendance;
  coverage: { actualDay: number; actualNight: number; requiredDay: number; requiredNight: number };
}): string[] {
  const codes = new Set<string>();
  const plannedWorks = WORKING_CODES.has(input.plannedShiftCode ?? "");
  const actualWorks =
    PAYABLE_STATUSES.has(input.attendanceStatus) &&
    input.attendanceStatus !== "leave" &&
    input.attendanceStatus !== "sick_leave" &&
    input.attendanceStatus !== "training";

  if (plannedWorks && input.attendanceStatus === "absent") codes.add("ROSTERED_NOT_WORKED");
  if (!input.plannedGuardId && input.actualGuardId && actualWorks) codes.add("UNROSTERED_WORKED");
  if (input.plannedGuardId && input.actualGuardId && input.plannedGuardId !== input.actualGuardId) {
    codes.add(input.attendanceStatus === "reliever" ? "RELIEVER_COVERED" : "SHIFT_SWAPPED");
  }
  if (
    input.plannedShiftType &&
    input.actualShiftType &&
    input.plannedShiftType !== input.actualShiftType &&
    actualWorks
  ) {
    codes.add("SHIFT_TYPE_CHANGED");
  }
  if (actualWorks && !plannedWorks) codes.add("OVERTIME_OR_EXTRA_SHIFT");
  if (plannedWorks && input.attendanceStatus === "absent" && !input.actualGuardId) {
    codes.add("ABSENT_WITHOUT_REPLACEMENT");
  }
  if (input.coverage.actualDay < input.coverage.requiredDay) codes.add("DAY_COVERAGE_SHORT");
  if (input.coverage.actualNight < input.coverage.requiredNight) codes.add("NIGHT_COVERAGE_SHORT");

  return [...codes];
}

async function getOrCreateTimesheet(
  tx: Tx,
  companyId: string,
  siteId: string,
  periodStart: Date,
  periodEnd: Date
) {
  return tx.siteTimesheet.upsert({
    where: {
      companyId_siteId_periodStart_periodEnd: { companyId, siteId, periodStart, periodEnd },
    },
    create: { companyId, siteId, periodStart, periodEnd },
    update: {},
  });
}

async function seedRows(tx: Tx, companyId: string, timesheetId: string, siteId: string, start: Date, end: Date) {
  const existingCount = await tx.siteTimesheetRow.count({ where: { siteTimesheetId: timesheetId } });
  if (existingCount > 0) return;

  const [planned, shifts] = await Promise.all([
    tx.siteRosterGeneratedShift.findMany({
      where: { companyId, siteId, rosterDate: { gte: start, lte: end } },
    }),
    tx.shift.findMany({
      where: {
        companyId,
        siteId,
        startTime: { lt: addCalendarDays(end, 2) },
        endTime: { gt: start },
      },
      include: { attendances: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
  ]);

  const timeZone = await getCompanyTimezone(companyId);
  const shiftByGuardDateType = new Map<string, (typeof shifts)[number]>();
  for (const shift of shifts) {
    const type =
      normalizeShiftType(shift.shiftType) ?? inferShiftTypeFromStartTime(shift.startTime, timeZone);
    shiftByGuardDateType.set(shiftMatchKey(shift.employeeId, shift.startTime, type), shift);
  }

  const workingPlanned = planned.filter((p) => WORKING_CODES.has(p.shiftCode));
  const [leaveConflicts, placeholderGuardIds] = await Promise.all([
    Promise.all(workingPlanned.map((p) => findApprovedLeaveConflict(companyId, p.guardId, dateOnly(p.rosterDate)))),
    getPlaceholderGuardIds(tx, [...new Set(workingPlanned.map((p) => p.guardId))]),
  ]);

  const rows: Prisma.SiteTimesheetRowCreateManyInput[] = [];
  workingPlanned.forEach((p, index) => {
    const plannedType = normalizeShiftType(p.shiftType) ?? (p.shiftCode === "N" ? "night" : "day");
    const shift = shiftByGuardDateType.get(shiftMatchKey(p.guardId, p.rosterDate, plannedType));
    const attendance = shift?.attendances[0];
    rows.push({
      companyId,
      siteTimesheetId: timesheetId,
      siteId,
      workDate: p.rosterDate,
      plannedGuardId: p.guardId,
      actualGuardId: placeholderGuardIds.has(p.guardId) ? null : p.guardId,
      plannedShiftCode: p.shiftCode,
      plannedShiftType: p.shiftType,
      actualShiftCode: shift ? p.shiftCode : null,
      actualShiftType: shift ? p.shiftType : null,
      clockIn: attendance?.clockIn ?? null,
      clockOut: attendance?.clockOut ?? null,
      hoursWorked: attendance?.hoursWorked ?? null,
      overtimeHours: attendance?.overtimeHours ?? null,
      attendanceStatus: inferredAttendanceStatus({
        plannedShiftCode: p.shiftCode,
        actualShiftCode: shift ? p.shiftCode : null,
        clockIn: attendance?.clockIn,
        clockOut: attendance?.clockOut,
        isOnApprovedLeave: Boolean(leaveConflicts[index]),
      }),
      sourceShiftId: shift?.id ?? null,
      sourceAttendanceId: attendance?.id ?? null,
    });
  });

  if (rows.length > 0) await tx.siteTimesheetRow.createMany({ data: rows });
}

/**
 * Re-pull the latest published shifts and attendance into an existing timesheet so an
 * approver sees current reality. Safe to run repeatedly: it only
 *  - adds rows for newly published roster cells that have no row yet, and
 *  - fills in actual clock/shift data on still-"pending" seeded rows.
 * It never overwrites manually added rows (no plannedGuardId), rows an operator has
 * already actioned (attendanceStatus !== "pending"), or reviewed/approved rows.
 */
async function resyncRows(tx: Tx, companyId: string, timesheetId: string, siteId: string, start: Date, end: Date) {
  const [existingRows, planned, shifts] = await Promise.all([
    tx.siteTimesheetRow.findMany({ where: { siteTimesheetId: timesheetId } }),
    tx.siteRosterGeneratedShift.findMany({
      where: { companyId, siteId, rosterDate: { gte: start, lte: end } },
    }),
    tx.shift.findMany({
      where: {
        companyId,
        siteId,
        startTime: { lt: addCalendarDays(end, 2) },
        endTime: { gt: start },
      },
      include: { attendances: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
  ]);

  const timeZone = await getCompanyTimezone(companyId);
  const shiftByGuardDateType = new Map<string, (typeof shifts)[number]>();
  for (const shift of shifts) {
    const type =
      normalizeShiftType(shift.shiftType) ?? inferShiftTypeFromStartTime(shift.startTime, timeZone);
    shiftByGuardDateType.set(shiftMatchKey(shift.employeeId, shift.startTime, type), shift);
  }

  const rowByPlanned = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    const key = plannedRowMatchKey(row);
    if (key) rowByPlanned.set(key, row);
  }

  const placeholderGuardIds = await getPlaceholderGuardIds(tx, [
    ...new Set([
      ...planned.map((p) => p.guardId),
      ...existingRows.map((row) => row.plannedGuardId).filter((id): id is string => id != null),
    ]),
  ]);

  // 1. Add rows for newly published roster cells that have no row yet.
  const newPlanned = planned.filter((p) => {
    if (!WORKING_CODES.has(p.shiftCode)) return false;
    const plannedType = normalizeShiftType(p.shiftType) ?? (p.shiftCode === "N" ? "night" : "day");
    return !rowByPlanned.has(shiftMatchKey(p.guardId, p.rosterDate, plannedType));
  });
  const newPlannedLeaveConflicts = await Promise.all(
    newPlanned.map((p) => findApprovedLeaveConflict(companyId, p.guardId, dateOnly(p.rosterDate)))
  );

  const toCreate: Prisma.SiteTimesheetRowCreateManyInput[] = [];
  newPlanned.forEach((p, index) => {
    const plannedType = normalizeShiftType(p.shiftType) ?? (p.shiftCode === "N" ? "night" : "day");
    const key = shiftMatchKey(p.guardId, p.rosterDate, plannedType);
    const shift = shiftByGuardDateType.get(key);
    const attendance = shift?.attendances[0];
    toCreate.push({
      companyId,
      siteTimesheetId: timesheetId,
      siteId,
      workDate: p.rosterDate,
      plannedGuardId: p.guardId,
      actualGuardId: placeholderGuardIds.has(p.guardId) ? null : p.guardId,
      plannedShiftCode: p.shiftCode,
      plannedShiftType: p.shiftType,
      actualShiftCode: shift ? p.shiftCode : null,
      actualShiftType: shift ? p.shiftType : null,
      clockIn: attendance?.clockIn ?? null,
      clockOut: attendance?.clockOut ?? null,
      hoursWorked: attendance?.hoursWorked ?? null,
      overtimeHours: attendance?.overtimeHours ?? null,
      attendanceStatus: inferredAttendanceStatus({
        plannedShiftCode: p.shiftCode,
        actualShiftCode: shift ? p.shiftCode : null,
        clockIn: attendance?.clockIn,
        clockOut: attendance?.clockOut,
        isOnApprovedLeave: Boolean(newPlannedLeaveConflicts[index]),
      }),
      sourceShiftId: shift?.id ?? null,
      sourceAttendanceId: attendance?.id ?? null,
    });
  });
  if (toCreate.length > 0) await tx.siteTimesheetRow.createMany({ data: toCreate });

  // 2. Default actual worker to scheduled guard on rostered rows still missing one —
  // unless the scheduled guard is a roster-planning placeholder, which must be swapped
  // for a real employee before it can absorb attendance/hours.
  for (const row of existingRows) {
    if (!row.plannedGuardId || row.actualGuardId) continue;
    if (row.approvalStatus !== "pending") continue;
    if (placeholderGuardIds.has(row.plannedGuardId)) continue;
    await tx.siteTimesheetRow.update({
      where: { id: row.id },
      data: { actualGuardId: row.plannedGuardId },
    });
  }

  // 3. Rows still "pending" with no matching shift may now have leave approved for that
  // date (approved after the row was seeded, or before roster continuity reconciled the
  // planned shift code to "L") — resolve them to "leave" instead of leaving them stuck.
  const stillPendingNoShift = existingRows.filter((row) => {
    if (!row.plannedGuardId) return false;
    if (row.attendanceStatus !== "pending") return false;
    if (row.approvalStatus !== "pending") return false;
    const rowType = resolveRowShiftType(row);
    return !shiftByGuardDateType.has(shiftMatchKey(row.plannedGuardId, row.workDate, rowType));
  });
  const pendingLeaveConflicts = await Promise.all(
    stillPendingNoShift.map((row) =>
      findApprovedLeaveConflict(companyId, row.plannedGuardId!, dateOnly(row.workDate))
    )
  );
  await Promise.all(
    stillPendingNoShift.map((row, index) => {
      if (!pendingLeaveConflicts[index]) return Promise.resolve();
      return tx.siteTimesheetRow.update({
        where: { id: row.id },
        data: { attendanceStatus: "leave" },
      });
    })
  );

  // 4. Fill actual data on still-pending seeded rows that now have attendance.
  for (const row of existingRows) {
    if (!row.plannedGuardId) continue; // manual/reliever row
    if (row.attendanceStatus !== "pending") continue; // already actioned by an operator
    if (row.approvalStatus !== "pending") continue;
    if (placeholderGuardIds.has(row.plannedGuardId)) continue;
    const rowType = resolveRowShiftType(row);
    const shift = shiftByGuardDateType.get(shiftMatchKey(row.plannedGuardId, row.workDate, rowType));
    if (!shift) continue;
    const attendance = shift.attendances[0];
    const worked =
      attendance?.clockIn || attendance?.clockOut || shift.status === "completed" || shift.status === "verified";
    if (!worked) continue;
    await tx.siteTimesheetRow.update({
      where: { id: row.id },
      data: {
        actualGuardId: row.plannedGuardId,
        actualShiftCode: row.plannedShiftCode,
        actualShiftType: row.plannedShiftType,
        clockIn: attendance?.clockIn ?? null,
        clockOut: attendance?.clockOut ?? null,
        hoursWorked: attendance?.hoursWorked ?? null,
        overtimeHours: attendance?.overtimeHours ?? null,
        attendanceStatus: inferredAttendanceStatus({
          plannedShiftCode: row.plannedShiftCode,
          actualShiftCode: row.plannedShiftCode,
          clockIn: attendance?.clockIn,
          clockOut: attendance?.clockOut,
        }),
        sourceShiftId: shift.id,
        sourceAttendanceId: attendance?.id ?? null,
      },
    });
  }
}

export async function resyncSiteTimesheet(companyId: string, siteId: string, startDate: string, endDate: string) {
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);
  const site = await prisma.site.findFirst({ where: { id: siteId, companyId } });
  if (!site) return null;

  const sheet = await getOrCreateTimesheet(prisma, companyId, siteId, start, end);
  if (sheet.status === "approved" || sheet.status === "locked") {
    return { error: "Timesheet is approved and locked. Unlock it before refreshing from shifts." };
  }

  await prisma.$transaction(async (tx) => {
    await seedRows(tx, companyId, sheet.id, siteId, start, end);
    await resyncRows(tx, companyId, sheet.id, siteId, start, end);
  });

  const refreshed = await getSiteTimesheet(companyId, siteId, startDate, endDate);
  return { timesheet: refreshed };
}

type DiscrepancyRow = {
  id: string;
  workDate: Date;
  plannedGuardId: string | null;
  actualGuardId: string | null;
  plannedShiftCode: string | null;
  actualShiftCode: string | null;
  plannedShiftType: string | null;
  actualShiftType: string | null;
  attendanceStatus: SiteTimesheetAttendance;
};

function computeDiscrepancyMap(
  site: {
    rosterDayShiftGuardsRequired: number;
    rosterNightShiftGuardsRequired: number;
    rosterDayShiftDays?: number[] | null;
    rosterNightShiftDays?: number[] | null;
  },
  rows: DiscrepancyRow[]
): Map<string, string[]> {
  const coverage7 = resolveSiteCoverageDays(site);
  const coverageByDate = new Map<string, { actualDay: number; actualNight: number; requiredDay: number; requiredNight: number }>();
  for (const row of rows) {
    const key = dateKey(row.workDate);
    const coverage =
      coverageByDate.get(key) ?? {
        actualDay: 0,
        actualNight: 0,
        // A weekday this site does not need covered requires nobody, so an empty
        // Saturday on a Mon–Fri site is not a coverage discrepancy.
        requiredDay: isShiftCoveredOnDateKey(coverage7, "day", key)
          ? site.rosterDayShiftGuardsRequired
          : 0,
        requiredNight: isShiftCoveredOnDateKey(coverage7, "night", key)
          ? site.rosterNightShiftGuardsRequired
          : 0,
      };
    const actualWorks =
      PAYABLE_STATUSES.has(row.attendanceStatus) &&
      !["leave", "sick_leave", "training"].includes(row.attendanceStatus);
    if (actualWorks && normalizeShiftType(row.actualShiftType) === "day") coverage.actualDay += 1;
    if (actualWorks && normalizeShiftType(row.actualShiftType) === "night") coverage.actualNight += 1;
    coverageByDate.set(key, coverage);
  }

  const result = new Map<string, string[]>();
  for (const row of rows) {
    result.set(
      row.id,
      calculateDiscrepancies({
        plannedGuardId: row.plannedGuardId,
        actualGuardId: row.actualGuardId,
        plannedShiftCode: row.plannedShiftCode,
        actualShiftCode: row.actualShiftCode,
        plannedShiftType: normalizeShiftType(row.plannedShiftType),
        actualShiftType: normalizeShiftType(row.actualShiftType),
        attendanceStatus: row.attendanceStatus,
        coverage: coverageByDate.get(dateKey(row.workDate))!,
      })
    );
  }
  return result;
}

function serializeRow(
  row: Prisma.SiteTimesheetRowGetPayload<{
    include: { plannedGuard: true; actualGuard: true };
  }>,
  discrepancyCodes?: string[]
) {
  const employeeNumber = row.actualGuard?.employeeNumber ?? row.plannedGuard?.employeeNumber ?? null;
  const psiraRegistrationNumber = row.actualGuard?.psiraRegistrationNumber ?? row.plannedGuard?.psiraRegistrationNumber ?? null;
  return {
    id: row.id,
    workDate: dateKey(row.workDate),
    dayOfWeek: dayOfWeek(row.workDate),
    plannedGuardId: row.plannedGuardId,
    plannedGuardName: row.plannedGuard ? `${row.plannedGuard.firstName} ${row.plannedGuard.lastName}`.trim() : null,
    actualGuardId: row.actualGuardId,
    actualGuardName: row.actualGuard ? `${row.actualGuard.firstName} ${row.actualGuard.lastName}`.trim() : null,
    employeeNumber,
    psiraRegistrationNumber,
    plannedShiftCode: row.plannedShiftCode,
    plannedShiftType: row.plannedShiftType,
    actualShiftCode: row.actualShiftCode,
    actualShiftType: row.actualShiftType,
    clockIn: row.clockIn?.toISOString() ?? null,
    clockOut: row.clockOut?.toISOString() ?? null,
    hoursWorked: row.hoursWorked != null ? Number(row.hoursWorked) : null,
    overtimeHours: row.overtimeHours != null ? Number(row.overtimeHours) : null,
    attendanceStatus: row.attendanceStatus,
    approvalStatus: row.approvalStatus,
    dutyOnObNumber: row.dutyOnObNumber ?? row.occurrenceBookNumber,
    dutyOffObNumber: row.dutyOffObNumber,
    occurrenceBookNumber: row.dutyOnObNumber ?? row.occurrenceBookNumber,
    comments: row.comments,
    discrepancyCodes:
      discrepancyCodes ??
      (Array.isArray(row.discrepancyCodes) ? (row.discrepancyCodes as string[]) : []),
  };
}

export type SiteCaptureOverviewSite = {
  siteId: string;
  siteName: string;
  status: "caught_up" | "needs_capture" | "no_shifts";
  dueDays: number;
  pendingRows: number;
  pendingDayRows: number;
  pendingNightRows: number;
  reviewedRows: number;
  lastCapturedDate: string | null;
  timesheetStatus: "draft" | "approved" | "locked" | "none";
};

function emptyCaptureSite(
  siteId: string,
  siteName: string,
  timesheetStatus: SiteCaptureOverviewSite["timesheetStatus"] = "none"
): SiteCaptureOverviewSite {
  return {
    siteId,
    siteName,
    status: "no_shifts",
    dueDays: 0,
    pendingRows: 0,
    pendingDayRows: 0,
    pendingNightRows: 0,
    reviewedRows: 0,
    lastCapturedDate: null,
    timesheetStatus,
  };
}

/** Pure helper: compute capture status for a site from already-loaded rows. */
export function computeSiteCaptureFromRows(input: {
  siteId: string;
  siteName: string;
  timesheetStatus: "draft" | "approved" | "locked" | "none";
  rows: Array<{
    workDate: Date | string;
    approvalStatus: string;
    plannedShiftType?: string | null;
    plannedShiftCode?: string | null;
    actualShiftType?: string | null;
    actualShiftCode?: string | null;
  }>;
  shiftType: CaptureShiftTypeFilter;
}): SiteCaptureOverviewSite {
  // Day/night pending breakdown always uses the full row set so controllers see
  // the other shift even while filtering the needs-attention status.
  const allPending = countPendingByShift(input.rows);
  const scoped = input.rows.filter((r) => rowMatchesShiftTypeFilter(r, input.shiftType));
  if (scoped.length === 0) {
    return {
      ...emptyCaptureSite(input.siteId, input.siteName, input.timesheetStatus),
      pendingDayRows: allPending.pendingDayRows,
      pendingNightRows: allPending.pendingNightRows,
    };
  }

  const pendingRows = scoped.filter((r) => isRowPendingReview(r.approvalStatus));
  const pendingDates = new Set(
    pendingRows.map((r) => (typeof r.workDate === "string" ? r.workDate : dateKey(r.workDate)))
  );
  const capturedDates = scoped
    .filter((r) => isRowFullyReviewed(r.approvalStatus))
    .map((r) => (typeof r.workDate === "string" ? r.workDate : dateKey(r.workDate)))
    .sort();

  return {
    siteId: input.siteId,
    siteName: input.siteName,
    status: pendingRows.length > 0 ? "needs_capture" : "caught_up",
    dueDays: pendingDates.size,
    pendingRows: pendingRows.length,
    pendingDayRows: allPending.pendingDayRows,
    pendingNightRows: allPending.pendingNightRows,
    reviewedRows: scoped.filter((r) => isRowFullyReviewed(r.approvalStatus)).length,
    lastCapturedDate: capturedDates.at(-1) ?? null,
    timesheetStatus: input.timesheetStatus,
  };
}

export async function getSiteTimesheetCaptureOverview(
  companyId: string,
  startDate: string,
  endDate: string,
  shiftType: CaptureShiftTypeFilter = "all"
) {
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);
  const today = dateOnly(new Date());

  const sites = await prisma.site.findMany({
    where: { companyId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (start.getTime() > today.getTime()) {
    return {
      periodStart: dateKey(start),
      periodEnd: dateKey(end),
      captureThrough: null as string | null,
      asOfDate: dateKey(today),
      shiftType,
      sites: sites.map((site) => emptyCaptureSite(site.id, site.name)),
      summary: {
        totalSites: sites.length,
        needsCapture: 0,
        caughtUp: 0,
        noShifts: sites.length,
        pendingDayRows: 0,
        pendingNightRows: 0,
      },
    };
  }

  const captureEnd = end.getTime() < today.getTime() ? end : today;

  const rosteredSiteIds = await prisma.siteRosterGeneratedShift.findMany({
    where: rosterShiftWhereForFilter(companyId, start, captureEnd, shiftType),
    distinct: ["siteId"],
    select: { siteId: true },
  });
  const rosteredSet = new Set(rosteredSiteIds.map((r) => r.siteId));

  const siteStatuses: SiteCaptureOverviewSite[] = await Promise.all(
    sites.map(async (site) => {
      if (!rosteredSet.has(site.id)) {
        return emptyCaptureSite(site.id, site.name);
      }

      const sheet = await getOrCreateTimesheet(prisma, companyId, site.id, start, end);
      await seedRows(prisma, companyId, sheet.id, site.id, start, end);

      const [rows, timesheet] = await Promise.all([
        prisma.siteTimesheetRow.findMany({
          where: {
            siteTimesheetId: sheet.id,
            workDate: { gte: start, lte: captureEnd },
          },
          select: {
            workDate: true,
            approvalStatus: true,
            plannedShiftType: true,
            plannedShiftCode: true,
            actualShiftType: true,
            actualShiftCode: true,
          },
        }),
        prisma.siteTimesheet.findUnique({
          where: { id: sheet.id },
          select: { status: true },
        }),
      ]);

      return computeSiteCaptureFromRows({
        siteId: site.id,
        siteName: site.name,
        timesheetStatus: (timesheet?.status as SiteCaptureOverviewSite["timesheetStatus"]) ?? "draft",
        rows,
        shiftType,
      });
    })
  );

  const pendingDayRows = siteStatuses.reduce((n, s) => n + s.pendingDayRows, 0);
  const pendingNightRows = siteStatuses.reduce((n, s) => n + s.pendingNightRows, 0);

  return {
    periodStart: dateKey(start),
    periodEnd: dateKey(end),
    captureThrough: dateKey(captureEnd),
    asOfDate: dateKey(today),
    shiftType,
    sites: siteStatuses,
    summary: {
      totalSites: sites.length,
      needsCapture: siteStatuses.filter((s) => s.status === "needs_capture").length,
      caughtUp: siteStatuses.filter((s) => s.status === "caught_up").length,
      noShifts: siteStatuses.filter((s) => s.status === "no_shifts").length,
      pendingDayRows,
      pendingNightRows,
    },
  };
}

export async function getSiteTimesheet(companyId: string, siteId: string, startDate: string, endDate: string) {
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);
  const site = await prisma.site.findFirst({ where: { id: siteId, companyId } });
  if (!site) return null;

  const sheet = await getOrCreateTimesheet(prisma, companyId, siteId, start, end);
  await seedRows(prisma, companyId, sheet.id, siteId, start, end);

  const timesheet = await prisma.siteTimesheet.findUnique({
    where: { id: sheet.id },
    include: {
      rows: {
        include: { plannedGuard: true, actualGuard: true },
        orderBy: [{ workDate: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!timesheet) return null;
  const siteCoverage = resolveSiteCoverageDays(site);
  const discrepancyMap = computeDiscrepancyMap(site, timesheet.rows);
  const rows = [...timesheet.rows]
    .sort(compareSiteTimesheetRows)
    .map((row) => serializeRow(row, discrepancyMap.get(row.id) ?? []));
  const totals = rows.reduce(
    (acc, row) => {
      if (row.actualShiftType === "day") acc.dayShifts += 1;
      if (row.actualShiftType === "night") acc.nightShifts += 1;
      if (row.attendanceStatus === "reliever") acc.relieverShifts += 1;
      if (row.attendanceStatus === "absent") acc.absences += 1;
      acc.totalHours += row.hoursWorked ?? 0;
      acc.overtimeHours += row.overtimeHours ?? 0;
      if (row.discrepancyCodes.length > 0) acc.discrepancies += 1;
      return acc;
    },
    { dayShifts: 0, nightShifts: 0, relieverShifts: 0, absences: 0, totalHours: 0, overtimeHours: 0, discrepancies: 0 }
  );

  return {
    id: timesheet.id,
    siteId,
    siteName: site.name,
    periodStart: dateKey(timesheet.periodStart),
    periodEnd: dateKey(timesheet.periodEnd),
    status: timesheet.status,
    reviewedBy: timesheet.reviewedBy,
    reviewedAt: timesheet.reviewedAt?.toISOString() ?? null,
    approvedBy: timesheet.approvedBy,
    approvedAt: timesheet.approvedAt?.toISOString() ?? null,
    approvalNotes: timesheet.approvalNotes,
    // Attendance has no rows for a weekday the site does not run. Sending the site's cover
    // lets the capture screen say "No Shift" for those days instead of silently omitting them.
    coverageDays: {
      day: [...siteCoverage.day].sort((a, b) => a - b),
      night: [...siteCoverage.night].sort((a, b) => a - b),
    },
    rows,
    totals: {
      ...totals,
      totalHours: Math.round(totals.totalHours * 100) / 100,
      overtimeHours: Math.round(totals.overtimeHours * 100) / 100,
    },
  };
}

/**
 * Guard IDs on timesheet rows must reference real employees of the same company (tenant
 * boundary), not roster-planning placeholders — those exist only to hold a slot on the
 * grid and must be swapped for a real employee before any hours can be recorded against them.
 */
async function guardBelongsToCompany(guardId: string, companyId: string): Promise<boolean> {
  const employee = await prisma.employee.findFirst({
    where: { id: guardId, companyId },
    select: { id: true, jobRole: true },
  });
  if (!employee) return false;
  return !(employee.jobRole ?? "").startsWith(`${ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX}:`);
}

/** Employee IDs among `guardIds` that are roster-planning placeholders, not real staff. */
async function getPlaceholderGuardIds(tx: Tx, guardIds: string[]): Promise<Set<string>> {
  if (guardIds.length === 0) return new Set();
  const placeholders = await tx.employee.findMany({
    where: { id: { in: guardIds }, jobRole: { startsWith: `${ROSTER_PLACEHOLDER_JOB_ROLE_PREFIX}:` } },
    select: { id: true },
  });
  return new Set(placeholders.map((p) => p.id));
}

export function normalizeObNumber(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Working shifts need Duty ON and Duty OFF before full row review. */
export function rowNeedsObNumbers(attendanceStatus: SiteTimesheetAttendance): boolean {
  if (attendanceStatus === "off") return false;
  if (attendanceStatus === "leave" || attendanceStatus === "sick_leave") return false;
  return true;
}

export function isRowPendingReview(approvalStatus: string): boolean {
  return approvalStatus === "pending" || approvalStatus === "partially_reviewed";
}

export function isRowFullyReviewed(approvalStatus: string): boolean {
  return approvalStatus === "reviewed" || approvalStatus === "approved";
}

type SiteTimesheetRowEditInput = {
  actualGuardId?: string | null;
  actualShiftCode?: string | null;
  actualShiftType?: string | null;
  clockIn?: string | null;
  clockOut?: string | null;
  hoursWorked?: number | null;
  overtimeHours?: number | null;
  attendanceStatus?: SiteTimesheetAttendance;
  dutyOnObNumber?: string | null;
  dutyOffObNumber?: string | null;
  occurrenceBookNumber?: string | null;
  comments?: string | null;
};

const APPROVAL_AFFECTING_ROW_FIELDS = new Set<keyof SiteTimesheetRowEditInput>([
  "actualGuardId",
  "actualShiftCode",
  "actualShiftType",
  "clockIn",
  "clockOut",
  "hoursWorked",
  "overtimeHours",
  "attendanceStatus",
  "dutyOnObNumber",
  "dutyOffObNumber",
  "occurrenceBookNumber",
]);

function rowEditAffectsApproval(input: SiteTimesheetRowEditInput): boolean {
  return Object.keys(input).some((key) =>
    APPROVAL_AFFECTING_ROW_FIELDS.has(key as keyof SiteTimesheetRowEditInput)
  );
}

function validateWorkedTime(input: {
  clockIn: string | null;
  clockOut: string | null;
  hoursWorked: number | null;
  overtimeHours: number | null;
}): string | null {
  const values = [
    ["Hours worked", input.hoursWorked],
    ["Overtime hours", input.overtimeHours],
  ] as const;
  for (const [label, value] of values) {
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 24)) {
      return `${label} must be between 0 and 24.`;
    }
  }
  if (
    input.hoursWorked != null &&
    input.overtimeHours != null &&
    input.overtimeHours > input.hoursWorked
  ) {
    return "Overtime hours cannot exceed total hours worked.";
  }

  const clockIn = input.clockIn == null ? null : new Date(input.clockIn);
  const clockOut = input.clockOut == null ? null : new Date(input.clockOut);
  if (clockIn && !Number.isFinite(clockIn.getTime())) return "Clock in must be a valid timestamp.";
  if (clockOut && !Number.isFinite(clockOut.getTime())) return "Clock out must be a valid timestamp.";
  if (clockIn && clockOut) {
    const duration = clockOut.getTime() - clockIn.getTime();
    if (duration <= 0) return "Clock out must be after clock in.";
    if (duration > 24 * 60 * 60 * 1000) return "A worked shift cannot exceed 24 hours.";
  }
  return null;
}

function resolveDutyOnFromRow(row: {
  dutyOnObNumber?: string | null;
  occurrenceBookNumber?: string | null;
}): string | null {
  return normalizeObNumber(row.dutyOnObNumber ?? row.occurrenceBookNumber) ?? null;
}

export async function updateSiteTimesheetRow(
  companyId: string,
  rowId: string,
  input: SiteTimesheetRowEditInput,
  actor?: { canOverrideObNumbers: boolean; userId?: string }
) {
  return writeSiteTimesheetRow(companyId, rowId, input, actor);
}

/** Confirm an individual row through the dedicated review action. */
export async function confirmSiteTimesheetRow(
  companyId: string,
  rowId: string,
  input: SiteTimesheetRowEditInput,
  actor?: { canOverrideObNumbers: boolean; userId?: string }
) {
  return writeSiteTimesheetRow(companyId, rowId, input, actor, "reviewed");
}

export async function reopenSiteTimesheetRow(
  companyId: string,
  rowId: string,
  userId?: string
) {
  const existing = await prisma.siteTimesheetRow.findFirst({
    where: { id: rowId, companyId },
    include: { siteTimesheet: true },
  });
  if (!existing) return null;
  if (existing.siteTimesheet.status === "approved" || existing.siteTimesheet.status === "locked") {
    return { error: "Timesheet is approved and locked. Unlock it before reopening a row." };
  }

  const row = await prisma.$transaction(async (tx) => {
    await tx.siteTimesheetRow.update({
      where: { id: rowId },
      data: { approvalStatus: "pending" },
    });
    await tx.siteTimesheet.update({
      where: { id: existing.siteTimesheetId },
      data: {
        status: "draft",
        reviewedBy: null,
        reviewedAt: null,
        approvedBy: null,
        approvedAt: null,
        approvalNotes: null,
      },
    });
    return tx.siteTimesheetRow.findUnique({
      where: { id: rowId },
      include: { plannedGuard: true, actualGuard: true },
    });
  });
  if (!row) return null;

  await createAuditLog({
    userId,
    companyId,
    action: "site_timesheet.row_reopen",
    entityType: "SiteTimesheetRow",
    entityId: rowId,
    metadata: {
      siteTimesheetId: existing.siteTimesheetId,
      previousApprovalStatus: existing.approvalStatus,
    },
  });

  const sheetContext = await prisma.siteTimesheet.findUnique({
    where: { id: existing.siteTimesheetId },
    include: { site: true, rows: true },
  });
  const discrepancyMap = sheetContext
    ? computeDiscrepancyMap(sheetContext.site, sheetContext.rows)
    : new Map();
  return { row: serializeRow(row, discrepancyMap.get(row.id) ?? []) };
}

async function writeSiteTimesheetRow(
  companyId: string,
  rowId: string,
  input: SiteTimesheetRowEditInput,
  actor?: { canOverrideObNumbers: boolean; userId?: string },
  approvalAction?: "reviewed"
) {
  const existing = await prisma.siteTimesheetRow.findFirst({
    where: { id: rowId, companyId },
    include: { siteTimesheet: true },
  });
  if (!existing) return null;
  if (existing.siteTimesheet.status === "approved" || existing.siteTimesheet.status === "locked") {
    return { error: "Timesheet is approved and locked. Unlock it before making changes." };
  }

  if (input.actualGuardId && !(await guardBelongsToCompany(input.actualGuardId, companyId))) {
    return { error: "Guard not found, or is a roster-planning placeholder. Assign a real employee before recording hours." };
  }

  const nextDutyOn =
    input.dutyOnObNumber !== undefined
      ? normalizeObNumber(input.dutyOnObNumber)
      : input.occurrenceBookNumber !== undefined
        ? normalizeObNumber(input.occurrenceBookNumber)
        : undefined;
  const nextDutyOff =
    input.dutyOffObNumber !== undefined ? normalizeObNumber(input.dutyOffObNumber) : undefined;

  const existingDutyOn = resolveDutyOnFromRow(existing);
  const existingDutyOff = normalizeObNumber(existing.dutyOffObNumber) ?? null;
  const effectiveClockIn =
    input.clockIn !== undefined
      ? input.clockIn
      : existing.clockIn?.toISOString() ?? null;
  const effectiveClockOut =
    input.clockOut !== undefined
      ? input.clockOut
      : existing.clockOut?.toISOString() ?? null;
  const effectiveHours =
    input.hoursWorked !== undefined
      ? input.hoursWorked
      : existing.hoursWorked != null
        ? Number(existing.hoursWorked)
        : null;
  const effectiveOvertime =
    input.overtimeHours !== undefined
      ? input.overtimeHours
      : existing.overtimeHours != null
        ? Number(existing.overtimeHours)
        : null;
  const workedTimeError = validateWorkedTime({
    clockIn: effectiveClockIn,
    clockOut: effectiveClockOut,
    hoursWorked: effectiveHours,
    overtimeHours: effectiveOvertime,
  });
  if (workedTimeError) return { error: workedTimeError };

  if (nextDutyOn !== undefined && existingDutyOn && nextDutyOn !== existingDutyOn && !actor?.canOverrideObNumbers) {
    return {
      error: "Duty ON OB number requires attendance approval access to change once it has been entered.",
    };
  }
  if (nextDutyOff !== undefined && existingDutyOff && nextDutyOff !== existingDutyOff && !actor?.canOverrideObNumbers) {
    return {
      error: "Duty OFF OB number requires attendance approval access to change once it has been entered.",
    };
  }

  const approving = approvalAction === "reviewed";
  const resolvedDutyOn = nextDutyOn !== undefined ? nextDutyOn : existingDutyOn;
  const resolvedDutyOff = nextDutyOff !== undefined ? nextDutyOff : existingDutyOff;
  const attendanceStatus = input.attendanceStatus ?? existing.attendanceStatus;
  const needsOb = rowNeedsObNumbers(attendanceStatus);
  const effectiveGuardId = input.actualGuardId !== undefined
    ? input.actualGuardId
    : existing.actualGuardId ?? existing.plannedGuardId;
  const recordsWork = !["leave", "sick_leave", "off", "absent", "pending"].includes(attendanceStatus);
  const approvedLeave = approving && recordsWork && effectiveGuardId
    ? await prisma.leaveRequest.findFirst({
        where: {
          companyId,
          employeeId: effectiveGuardId,
          status: "APPROVED",
          startDate: { lte: dateOnly(existing.workDate) },
          endDate: { gte: dateOnly(existing.workDate) },
        },
        select: { id: true },
      })
    : null;
  if (approvedLeave) {
    return { error: "This employee is on approved leave. Cancel or adjust the leave before approving worked time." };
  }

  if (approving && needsOb) {
    if (!resolvedDutyOn) {
      return { error: "Duty ON OB number is required before you can approve this shift." };
    }
    if (!resolvedDutyOff) {
      return { error: "Duty OFF OB number is required before you can approve this shift." };
    }
  }

  let nextApprovalStatus: SiteTimesheetRowStatus | undefined = approvalAction;
  if (!approving) {
    if (!needsOb) {
      if (isRowFullyReviewed(existing.approvalStatus) && rowEditAffectsApproval(input)) {
        nextApprovalStatus = "pending";
      }
    } else {
      const dutyOnAfter = nextDutyOn !== undefined ? nextDutyOn : existingDutyOn;
      if (!dutyOnAfter) {
        nextApprovalStatus = "pending";
      } else if (
        !isRowFullyReviewed(existing.approvalStatus) ||
        rowEditAffectsApproval(input)
      ) {
        nextApprovalStatus = "partially_reviewed";
      }
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.siteTimesheetRow.update({
      where: { id: rowId },
      data: {
        actualGuardId: input.actualGuardId,
        actualShiftCode: input.actualShiftCode,
        actualShiftType: input.actualShiftType,
        clockIn: input.clockIn ? new Date(input.clockIn) : input.clockIn === null ? null : undefined,
        clockOut: input.clockOut ? new Date(input.clockOut) : input.clockOut === null ? null : undefined,
        hoursWorked: input.hoursWorked,
        overtimeHours: input.overtimeHours,
        attendanceStatus: input.attendanceStatus,
        ...(nextApprovalStatus !== undefined ? { approvalStatus: nextApprovalStatus } : {}),
        ...(nextDutyOn !== undefined
          ? { dutyOnObNumber: nextDutyOn, occurrenceBookNumber: nextDutyOn }
          : {}),
        ...(nextDutyOff !== undefined ? { dutyOffObNumber: nextDutyOff } : {}),
        comments: input.comments,
      },
    });
    await tx.siteTimesheet.update({
      where: { id: existing.siteTimesheetId },
      data: { status: "draft", reviewedAt: new Date() },
    });
    return tx.siteTimesheetRow.findUnique({
      where: { id: rowId },
      include: { plannedGuard: true, actualGuard: true },
    });
  });

  if (!updated) return null;

  await createAuditLog({
    userId: actor?.userId,
    companyId,
    action: approving ? "site_timesheet.row_approve" : "site_timesheet.row_update",
    entityType: "SiteTimesheetRow",
    entityId: rowId,
    metadata: {
      siteTimesheetId: existing.siteTimesheetId,
      workDate: dateKey(existing.workDate),
      approvalStatus: nextApprovalStatus ?? existing.approvalStatus,
      attendanceStatus: input.attendanceStatus ?? existing.attendanceStatus,
    },
  });

  const sheetContext = await prisma.siteTimesheet.findUnique({
    where: { id: existing.siteTimesheetId },
    include: { site: true, rows: true },
  });
  const discrepancyMap = sheetContext ? computeDiscrepancyMap(sheetContext.site, sheetContext.rows) : new Map();
  return { row: serializeRow(updated, discrepancyMap.get(updated.id) ?? []) };
}

export async function addSiteTimesheetRow(
  companyId: string,
  siteTimesheetId: string,
  input: {
    workDate: string;
    actualGuardId: string;
    actualShiftCode: string;
    actualShiftType: string;
    attendanceStatus: SiteTimesheetAttendance;
    dutyOnObNumber?: string | null;
    dutyOffObNumber?: string | null;
    occurrenceBookNumber?: string | null;
    comments?: string | null;
    hoursWorked?: number | null;
    overtimeHours?: number | null;
  }
) {
  const sheet = await prisma.siteTimesheet.findFirst({ where: { id: siteTimesheetId, companyId } });
  if (!sheet) return null;
  if (sheet.status === "approved" || sheet.status === "locked") {
    return { error: "Timesheet is approved and locked. Unlock it before adding rows." };
  }
  const periodStart = dateKey(sheet.periodStart);
  const periodEnd = dateKey(sheet.periodEnd);
  if (!isWorkDateWithinTimesheetPeriod(input.workDate, sheet.periodStart, sheet.periodEnd)) {
    return { error: `Row date must be between ${periodStart} and ${periodEnd}.` };
  }
  if (!(await guardBelongsToCompany(input.actualGuardId, companyId))) {
    return { error: "Guard not found, or is a roster-planning placeholder. Assign a real employee before recording hours." };
  }
  const dutyOnObNumber =
    normalizeObNumber(input.dutyOnObNumber ?? input.occurrenceBookNumber) ?? null;
  if (!dutyOnObNumber) {
    return {
      error: "Duty ON OB number is required before you can add a reliever to the timesheet.",
    };
  }
  const dutyOffObNumber = normalizeObNumber(input.dutyOffObNumber) ?? null;
  const workedTimeError = validateWorkedTime({
    clockIn: null,
    clockOut: null,
    hoursWorked: input.hoursWorked ?? null,
    overtimeHours: input.overtimeHours ?? null,
  });
  if (workedTimeError) return { error: workedTimeError };
  const workDate = dateOnly(input.workDate);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.siteTimesheetRow.create({
      data: {
        companyId,
        siteTimesheetId,
        siteId: sheet.siteId,
        workDate,
        actualGuardId: input.actualGuardId,
        actualShiftCode: input.actualShiftCode,
        actualShiftType: input.actualShiftType,
        attendanceStatus: input.attendanceStatus,
        approvalStatus: "partially_reviewed",
        dutyOnObNumber,
        dutyOffObNumber,
        occurrenceBookNumber: dutyOnObNumber,
        comments: input.comments,
        hoursWorked: input.hoursWorked,
        overtimeHours: input.overtimeHours,
      },
    });
    return tx.siteTimesheetRow.findUnique({
      where: { id: created.id },
      include: { plannedGuard: true, actualGuard: true },
    });
  });
  if (!row) return null;
  await createAuditLog({
    companyId,
    action: "site_timesheet.row_add",
    entityType: "SiteTimesheetRow",
    entityId: row.id,
    metadata: {
      siteTimesheetId,
      workDate: input.workDate,
      actualGuardId: input.actualGuardId,
      actualShiftType: input.actualShiftType,
    },
  });
  const sheetContext = await prisma.siteTimesheet.findUnique({
    where: { id: siteTimesheetId },
    include: { site: true, rows: true },
  });
  const discrepancyMap = sheetContext ? computeDiscrepancyMap(sheetContext.site, sheetContext.rows) : new Map();
  return { row: serializeRow(row, discrepancyMap.get(row.id) ?? []) };
}

export type BulkConfirmEntry = {
  rowId: string;
  dutyOnObNumber?: string | null;
  dutyOffObNumber?: string | null;
};

export type BulkConfirmFailureCode =
  | "ROW_NOT_FOUND"
  | "ALREADY_REVIEWED"
  | "NOT_AS_SCHEDULED"
  | "PLACEHOLDER_GUARD"
  | "HAS_DISCREPANCY"
  | "NO_SHIFT_TYPE"
  | "ON_APPROVED_LEAVE"
  | "OB_LOCKED"
  | "MISSING_OB";

export type BulkConfirmFailure = {
  rowId: string;
  code: BulkConfirmFailureCode;
  message: string;
};

/**
 * Discrepancy codes that describe THIS row and so must block confirming it as scheduled.
 *
 * DAY_COVERAGE_SHORT / NIGHT_COVERAGE_SHORT are deliberately excluded: they are computed
 * per site and date and attach to every row on that date, so one genuinely absent guard
 * would otherwise block bulk confirmation of all the colleagues who did turn up — the
 * single most common case this feature exists to handle. The shortfall stays visible on
 * the sheet and still has to be resolved before approval.
 */
const ROW_LEVEL_DISCREPANCY_CODES = new Set([
  "ROSTERED_NOT_WORKED",
  "UNROSTERED_WORKED",
  "SHIFT_SWAPPED",
  "RELIEVER_COVERED",
  "SHIFT_TYPE_CHANGED",
  "OVERTIME_OR_EXTRA_SHIFT",
  "ABSENT_WITHOUT_REPLACEMENT",
]);

const BULK_CONFIRM_MESSAGES: Record<BulkConfirmFailureCode, string> = {
  ROW_NOT_FOUND: "This shift is no longer on the timesheet. Refresh and try again.",
  ALREADY_REVIEWED: "This shift has already been confirmed.",
  NOT_AS_SCHEDULED:
    "Someone other than the rostered guard worked this shift. Confirm it individually.",
  PLACEHOLDER_GUARD:
    "This shift is still assigned to a roster placeholder. Assign a real employee first.",
  HAS_DISCREPANCY: "This shift does not match the roster. Review and confirm it individually.",
  NO_SHIFT_TYPE:
    "This shift has no day or night shift on the roster, so its times cannot be filled in automatically. Confirm it individually.",
  ON_APPROVED_LEAVE:
    "This employee is on approved leave. Cancel or adjust the leave before recording worked time.",
  OB_LOCKED: "An OB number is already recorded and needs attendance approval access to change.",
  MISSING_OB: "Duty ON and Duty OFF OB numbers are both required before confirming.",
};

/**
 * Confirm many rows as "worked exactly as scheduled" in one request.
 *
 * Eligibility is recomputed here rather than trusted from the client: `discrepancyCodes`
 * arrives in the browser as a serialized snapshot, and a page left open can ask to bulk
 * confirm a row that has since changed.
 *
 * Each row succeeds or fails on its own — one bad row must not block the rest — so this
 * resolves to a 200 with both lists rather than failing the whole request. The one
 * exception is a locked sheet, which is a precondition for the whole operation.
 */
export async function bulkConfirmSiteTimesheetRows(
  companyId: string,
  timesheetId: string,
  entries: BulkConfirmEntry[],
  actor: { canOverrideObNumbers: boolean; userId?: string }
) {
  const sheet = await prisma.siteTimesheet.findFirst({
    where: { id: timesheetId, companyId },
    include: { site: true, rows: true },
  });
  if (!sheet) return null;
  if (sheet.status === "approved" || sheet.status === "locked") {
    return { error: "Timesheet is approved and locked. Unlock it before making changes." };
  }

  const timeZone = await getCompanyTimezone(companyId);
  const rowsById = new Map(sheet.rows.map((row) => [row.id, row]));

  // De-duplicate defensively: a repeated rowId would otherwise be written twice.
  const requested = new Map<string, BulkConfirmEntry>();
  for (const entry of entries) requested.set(entry.rowId, entry);

  const candidateGuardIds = [...requested.keys()]
    .map((rowId) => rowsById.get(rowId)?.plannedGuardId)
    .filter((id): id is string => typeof id === "string");
  const placeholderGuardIds = await getPlaceholderGuardIds(prisma, [...new Set(candidateGuardIds)]);

  // One batched leave query for the whole request — never one per row.
  const leaveConditions = [...requested.keys()]
    .map((rowId) => rowsById.get(rowId))
    .filter((row): row is (typeof sheet.rows)[number] => Boolean(row?.plannedGuardId))
    .map((row) => ({ employeeId: row.plannedGuardId!, leaveDate: dateOnly(row.workDate) }));
  const leaveRecords =
    leaveConditions.length > 0
      ? await prisma.leaveRequest.findMany({
          where: {
            companyId,
            status: "APPROVED",
            OR: leaveConditions.map((condition) => ({
              employeeId: condition.employeeId,
              startDate: { lte: condition.leaveDate },
              endDate: { gte: condition.leaveDate },
            })),
          },
          select: { employeeId: true, startDate: true, endDate: true },
        })
      : [];
  const isOnApprovedLeave = (employeeId: string, workDate: Date) =>
    leaveRecords.some(
      (leave) =>
        leave.employeeId === employeeId &&
        leave.startDate <= dateOnly(workDate) &&
        leave.endDate >= dateOnly(workDate)
    );

  const failed: BulkConfirmFailure[] = [];
  const fail = (rowId: string, code: BulkConfirmFailureCode) => {
    failed.push({ rowId, code, message: BULK_CONFIRM_MESSAGES[code] });
  };

  const writes: Array<{ rowId: string; data: Prisma.SiteTimesheetRowUpdateInput; workDate: Date }> = [];
  const patchByRowId = new Map<string, ConfirmAsScheduledPatch>();

  for (const [rowId, entry] of requested) {
    const row = rowsById.get(rowId);
    if (!row) {
      fail(rowId, "ROW_NOT_FOUND");
      continue;
    }
    if (isRowFullyReviewed(row.approvalStatus)) {
      fail(rowId, "ALREADY_REVIEWED");
      continue;
    }
    if (!row.plannedGuardId || (row.actualGuardId && row.actualGuardId !== row.plannedGuardId)) {
      fail(rowId, "NOT_AS_SCHEDULED");
      continue;
    }
    if (placeholderGuardIds.has(row.plannedGuardId)) {
      fail(rowId, "PLACEHOLDER_GUARD");
      continue;
    }

    const patch = buildConfirmAsScheduledPatch(row, timeZone);
    if (!patch) {
      // Never guess a shift type here — see buildConfirmAsScheduledPatch for why a null
      // actualShiftType causes payroll to count the underlying Shift twice.
      fail(rowId, "NO_SHIFT_TYPE");
      continue;
    }

    if (isOnApprovedLeave(row.plannedGuardId, row.workDate)) {
      fail(rowId, "ON_APPROVED_LEAVE");
      continue;
    }

    const existingDutyOn = resolveDutyOnFromRow(row);
    const existingDutyOff = normalizeObNumber(row.dutyOffObNumber) ?? null;
    const requestedDutyOn =
      entry.dutyOnObNumber !== undefined ? normalizeObNumber(entry.dutyOnObNumber) : undefined;
    const requestedDutyOff =
      entry.dutyOffObNumber !== undefined ? normalizeObNumber(entry.dutyOffObNumber) : undefined;

    const obLocked =
      (requestedDutyOn !== undefined &&
        existingDutyOn &&
        requestedDutyOn !== existingDutyOn &&
        !actor.canOverrideObNumbers) ||
      (requestedDutyOff !== undefined &&
        existingDutyOff &&
        requestedDutyOff !== existingDutyOff &&
        !actor.canOverrideObNumbers);
    if (obLocked) {
      fail(rowId, "OB_LOCKED");
      continue;
    }

    const resolvedDutyOn = requestedDutyOn !== undefined ? requestedDutyOn : existingDutyOn;
    const resolvedDutyOff = requestedDutyOff !== undefined ? requestedDutyOff : existingDutyOff;
    if (rowNeedsObNumbers(patch.attendanceStatus) && (!resolvedDutyOn || !resolvedDutyOff)) {
      fail(rowId, "MISSING_OB");
      continue;
    }

    patchByRowId.set(rowId, patch);
    writes.push({
      rowId,
      workDate: row.workDate,
      data: {
        actualGuard: { connect: { id: patch.actualGuardId } },
        actualShiftType: patch.actualShiftType,
        actualShiftCode: patch.actualShiftCode,
        clockIn: patch.clockIn,
        clockOut: patch.clockOut,
        hoursWorked: patch.hoursWorked,
        attendanceStatus: patch.attendanceStatus,
        approvalStatus: "reviewed",
        dutyOnObNumber: resolvedDutyOn,
        // Kept in step with dutyOnObNumber for the deprecated single-OB consumers.
        occurrenceBookNumber: resolvedDutyOn,
        dutyOffObNumber: resolvedDutyOff,
      },
    });
  }

  // Judge discrepancies on what the sheet WOULD look like once these rows are confirmed,
  // not on their current state: an uncaptured rostered row has no actual guard or shift
  // yet, so measured as-is every clean row looks like a coverage shortfall.
  const projectedRows = sheet.rows.map((row) => {
    const patch = patchByRowId.get(row.id);
    if (!patch) return row;
    return {
      ...row,
      actualGuardId: patch.actualGuardId,
      actualShiftType: patch.actualShiftType,
      actualShiftCode: patch.actualShiftCode,
      attendanceStatus: patch.attendanceStatus,
    };
  });
  const projectedDiscrepancies = computeDiscrepancyMap(sheet.site, projectedRows);

  const eligible = writes.filter((write) => {
    const rowLevel = (projectedDiscrepancies.get(write.rowId) ?? []).filter((code) =>
      ROW_LEVEL_DISCREPANCY_CODES.has(code)
    );
    if (rowLevel.length === 0) return true;
    fail(write.rowId, "HAS_DISCREPANCY");
    return false;
  });

  if (eligible.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const write of eligible) {
        await tx.siteTimesheetRow.update({ where: { id: write.rowId }, data: write.data });
      }
      await tx.siteTimesheet.update({
        where: { id: timesheetId },
        data: { status: "draft", reviewedAt: new Date() },
      });
    });
  }

  await createAuditLog({
    userId: actor.userId,
    companyId,
    action: "site_timesheet.rows_bulk_confirm",
    entityType: "SiteTimesheet",
    entityId: timesheetId,
    metadata: {
      requestedCount: requested.size,
      confirmedRowIds: eligible.map((write) => write.rowId),
      failedCodes: failed.map((failure) => ({ rowId: failure.rowId, code: failure.code })),
    },
  });

  // Per-row entries too, so the existing row-level audit trail stays complete whether a
  // row was confirmed one at a time or in a batch.
  for (const write of eligible) {
    await createAuditLog({
      userId: actor.userId,
      companyId,
      action: "site_timesheet.row_approve",
      entityType: "SiteTimesheetRow",
      entityId: write.rowId,
      metadata: {
        siteTimesheetId: timesheetId,
        workDate: dateKey(write.workDate),
        approvalStatus: "reviewed",
        attendanceStatus: write.data.attendanceStatus,
        via: "bulk_confirm",
      },
    });
  }

  return {
    confirmed: eligible.map((write) => write.rowId),
    failed,
  };
}

/**
 * Approve a site timesheet for payroll.
 * - shiftType omitted or "all": every row must already be reviewed (and have OB when approving working rows).
 * - shiftType day|night: only matching rows are marked approved; sheet stays draft until all rows are approved.
 * Short-term policy: full sheet lock requires zero pending rows across all shifts.
 */
export async function approveSiteTimesheet(
  companyId: string,
  timesheetId: string,
  userId: string,
  options?: { notes?: string; shiftType?: CaptureShiftTypeFilter }
) {
  const sheet = await prisma.siteTimesheet.findFirst({
    where: { id: timesheetId, companyId },
    include: {
      rows: {
        select: {
          id: true,
          approvalStatus: true,
          dutyOnObNumber: true,
          dutyOffObNumber: true,
          occurrenceBookNumber: true,
          plannedShiftType: true,
          plannedShiftCode: true,
          actualShiftType: true,
          actualShiftCode: true,
          attendanceStatus: true,
          actualGuardId: true,
          plannedGuardId: true,
          workDate: true,
        },
      },
    },
  });
  if (!sheet) return null;
  if (sheet.status === "approved" || sheet.status === "locked") {
    return { error: "Timesheet is already approved and locked." };
  }

  const shiftType: CaptureShiftTypeFilter = options?.shiftType ?? "all";
  const targetRows =
    shiftType === "all"
      ? sheet.rows
      : sheet.rows.filter((r) => rowMatchesShiftTypeFilter(r, shiftType));

  if (targetRows.length === 0) {
    return {
      error:
        shiftType === "all"
          ? "This timesheet has no rows to approve."
          : `No ${shiftType}-shift rows to approve. Switch shift type or review the other shift first.`,
    };
  }

  const pendingInScope = targetRows.filter((r) => isRowPendingReview(r.approvalStatus));
  if (pendingInScope.length > 0) {
    const label = shiftType === "all" ? "rows" : `${shiftType}-shift rows`;
    return {
      error: `${pendingInScope.length} ${label} still need individual review (Duty ON/OFF OB and Approve) before you can approve for payroll.`,
    };
  }

  const missingOb = targetRows.filter((r) => {
    if (!rowNeedsObNumbers(r.attendanceStatus)) return false;
    const dutyOn = resolveDutyOnFromRow(r);
    const dutyOff = normalizeObNumber(r.dutyOffObNumber) ?? null;
    return !dutyOn || !dutyOff;
  });
  if (missingOb.length > 0) {
    return {
      error: `${missingOb.length} row(s) are missing Duty ON and/or Duty OFF OB numbers.`,
    };
  }

  const rowsNeedingLeaveCheck = targetRows.filter((row) =>
    !["leave", "sick_leave", "off", "absent", "pending"].includes(row.attendanceStatus) &&
    Boolean(row.actualGuardId ?? row.plannedGuardId)
  );
  if (rowsNeedingLeaveCheck.length > 0) {
    const conflictConditions = rowsNeedingLeaveCheck.map((row) => ({
      employeeId: row.actualGuardId ?? row.plannedGuardId!,
      leaveDate: dateOnly(row.workDate),
    }));
    const conflicts = await prisma.leaveRequest.findMany({
      where: {
        companyId,
        status: "APPROVED",
        OR: conflictConditions.map((condition) => ({
          employeeId: condition.employeeId,
          startDate: { lte: condition.leaveDate },
          endDate: { gte: condition.leaveDate },
        })),
      },
      select: { employeeId: true, startDate: true, endDate: true },
    });
    const conflictCount = conflictConditions.filter((condition) =>
      conflicts.some((row) => row.employeeId === condition.employeeId && row.startDate <= condition.leaveDate && row.endDate >= condition.leaveDate)
    ).length;
    if (conflictCount > 0) {
      return { error: `${conflictCount} row(s) record work during approved leave. Cancel or adjust the leave before approving the timesheet.` };
    }
  }

  const targetIds = targetRows.map((r) => r.id);
  const remainingPending = sheet.rows.filter(
    (r) => !targetIds.includes(r.id) && isRowPendingReview(r.approvalStatus)
  );
  const lockSheet = remainingPending.length === 0;

  await prisma.$transaction(async (tx) => {
    await tx.siteTimesheetRow.updateMany({
      where: { id: { in: targetIds }, siteTimesheetId: timesheetId },
      data: { approvalStatus: "approved" },
    });
    if (lockSheet) {
      await tx.siteTimesheet.update({
        where: { id: timesheetId },
        data: {
          status: "locked",
          reviewedBy: userId,
          reviewedAt: new Date(),
          approvedBy: userId,
          approvedAt: new Date(),
          approvalNotes: options?.notes,
        },
      });
    } else {
      await tx.siteTimesheet.update({
        where: { id: timesheetId },
        data: {
          status: "draft",
          reviewedBy: userId,
          reviewedAt: new Date(),
          approvalNotes: options?.notes,
        },
      });
    }
  });

  await createAuditLog({
    userId,
    companyId,
    action: lockSheet ? "site_timesheet.approve_lock" : "site_timesheet.approve_partial",
    entityType: "SiteTimesheet",
    entityId: timesheetId,
    metadata: {
      shiftType,
      approvedRowCount: targetIds.length,
      remainingPending: remainingPending.length,
      locked: lockSheet,
    },
  });

  return {
    success: true as const,
    locked: lockSheet,
    approvedRowCount: targetIds.length,
    remainingPending: remainingPending.length,
    shiftType,
  };
}

export async function unlockSiteTimesheet(companyId: string, timesheetId: string, userId: string, reason?: string) {
  const sheet = await prisma.siteTimesheet.findFirst({ where: { id: timesheetId, companyId } });
  if (!sheet) return null;
  if (sheet.status !== "approved" && sheet.status !== "locked") {
    return { error: "Timesheet is not approved or locked; there is nothing to unlock." };
  }
  await prisma.$transaction(async (tx) => {
    await tx.siteTimesheetRow.updateMany({
      where: { siteTimesheetId: timesheetId, companyId },
      data: { approvalStatus: "pending" },
    });
    await tx.siteTimesheet.update({
      where: { id: timesheetId },
      data: {
        status: "draft",
        reviewedBy: null,
        reviewedAt: null,
        approvedBy: null,
        approvedAt: null,
        approvalNotes: null,
        unlockedBy: userId,
        unlockedAt: new Date(),
        unlockReason: reason,
      },
    });
  });
  await createAuditLog({
    userId,
    companyId,
    action: "site_timesheet.unlock",
    entityType: "SiteTimesheet",
    entityId: timesheetId,
    metadata: { reason: reason ?? null, previousStatus: sheet.status },
  });
  return { success: true };
}

export function buildSiteTimesheetCsv(
  sheet: Awaited<ReturnType<typeof getSiteTimesheet>>,
  shiftType: CaptureShiftTypeFilter = "all"
): string {
  if (!sheet) return "";
  const rows =
    shiftType === "all"
      ? sheet.rows
      : sheet.rows.filter((row) => rowMatchesShiftTypeFilter(row, shiftType));
  const header = [
    "Site",
    "Period Start",
    "Period End",
    "Date",
    "Day",
    "Scheduled Guard",
    "Actual Guard",
    "Employee/PSIRA",
    "Planned Shift",
    "Actual Shift",
    "Clock In",
    "Clock Out",
    "Hours",
    "Overtime",
    "Attendance Status",
    "Approval Status",
    "Duty ON OB",
    "Duty OFF OB",
    "Discrepancies",
    "Comments",
  ];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    header.map(escape).join(","),
    ...rows.map((row) =>
      [
        sheet.siteName,
        sheet.periodStart,
        sheet.periodEnd,
        row.workDate,
        row.dayOfWeek,
        row.plannedGuardName,
        row.actualGuardName,
        row.employeeNumber ?? row.psiraRegistrationNumber,
        row.plannedShiftType ?? row.plannedShiftCode,
        row.actualShiftType ?? row.actualShiftCode,
        row.clockIn,
        row.clockOut,
        row.hoursWorked,
        row.overtimeHours,
        row.attendanceStatus,
        row.approvalStatus,
        row.dutyOnObNumber ?? row.occurrenceBookNumber,
        row.dutyOffObNumber,
        row.discrepancyCodes.join("; "),
        row.comments,
      ].map(escape).join(",")
    ),
  ].join("\n");
}
