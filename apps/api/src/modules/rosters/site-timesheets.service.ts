import { format } from "date-fns";
import type { Prisma, SiteRosterShiftCode, SiteTimesheetAttendance, SiteTimesheetRowStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
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

function normalizeShiftType(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === "day" || value === "night") return value;
  if (value === "D") return "day";
  if (value === "N") return "night";
  return value;
}

function rowShiftSortOrder(row: {
  plannedShiftType?: string | null;
  plannedShiftCode?: string | null;
  actualShiftType?: string | null;
  actualShiftCode?: string | null;
}): number {
  const shift =
    normalizeShiftType(row.plannedShiftType ?? row.plannedShiftCode) ??
    normalizeShiftType(row.actualShiftType ?? row.actualShiftCode);
  if (shift === "day") return 0;
  if (shift === "night") return 1;
  return 2;
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

  const shiftByGuardDate = new Map<string, (typeof shifts)[number]>();
  for (const shift of shifts) {
    shiftByGuardDate.set(`${shift.employeeId}:${dateKey(shift.startTime)}`, shift);
  }

  const rows: Prisma.SiteTimesheetRowCreateManyInput[] = [];
  for (const p of planned) {
    if (!WORKING_CODES.has(p.shiftCode)) continue;
    const shift = shiftByGuardDate.get(`${p.guardId}:${dateKey(p.rosterDate)}`);
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

  const shiftByGuardDate = new Map<string, (typeof shifts)[number]>();
  for (const shift of shifts) {
    shiftByGuardDate.set(`${shift.employeeId}:${dateKey(shift.startTime)}`, shift);
  }

  const rowByPlanned = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    if (row.plannedGuardId) rowByPlanned.set(`${row.plannedGuardId}:${dateKey(row.workDate)}`, row);
  }

  // 1. Add rows for newly published roster cells that have no row yet.
  const toCreate: Prisma.SiteTimesheetRowCreateManyInput[] = [];
  for (const p of planned) {
    if (!WORKING_CODES.has(p.shiftCode)) continue;
    const key = `${p.guardId}:${dateKey(p.rosterDate)}`;
    if (rowByPlanned.has(key)) continue;
    const shift = shiftByGuardDate.get(key);
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
    const shift = shiftByGuardDate.get(`${row.plannedGuardId}:${dateKey(row.workDate)}`);
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
    occurrenceBookNumber: row.occurrenceBookNumber,
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
  reviewedRows: number;
  lastCapturedDate: string | null;
  timesheetStatus: "draft" | "approved" | "locked" | "none";
};

export async function getSiteTimesheetCaptureOverview(companyId: string, startDate: string, endDate: string) {
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
      sites: sites.map((site) => ({
        siteId: site.id,
        siteName: site.name,
        status: "no_shifts" as const,
        dueDays: 0,
        pendingRows: 0,
        reviewedRows: 0,
        lastCapturedDate: null,
        timesheetStatus: "none" as const,
      })),
      summary: { totalSites: sites.length, needsCapture: 0, caughtUp: 0, noShifts: sites.length },
    };
  }

  const captureEnd = end.getTime() < today.getTime() ? end : today;

  const rosteredSiteIds = await prisma.siteRosterGeneratedShift.findMany({
    where: {
      companyId,
      rosterDate: { gte: start, lte: captureEnd },
      shiftCode: { in: WORKING_SHIFT_CODES },
    },
    distinct: ["siteId"],
    select: { siteId: true },
  });
  const rosteredSet = new Set(rosteredSiteIds.map((r) => r.siteId));

  const siteStatuses: SiteCaptureOverviewSite[] = await Promise.all(
    sites.map(async (site) => {
      if (!rosteredSet.has(site.id)) {
        return {
          siteId: site.id,
          siteName: site.name,
          status: "no_shifts" as const,
          dueDays: 0,
          pendingRows: 0,
          reviewedRows: 0,
          lastCapturedDate: null,
          timesheetStatus: "none" as const,
        };
      }

      const sheet = await getOrCreateTimesheet(prisma, companyId, site.id, start, end);
      await seedRows(prisma, companyId, sheet.id, site.id, start, end);

      const [rows, timesheet] = await Promise.all([
        prisma.siteTimesheetRow.findMany({
          where: {
            siteTimesheetId: sheet.id,
            workDate: { gte: start, lte: captureEnd },
          },
          select: { workDate: true, approvalStatus: true },
        }),
        prisma.siteTimesheet.findUnique({
          where: { id: sheet.id },
          select: { status: true },
        }),
      ]);

      const pendingRows = rows.filter((r) => r.approvalStatus === "pending");
      const pendingDates = new Set(pendingRows.map((r) => dateKey(r.workDate)));
      const capturedDates = rows
        .filter((r) => r.approvalStatus !== "pending")
        .map((r) => dateKey(r.workDate))
        .sort();

      return {
        siteId: site.id,
        siteName: site.name,
        status: (pendingRows.length > 0 ? "needs_capture" : "caught_up") as "needs_capture" | "caught_up",
        dueDays: pendingDates.size,
        pendingRows: pendingRows.length,
        reviewedRows: rows.length - pendingRows.length,
        lastCapturedDate: capturedDates.at(-1) ?? null,
        timesheetStatus: timesheet?.status ?? "draft",
      };
    })
  );

  return {
    periodStart: dateKey(start),
    periodEnd: dateKey(end),
    captureThrough: dateKey(captureEnd),
    asOfDate: dateKey(today),
    sites: siteStatuses,
    summary: {
      totalSites: sites.length,
      needsCapture: siteStatuses.filter((s) => s.status === "needs_capture").length,
      caughtUp: siteStatuses.filter((s) => s.status === "caught_up").length,
      noShifts: siteStatuses.filter((s) => s.status === "no_shifts").length,
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

function normalizeOccurrenceBookNumber(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
    occurrenceBookNumber?: string | null;
    comments?: string | null;
  }
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

  const nextOccurrenceBookNumber = normalizeOccurrenceBookNumber(input.occurrenceBookNumber);
  const approving =
    input.approvalStatus === "reviewed" || input.approvalStatus === "approved";
  if (approving) {
    const obNumber =
      nextOccurrenceBookNumber !== undefined
        ? nextOccurrenceBookNumber
        : normalizeOccurrenceBookNumber(existing.occurrenceBookNumber) ?? null;
    if (!obNumber) {
      return {
        error:
          "Occurrence Book (OB) number is required before you can approve this shift.",
      };
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
        approvalStatus: input.approvalStatus,
        ...(nextOccurrenceBookNumber !== undefined
          ? { occurrenceBookNumber: nextOccurrenceBookNumber }
          : {}),
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
        approvalStatus: "reviewed",
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
  const sheetContext = await prisma.siteTimesheet.findUnique({
    where: { id: siteTimesheetId },
    include: { site: true, rows: true },
  });
  const discrepancyMap = sheetContext ? computeDiscrepancyMap(sheetContext.site, sheetContext.rows) : new Map();
  return { row: serializeRow(row, discrepancyMap.get(row.id) ?? []) };
}

export async function approveSiteTimesheet(companyId: string, timesheetId: string, userId: string, notes?: string) {
  const sheet = await prisma.siteTimesheet.findFirst({ where: { id: timesheetId, companyId } });
  if (!sheet) return null;
  await prisma.siteTimesheet.update({
    where: { id: timesheetId },
    data: {
      status: "approved",
      reviewedBy: userId,
      reviewedAt: new Date(),
      approvedBy: userId,
      approvedAt: new Date(),
      approvalNotes: notes,
      rows: { updateMany: { where: {}, data: { approvalStatus: "approved" } } },
    },
  });
  return { success: true };
}

export async function unlockSiteTimesheet(companyId: string, timesheetId: string, userId: string, reason?: string) {
  const sheet = await prisma.siteTimesheet.findFirst({ where: { id: timesheetId, companyId } });
  if (!sheet) return null;
  await prisma.siteTimesheet.update({
    where: { id: timesheetId },
    data: { status: "draft", unlockedBy: userId, unlockedAt: new Date(), unlockReason: reason },
  });
  return { success: true };
}

export function buildSiteTimesheetCsv(sheet: Awaited<ReturnType<typeof getSiteTimesheet>>): string {
  if (!sheet) return "";
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
    "OB Number",
    "Discrepancies",
    "Comments",
  ];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    header.map(escape).join(","),
    ...sheet.rows.map((row) =>
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
        row.occurrenceBookNumber,
        row.discrepancyCodes.join("; "),
        row.comments,
      ].map(escape).join(",")
    ),
  ].join("\n");
}
