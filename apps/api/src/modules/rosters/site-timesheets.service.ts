import { format } from "date-fns";
import type { Prisma, SiteRosterShiftCode, SiteTimesheetAttendance, SiteTimesheetRowStatus } from "@prisma/client";
import { createAuditLog } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { getCompanyTimezone, inferShiftTypeFromStartTime } from "../../lib/timezone.js";
import { dateKey, dateOnly } from "./rosters.service.js";

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
}): SiteTimesheetAttendance {
  if (input.clockIn || input.clockOut) return "present";
  if (input.actualShiftCode === "R") return "reliever";
  if (input.actualShiftCode === "L") return "leave";
  if (input.actualShiftCode === "SL") return "sick_leave";
  if (input.actualShiftCode === "TR") return "training";
  if (input.actualShiftCode === "O" || input.actualShiftCode === "blank") return "off";
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

  const rows: Prisma.SiteTimesheetRowCreateManyInput[] = [];
  for (const p of planned) {
    if (!WORKING_CODES.has(p.shiftCode)) continue;
    const plannedType = normalizeShiftType(p.shiftType) ?? (p.shiftCode === "N" ? "night" : "day");
    const shift = shiftByGuardDateType.get(shiftMatchKey(p.guardId, p.rosterDate, plannedType));
    const attendance = shift?.attendances[0];
    rows.push({
      companyId,
      siteTimesheetId: timesheetId,
      siteId,
      workDate: p.rosterDate,
      plannedGuardId: p.guardId,
      actualGuardId: p.guardId,
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
      }),
      sourceShiftId: shift?.id ?? null,
      sourceAttendanceId: attendance?.id ?? null,
    });
  }

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

  // 1. Add rows for newly published roster cells that have no row yet.
  const toCreate: Prisma.SiteTimesheetRowCreateManyInput[] = [];
  for (const p of planned) {
    if (!WORKING_CODES.has(p.shiftCode)) continue;
    const plannedType = normalizeShiftType(p.shiftType) ?? (p.shiftCode === "N" ? "night" : "day");
    const key = shiftMatchKey(p.guardId, p.rosterDate, plannedType);
    if (rowByPlanned.has(key)) continue;
    const shift = shiftByGuardDateType.get(key);
    const attendance = shift?.attendances[0];
    toCreate.push({
      companyId,
      siteTimesheetId: timesheetId,
      siteId,
      workDate: p.rosterDate,
      plannedGuardId: p.guardId,
      actualGuardId: p.guardId,
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
      }),
      sourceShiftId: shift?.id ?? null,
      sourceAttendanceId: attendance?.id ?? null,
    });
  }
  if (toCreate.length > 0) await tx.siteTimesheetRow.createMany({ data: toCreate });

  // 2. Default actual worker to scheduled guard on rostered rows still missing one.
  for (const row of existingRows) {
    if (!row.plannedGuardId || row.actualGuardId) continue;
    if (row.approvalStatus !== "pending") continue;
    await tx.siteTimesheetRow.update({
      where: { id: row.id },
      data: { actualGuardId: row.plannedGuardId },
    });
  }

  // 3. Fill actual data on still-pending seeded rows that now have attendance.
  for (const row of existingRows) {
    if (!row.plannedGuardId) continue; // manual/reliever row
    if (row.attendanceStatus !== "pending") continue; // already actioned by an operator
    if (row.approvalStatus !== "pending") continue;
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
  site: { rosterDayShiftGuardsRequired: number; rosterNightShiftGuardsRequired: number },
  rows: DiscrepancyRow[]
): Map<string, string[]> {
  const coverageByDate = new Map<string, { actualDay: number; actualNight: number; requiredDay: number; requiredNight: number }>();
  for (const row of rows) {
    const key = dateKey(row.workDate);
    const coverage =
      coverageByDate.get(key) ?? {
        actualDay: 0,
        actualNight: 0,
        requiredDay: site.rosterDayShiftGuardsRequired,
        requiredNight: site.rosterNightShiftGuardsRequired,
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
  const psiraNumber = row.actualGuard?.psiraNumber ?? row.plannedGuard?.psiraNumber ?? null;
  return {
    id: row.id,
    workDate: dateKey(row.workDate),
    dayOfWeek: dayOfWeek(row.workDate),
    plannedGuardId: row.plannedGuardId,
    plannedGuardName: row.plannedGuard ? `${row.plannedGuard.firstName} ${row.plannedGuard.lastName}`.trim() : null,
    actualGuardId: row.actualGuardId,
    actualGuardName: row.actualGuard ? `${row.actualGuard.firstName} ${row.actualGuard.lastName}`.trim() : null,
    employeeNumber,
    psiraNumber,
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
    rows,
    totals: {
      ...totals,
      totalHours: Math.round(totals.totalHours * 100) / 100,
      overtimeHours: Math.round(totals.overtimeHours * 100) / 100,
    },
  };
}

/** Guard IDs on timesheet rows must reference employees of the same company (tenant boundary). */
async function guardBelongsToCompany(guardId: string, companyId: string): Promise<boolean> {
  const employee = await prisma.employee.findFirst({
    where: { id: guardId, companyId },
    select: { id: true },
  });
  return employee != null;
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

function resolveDutyOnFromRow(row: {
  dutyOnObNumber?: string | null;
  occurrenceBookNumber?: string | null;
}): string | null {
  return normalizeObNumber(row.dutyOnObNumber ?? row.occurrenceBookNumber) ?? null;
}

export async function updateSiteTimesheetRow(
  companyId: string,
  rowId: string,
  input: {
    actualGuardId?: string | null;
    actualShiftCode?: string | null;
    actualShiftType?: string | null;
    clockIn?: string | null;
    clockOut?: string | null;
    hoursWorked?: number | null;
    overtimeHours?: number | null;
    attendanceStatus?: SiteTimesheetAttendance;
    approvalStatus?: SiteTimesheetRowStatus;
    dutyOnObNumber?: string | null;
    dutyOffObNumber?: string | null;
    occurrenceBookNumber?: string | null;
    comments?: string | null;
  },
  actor?: { role: string; userId?: string }
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
    return { error: "Guard not found." };
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

  if (nextDutyOn !== undefined && existingDutyOn && nextDutyOn !== existingDutyOn && actor?.role !== "admin") {
    return {
      error: "Duty ON OB number can only be changed by an administrator once it has been entered.",
    };
  }
  if (nextDutyOff !== undefined && existingDutyOff && nextDutyOff !== existingDutyOff && actor?.role !== "admin") {
    return {
      error: "Duty OFF OB number can only be changed by an administrator once it has been entered.",
    };
  }

  const approving = input.approvalStatus === "reviewed" || input.approvalStatus === "approved";
  const resolvedDutyOn = nextDutyOn !== undefined ? nextDutyOn : existingDutyOn;
  const resolvedDutyOff = nextDutyOff !== undefined ? nextDutyOff : existingDutyOff;
  const attendanceStatus = input.attendanceStatus ?? existing.attendanceStatus;
  const needsOb = rowNeedsObNumbers(attendanceStatus);

  if (approving && needsOb) {
    if (!resolvedDutyOn) {
      return { error: "Duty ON OB number is required before you can approve this shift." };
    }
    if (!resolvedDutyOff) {
      return { error: "Duty OFF OB number is required before you can approve this shift." };
    }
  }

  let nextApprovalStatus: SiteTimesheetRowStatus | undefined = input.approvalStatus;
  if (!approving && input.approvalStatus === undefined) {
    if (!needsOb) {
      // off/leave rows can be reviewed without OB fields
    } else {
      const dutyOnAfter = nextDutyOn !== undefined ? nextDutyOn : existingDutyOn;
      if (!dutyOnAfter) {
        nextApprovalStatus = "pending";
      } else if (!isRowFullyReviewed(existing.approvalStatus)) {
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
  if (!(await guardBelongsToCompany(input.actualGuardId, companyId))) {
    return { error: "Guard not found." };
  }
  const dutyOnObNumber =
    normalizeObNumber(input.dutyOnObNumber ?? input.occurrenceBookNumber) ?? null;
  if (!dutyOnObNumber) {
    return {
      error: "Duty ON OB number is required before you can add a reliever to the timesheet.",
    };
  }
  const dutyOffObNumber = normalizeObNumber(input.dutyOffObNumber) ?? null;
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.siteTimesheetRow.create({
      data: {
        companyId,
        siteTimesheetId,
        siteId: sheet.siteId,
        workDate: dateOnly(input.workDate),
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
  await prisma.siteTimesheet.update({
    where: { id: timesheetId },
    data: { status: "draft", unlockedBy: userId, unlockedAt: new Date(), unlockReason: reason },
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
        row.employeeNumber ?? row.psiraNumber,
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
