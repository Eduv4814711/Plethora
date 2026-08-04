import { prisma } from "../../lib/prisma.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../../lib/timezone.js";
import { getSiteTimesheet } from "../rosters/site-timesheets.service.js";

/** A reporting window, always whole UTC days. `periodEnd` is inclusive. */
export type MonthPeriod = {
  /** `YYYY-MM`, or null when the window is a custom range rather than a calendar month. */
  month: string | null;
  periodStart: string;
  periodEnd: string;
  label: string;
};

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Calendar month in UTC: "2026-02" -> 2026-02-01 .. 2026-02-29. */
export function monthPeriod(month: string): MonthPeriod {
  const match = MONTH_PATTERN.exec(month);
  if (!match) {
    throw new Error(`Invalid month "${month}" — expected YYYY-MM`);
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  // Day 0 of the next month is the last day of this one, leap years included.
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    month,
    periodStart: utcDateKey(new Date(Date.UTC(year, monthIndex, 1))),
    periodEnd: utcDateKey(lastDay),
    label: `${MONTH_NAMES[monthIndex]} ${year}`,
  };
}

/** Explicit window, for companies that capture on a payroll cycle rather than a calendar month. */
export function periodFromRange(periodStart: string, periodEnd: string): MonthPeriod {
  if (!DATE_PATTERN.test(periodStart) || !DATE_PATTERN.test(periodEnd)) {
    throw new Error("Invalid period — expected YYYY-MM-DD");
  }
  if (periodEnd < periodStart) {
    throw new Error("periodEnd must not be before periodStart");
  }
  return {
    month: null,
    periodStart,
    periodEnd,
    label: `${periodStart} to ${periodEnd}`,
  };
}

/** Resolves the reporting window from query params, preferring an explicit range. */
export function resolvePeriod(query: {
  month?: string;
  periodStart?: string;
  periodEnd?: string;
}): MonthPeriod {
  if (query.periodStart && query.periodEnd) {
    return periodFromRange(query.periodStart, query.periodEnd);
  }
  if (!query.month) throw new Error("month (YYYY-MM) or periodStart+periodEnd is required");
  return monthPeriod(query.month);
}

/** Exclusive upper bound for timestamp columns — the instant after the last day. */
export function periodEndExclusive(period: MonthPeriod): Date {
  const end = new Date(`${period.periodEnd}T00:00:00.000Z`);
  return new Date(end.getTime() + 24 * 60 * 60 * 1000);
}

export type SiteExceptionSummary = {
  total: number;
  lateArrivals: number;
  missedClockIns: number;
  missedClockOuts: number;
  earlyDepartures: number;
  absences: number;
  openCritical: number;
};

export const EMPTY_EXCEPTION_SUMMARY: SiteExceptionSummary = {
  total: 0,
  lateArrivals: 0,
  missedClockIns: 0,
  missedClockOuts: 0,
  earlyDepartures: 0,
  absences: 0,
  openCritical: 0,
};

export type TimesheetSnapshot = NonNullable<Awaited<ReturnType<typeof getSiteTimesheet>>>;

export type SiteMonthReport = {
  site: {
    id: string;
    name: string;
    physicalAddress: string | null;
    serviceType: string | null;
    contactPersonName: string | null;
    contactPersonPhone: string | null;
    clientContactEmail: string | null;
    supervisorName: string | null;
  };
  period: MonthPeriod;
  timesheet: {
    id: string;
    status: string;
    approvedAt: string | null;
    approvalNotes: string | null;
    rowCount: number;
    totals: TimesheetSnapshot["totals"];
  };
  absences: { workDate: string; dayOfWeek: string; guardName: string | null; shiftType: string | null }[];
  discrepancies: { workDate: string; guardName: string | null; codes: string[] }[];
  incidents: {
    incidentNumber: string;
    title: string;
    incidentType: string;
    severity: string;
    status: string;
    incidentDateTime: string;
  }[];
  exceptions: SiteExceptionSummary;
  /** Non-fatal things the sender should see before emailing this out. */
  warnings: string[];
};

export type SiteReportSiteInput = SiteMonthReport["site"];

/** A timesheet that has not been signed off must never leave the building unmarked. */
export function isTimesheetApproved(status: string): boolean {
  return status === "approved" || status === "locked";
}

/**
 * Pure mapper — every bit of IO is done by the caller, so the shaping logic is testable
 * without a database or a browser.
 */
export function buildSiteMonthReport(input: {
  site: SiteReportSiteInput;
  period: MonthPeriod;
  timesheet: TimesheetSnapshot;
  incidents: SiteMonthReport["incidents"];
  exceptions: SiteExceptionSummary;
}): SiteMonthReport {
  const { timesheet } = input;
  const absences = timesheet.rows
    .filter((row) => row.attendanceStatus === "absent")
    .map((row) => ({
      workDate: row.workDate,
      dayOfWeek: row.dayOfWeek,
      guardName: row.plannedGuardName ?? row.actualGuardName,
      shiftType: row.plannedShiftType ?? row.actualShiftType,
    }));
  const discrepancies = timesheet.rows
    .filter((row) => row.discrepancyCodes.length > 0)
    .map((row) => ({
      workDate: row.workDate,
      guardName: row.actualGuardName ?? row.plannedGuardName,
      codes: row.discrepancyCodes,
    }));

  const warnings: string[] = [];
  if (!isTimesheetApproved(timesheet.status)) {
    warnings.push("Timesheet has not been approved yet");
  }
  if (timesheet.rows.length === 0) {
    warnings.push("No timesheet rows captured for this period");
  }
  if (timesheet.totals.discrepancies > 0) {
    warnings.push(`${timesheet.totals.discrepancies} row(s) have unresolved discrepancies`);
  }

  return {
    site: input.site,
    period: input.period,
    timesheet: {
      id: timesheet.id,
      status: timesheet.status,
      approvedAt: timesheet.approvedAt,
      approvalNotes: timesheet.approvalNotes,
      rowCount: timesheet.rows.length,
      totals: timesheet.totals,
    },
    absences,
    discrepancies,
    incidents: input.incidents,
    exceptions: input.exceptions,
    warnings,
  };
}

async function loadIncidents(
  companyId: string,
  siteId: string,
  period: MonthPeriod
): Promise<SiteMonthReport["incidents"]> {
  const incidents = await prisma.incident.findMany({
    where: {
      companyId,
      siteId,
      // Mirrors what the client portal already shows clients, so a report can never
      // contain an incident the portal deliberately hides.
      clientVisible: true,
      status: { not: "DRAFT" },
      incidentDateTime: {
        gte: new Date(`${period.periodStart}T00:00:00.000Z`),
        lt: periodEndExclusive(period),
      },
    },
    select: {
      incidentNumber: true,
      title: true,
      incidentType: true,
      severity: true,
      status: true,
      incidentDateTime: true,
    },
    orderBy: { incidentDateTime: "asc" },
    take: 200,
  });
  return incidents.map((incident) => ({
    ...incident,
    incidentDateTime: incident.incidentDateTime.toISOString(),
  }));
}

/**
 * Exceptions for one site over the worked period. Filtered through the site's shifts
 * (bucketed in company time) rather than `detectedAt`, which can lag the shift by a day.
 */
export async function getSiteExceptionSummary(
  companyId: string,
  siteId: string,
  period: MonthPeriod
): Promise<SiteExceptionSummary> {
  const timeZone = await getCompanyTimezone(companyId);
  const start = new Date(`${period.periodStart}T00:00:00.000Z`);
  const end = periodEndExclusive(period);
  const shifts = await prisma.shift.findMany({
    where: {
      companyId,
      siteId,
      // ±36h covers night shifts that start or end outside the UTC window.
      startTime: {
        gte: new Date(start.getTime() - 36 * 60 * 60 * 1000),
        lte: new Date(end.getTime() + 36 * 60 * 60 * 1000),
      },
    },
    select: { id: true, startTime: true },
  });
  const shiftIds = shifts
    .filter((shift) => {
      const key = dateKeyInTimeZone(shift.startTime, timeZone);
      return key >= period.periodStart && key <= period.periodEnd;
    })
    .map((shift) => shift.id);

  if (shiftIds.length === 0) return { ...EMPTY_EXCEPTION_SUMMARY };

  const [byType, openCritical] = await Promise.all([
    prisma.attendanceException.groupBy({
      by: ["exceptionType"],
      where: { companyId, siteId, shiftId: { in: shiftIds } },
      _count: { id: true },
    }),
    prisma.attendanceException.count({
      where: {
        companyId,
        siteId,
        shiftId: { in: shiftIds },
        severity: "CRITICAL",
        status: { in: ["OPEN", "UNDER_REVIEW"] },
      },
    }),
  ]);

  const countOf = (type: string) =>
    byType.find((entry) => entry.exceptionType === type)?._count.id ?? 0;

  return {
    total: byType.reduce((sum, entry) => sum + entry._count.id, 0),
    lateArrivals: countOf("LATE_ARRIVAL"),
    missedClockIns: countOf("MISSED_CLOCK_IN"),
    missedClockOuts: countOf("MISSED_CLOCK_OUT"),
    earlyDepartures: countOf("EARLY_DEPARTURE"),
    absences: countOf("ABSENT"),
    openCritical,
  };
}

async function loadReportSite(companyId: string, siteId: string, clientId: string) {
  const site = await prisma.site.findFirst({
    // The clientId predicate is the tenant-and-owner boundary: without it one client's
    // URL could render another client's site inside the same company.
    where: { id: siteId, companyId, clientId },
    select: {
      id: true,
      name: true,
      physicalAddress: true,
      serviceType: true,
      contactPersonName: true,
      contactPersonPhone: true,
      clientContactEmail: true,
      supervisor: { select: { name: true } },
    },
  });
  if (!site) return null;
  const { supervisor, ...rest } = site;
  return { ...rest, supervisorName: supervisor?.name ?? null } satisfies SiteReportSiteInput;
}

/** Full month report for one of a client's sites. Returns null if the site isn't theirs. */
export async function getSiteMonthReport(
  companyId: string,
  clientId: string,
  siteId: string,
  period: MonthPeriod
): Promise<SiteMonthReport | null> {
  const site = await loadReportSite(companyId, siteId, clientId);
  if (!site) return null;

  const timesheet = await getSiteTimesheet(companyId, siteId, period.periodStart, period.periodEnd);
  if (!timesheet) return null;

  const [incidents, exceptions] = await Promise.all([
    loadIncidents(companyId, siteId, period),
    getSiteExceptionSummary(companyId, siteId, period),
  ]);

  return buildSiteMonthReport({ site, period, timesheet, incidents, exceptions });
}

export type ClientMonthEndSite = {
  siteId: string;
  siteName: string;
  timesheetId: string | null;
  timesheetStatus: string;
  rowCount: number;
  totals: TimesheetSnapshot["totals"];
  incidentCount: number;
  exceptionTotal: number;
  warnings: string[];
};

export type ClientMonthEndSummary = {
  client: {
    id: string;
    name: string;
    contactPersonName: string | null;
    contactPersonRole: string | null;
    contactPersonMobile: string | null;
    email: string | null;
    physicalAddress: string | null;
  };
  period: MonthPeriod;
  recipients: string[];
  sites: ClientMonthEndSite[];
  totals: TimesheetSnapshot["totals"] & { incidents: number; exceptions: number };
  /** Timesheets already captured that overlap this window but use a different period. */
  otherPeriods: { siteId: string; periodStart: string; periodEnd: string; status: string }[];
  warnings: string[];
};

/** Report recipients, falling back to the billing/primary email when none are configured. */
export function resolveReportRecipients(client: {
  reportRecipients?: string[] | null;
  billingEmail?: string | null;
  email?: string | null;
}): string[] {
  const explicit = (client.reportRecipients ?? []).filter(Boolean);
  if (explicit.length > 0) return explicit;
  const fallback = client.billingEmail ?? client.email;
  return fallback ? [fallback] : [];
}

/** Month-end preview across every site a client owns — drives the UI before any PDF is built. */
export async function getClientMonthEndSummary(
  companyId: string,
  clientId: string,
  period: MonthPeriod,
  siteIds?: string[]
): Promise<ClientMonthEndSummary | null> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId },
    select: {
      id: true,
      name: true,
      email: true,
      billingEmail: true,
      reportRecipients: true,
      contactPersonName: true,
      contactPersonRole: true,
      contactPersonMobile: true,
      physicalAddress: true,
    },
  });
  if (!client) return null;

  const sites = await prisma.site.findMany({
    where: {
      companyId,
      clientId,
      ...(siteIds && siteIds.length > 0 ? { id: { in: siteIds } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const siteRows: ClientMonthEndSite[] = [];
  for (const site of sites) {
    // Sequential: getSiteTimesheet seeds rows, and parallel seeding of the same period
    // would race on the timesheet upsert.
    const timesheet = await getSiteTimesheet(
      companyId,
      site.id,
      period.periodStart,
      period.periodEnd
    );
    const [incidentCount, exceptions] = await Promise.all([
      prisma.incident.count({
        where: {
          companyId,
          siteId: site.id,
          clientVisible: true,
          status: { not: "DRAFT" },
          incidentDateTime: {
            gte: new Date(`${period.periodStart}T00:00:00.000Z`),
            lt: periodEndExclusive(period),
          },
        },
      }),
      getSiteExceptionSummary(companyId, site.id, period),
    ]);
    const warnings: string[] = [];
    if (!timesheet) {
      warnings.push("No timesheet could be loaded for this site");
    } else {
      if (!isTimesheetApproved(timesheet.status)) warnings.push("Timesheet not approved");
      if (timesheet.rows.length === 0) warnings.push("No rows captured for this period");
    }
    siteRows.push({
      siteId: site.id,
      siteName: site.name,
      timesheetId: timesheet?.id ?? null,
      timesheetStatus: timesheet?.status ?? "none",
      rowCount: timesheet?.rows.length ?? 0,
      totals: timesheet?.totals ?? {
        dayShifts: 0,
        nightShifts: 0,
        relieverShifts: 0,
        absences: 0,
        totalHours: 0,
        overtimeHours: 0,
        discrepancies: 0,
      },
      incidentCount,
      exceptionTotal: exceptions.total,
      warnings,
    });
  }

  // Surface sheets captured on a different cycle (e.g. 26th-25th payroll month) so an
  // empty calendar-month sheet is obviously the wrong window rather than missing data.
  const overlapping = sites.length
    ? await prisma.siteTimesheet.findMany({
        where: {
          companyId,
          siteId: { in: sites.map((s) => s.id) },
          periodStart: { lte: new Date(`${period.periodEnd}T00:00:00.000Z`) },
          periodEnd: { gte: new Date(`${period.periodStart}T00:00:00.000Z`) },
        },
        select: { siteId: true, periodStart: true, periodEnd: true, status: true },
      })
    : [];
  const otherPeriods = overlapping
    .map((sheet) => ({
      siteId: sheet.siteId,
      periodStart: utcDateKey(sheet.periodStart),
      periodEnd: utcDateKey(sheet.periodEnd),
      status: sheet.status,
    }))
    .filter(
      (sheet) => sheet.periodStart !== period.periodStart || sheet.periodEnd !== period.periodEnd
    );

  const totals = siteRows.reduce(
    (acc, row) => ({
      dayShifts: acc.dayShifts + row.totals.dayShifts,
      nightShifts: acc.nightShifts + row.totals.nightShifts,
      relieverShifts: acc.relieverShifts + row.totals.relieverShifts,
      absences: acc.absences + row.totals.absences,
      totalHours: acc.totalHours + row.totals.totalHours,
      overtimeHours: acc.overtimeHours + row.totals.overtimeHours,
      discrepancies: acc.discrepancies + row.totals.discrepancies,
      incidents: acc.incidents + row.incidentCount,
      exceptions: acc.exceptions + row.exceptionTotal,
    }),
    {
      dayShifts: 0,
      nightShifts: 0,
      relieverShifts: 0,
      absences: 0,
      totalHours: 0,
      overtimeHours: 0,
      discrepancies: 0,
      incidents: 0,
      exceptions: 0,
    }
  );

  const warnings: string[] = [];
  if (sites.length === 0) warnings.push("No sites are linked to this client");
  const unapproved = siteRows.filter((row) => !isTimesheetApproved(row.timesheetStatus));
  if (unapproved.length > 0) {
    warnings.push(
      `${unapproved.length} of ${siteRows.length} site timesheet(s) are not approved: ${unapproved
        .map((row) => row.siteName)
        .join(", ")}`
    );
  }
  if (otherPeriods.length > 0) {
    warnings.push(
      "Timesheets exist for a different period on some sites — check the capture cycle before sending"
    );
  }

  return {
    client: {
      id: client.id,
      name: client.name,
      contactPersonName: client.contactPersonName,
      contactPersonRole: client.contactPersonRole,
      contactPersonMobile: client.contactPersonMobile,
      email: client.email,
      physicalAddress: client.physicalAddress,
    },
    period,
    recipients: resolveReportRecipients(client),
    sites: siteRows,
    totals: {
      ...totals,
      totalHours: Math.round(totals.totalHours * 100) / 100,
      overtimeHours: Math.round(totals.overtimeHours * 100) / 100,
    },
    otherPeriods,
    warnings,
  };
}
