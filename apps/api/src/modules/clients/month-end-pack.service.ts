import { prisma } from "../../lib/prisma.js";
import type { RenderPdfJob } from "../../lib/render-pdf.js";
import type { BillingPartyDetails } from "../../services/billing-pdf.service.js";
import {
  BRANDING_COMPANY_SELECT,
  issuerFrom,
  safeFilenamePart,
} from "../../services/company-branding.js";
import {
  generateReportBatch,
  monthEndCoverJob,
  siteReportJob,
  siteTimesheetJob,
  type SiteReportTemplateData,
  type SiteTimesheetTemplateData,
} from "../../services/client-report-pdf.service.js";
import {
  buildSiteTimesheetCsv,
  getSiteTimesheet,
} from "../rosters/site-timesheets.service.js";
import {
  getSiteMonthReport,
  isTimesheetApproved,
  resolveReportRecipients,
  type MonthPeriod,
  type SiteMonthReport,
} from "./site-report.service.js";

/**
 * Every site adds two Chromium renders and a PDF held in memory. Past this a pack
 * reliably outruns proxy timeouts, so we ask the caller to split it instead.
 */
export const MAX_PACK_SITES = 15;

export const DRAFT_WATERMARK = "DRAFT - NOT APPROVED";

export function watermarkForTimesheet(status: string): string | null {
  return isTimesheetApproved(status) ? null : DRAFT_WATERMARK;
}

export type PackSite = { id: string; name: string };

export type PackPlan =
  | { ok: true; sites: PackSite[] }
  | { ok: false; message: string };

/**
 * Pure: decides which of a client's sites go into the pack, in a stable order.
 * `siteIdFilter` may only narrow the client's own sites — never widen them.
 */
export function planMonthEndPack(
  clientSites: PackSite[],
  siteIdFilter?: string[],
  maxSites: number = MAX_PACK_SITES
): PackPlan {
  const ordered = [...clientSites].sort((a, b) => a.name.localeCompare(b.name));
  let selected = ordered;

  if (siteIdFilter && siteIdFilter.length > 0) {
    const known = new Set(ordered.map((site) => site.id));
    const unknown = siteIdFilter.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return { ok: false, message: `Site not linked to this client: ${unknown.join(", ")}` };
    }
    const wanted = new Set(siteIdFilter);
    selected = ordered.filter((site) => wanted.has(site.id));
  }

  if (selected.length === 0) {
    return { ok: false, message: "No sites to report on for this client" };
  }
  if (selected.length > maxSites) {
    return {
      ok: false,
      message: `A pack is limited to ${maxSites} sites — download the remaining sites separately`,
    };
  }
  return { ok: true, sites: selected };
}

export const TIMESHEET_PDF_COLUMNS = [
  "Date",
  "Day",
  "Scheduled Guard",
  "Actual Guard",
  "Employee/PSIRA",
  "Planned",
  "Actual",
  "Clock In",
  "Clock Out",
  "Hours",
  "OT",
  "Attendance",
  "Approval",
  "Duty ON OB",
  "Duty OFF OB",
  "Discrepancies",
  "Comments",
];

type TimesheetSheet = NonNullable<Awaited<ReturnType<typeof getSiteTimesheet>>>;

function timeOnly(iso: string | null): string {
  return iso ? iso.slice(11, 16) : "";
}

/** Pure: the 17 printed timesheet columns. Narrower than the CSV, which repeats site/period. */
export function timesheetPdfRows(sheet: TimesheetSheet): string[][] {
  return sheet.rows.map((row) => [
    row.workDate,
    row.dayOfWeek,
    row.plannedGuardName ?? "",
    row.actualGuardName ?? "",
    row.employeeNumber ?? row.psiraRegistrationNumber ?? "",
    row.plannedShiftType ?? row.plannedShiftCode ?? "",
    row.actualShiftType ?? row.actualShiftCode ?? "",
    timeOnly(row.clockIn),
    timeOnly(row.clockOut),
    row.hoursWorked == null ? "" : String(row.hoursWorked),
    row.overtimeHours == null ? "" : String(row.overtimeHours),
    row.attendanceStatus ?? "",
    row.approvalStatus ?? "",
    row.dutyOnObNumber ?? "",
    row.dutyOffObNumber ?? "",
    row.discrepancyCodes.join("; "),
    row.comments ?? "",
  ]);
}

/**
 * Pure: concatenates per-site CSVs into one file, keeping a single header row.
 * `buildSiteTimesheetCsv` emits its own header and already carries Site as column 1.
 */
export function mergeTimesheetCsvs(csvs: string[]): string {
  const sections: string[] = [];
  for (const csv of csvs) {
    if (!csv.trim()) continue;
    const newline = csv.indexOf("\n");
    // A site with no rows is header-only: nothing to contribute after the first sheet.
    const body = newline === -1 ? "" : csv.slice(newline + 1);
    if (sections.length === 0) {
      sections.push(csv);
    } else if (body.trim()) {
      sections.push(body);
    }
  }
  return sections.join("\n");
}

export function clientPartyFrom(client: {
  name: string;
  email: string | null;
  phone: string | null;
  billingEmail: string | null;
  physicalAddress: string | null;
  billingAddress: string | null;
  vatNumber: string | null;
  registrationNumber: string | null;
}): BillingPartyDetails {
  return {
    name: client.name,
    address: client.physicalAddress ?? client.billingAddress,
    email: client.billingEmail ?? client.email,
    phone: client.phone,
    vatNumber: client.vatNumber,
    registrationNumber: client.registrationNumber,
  };
}

const PACK_CLIENT_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  billingEmail: true,
  billingAddress: true,
  physicalAddress: true,
  vatNumber: true,
  registrationNumber: true,
  reportRecipients: true,
  contactPersonName: true,
  contactPersonRole: true,
  contactPersonMobile: true,
} as const;

export async function loadPackContext(companyId: string, clientId: string) {
  const [client, company] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, companyId }, select: PACK_CLIENT_SELECT }),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: BRANDING_COMPANY_SELECT }),
  ]);
  if (!client) return null;
  return { client, issuer: issuerFrom(company), party: clientPartyFrom(client) };
}

export function siteReportTemplateData(
  report: SiteMonthReport,
  issuer: BillingPartyDetails,
  client: BillingPartyDetails,
  generatedAt: string
): SiteReportTemplateData {
  return {
    issuer,
    client,
    generatedAt,
    watermark: watermarkForTimesheet(report.timesheet.status),
    periodLabel: report.period.label,
    periodStart: report.period.periodStart,
    periodEnd: report.period.periodEnd,
    site: {
      name: report.site.name,
      physicalAddress: report.site.physicalAddress,
      serviceType: report.site.serviceType,
      contactPersonName: report.site.contactPersonName,
      contactPersonPhone: report.site.contactPersonPhone,
      supervisorName: report.site.supervisorName,
    },
    timesheetStatus: report.timesheet.status,
    approvedAt: report.timesheet.approvedAt,
    totals: report.timesheet.totals,
    exceptions: report.exceptions,
    absences: report.absences,
    incidents: report.incidents,
  };
}

export function siteTimesheetTemplateData(
  sheet: TimesheetSheet,
  period: MonthPeriod,
  issuer: BillingPartyDetails,
  client: BillingPartyDetails,
  generatedAt: string
): SiteTimesheetTemplateData {
  return {
    issuer,
    client,
    generatedAt,
    watermark: watermarkForTimesheet(sheet.status),
    periodLabel: period.label,
    siteName: sheet.siteName,
    timesheetStatus: sheet.status,
    columns: TIMESHEET_PDF_COLUMNS,
    rows: timesheetPdfRows(sheet),
  };
}

async function mergePdfs(buffers: Buffer[]): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  for (const buffer of buffers) {
    const donor = await PDFDocument.load(buffer);
    const pages = await merged.copyPages(donor, donor.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return Buffer.from(await merged.save());
}

export type PackResult =
  | { ok: true; buffer: Buffer; filename: string }
  | { ok: false; statusCode: 400 | 404; message: string };

/** Cover page, then a site report and timesheet per site, merged into one PDF. */
export async function buildMonthEndPackPdf(
  companyId: string,
  clientId: string,
  period: MonthPeriod,
  options: { siteIds?: string[]; includeUnapproved: boolean }
): Promise<PackResult> {
  const context = await loadPackContext(companyId, clientId);
  if (!context) return { ok: false, statusCode: 404, message: "Client not found" };

  const clientSites = await prisma.site.findMany({
    where: { companyId, clientId },
    select: { id: true, name: true },
  });
  const plan = planMonthEndPack(clientSites, options.siteIds);
  if (!plan.ok) return { ok: false, statusCode: 400, message: plan.message };

  const generatedAt = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const reports: { report: SiteMonthReport; sheet: TimesheetSheet }[] = [];

  for (const site of plan.sites) {
    // Sequential: getSiteTimesheet seeds rows, and concurrent seeding of the same
    // period would race on the timesheet upsert.
    const report = await getSiteMonthReport(companyId, clientId, site.id, period);
    const sheet = await getSiteTimesheet(companyId, site.id, period.periodStart, period.periodEnd);
    if (!report || !sheet) {
      return { ok: false, statusCode: 404, message: `Site not found: ${site.name}` };
    }
    reports.push({ report, sheet });
  }

  const unapproved = reports.filter(({ sheet }) => !isTimesheetApproved(sheet.status));
  if (unapproved.length > 0 && !options.includeUnapproved) {
    return {
      ok: false,
      statusCode: 400,
      message: `${unapproved.length} site timesheet(s) are not approved (${unapproved
        .map(({ sheet }) => sheet.siteName)
        .join(", ")}). Re-request with includeUnapproved=true to send a draft pack.`,
    };
  }

  const incidentTotal = reports.reduce((sum, { report }) => sum + report.incidents.length, 0);
  const totals = reports.reduce(
    (acc, { sheet }) => ({
      dayShifts: acc.dayShifts + sheet.totals.dayShifts,
      nightShifts: acc.nightShifts + sheet.totals.nightShifts,
      absences: acc.absences + sheet.totals.absences,
      totalHours: acc.totalHours + sheet.totals.totalHours,
      overtimeHours: acc.overtimeHours + sheet.totals.overtimeHours,
      incidents: incidentTotal,
    }),
    { dayShifts: 0, nightShifts: 0, absences: 0, totalHours: 0, overtimeHours: 0, incidents: 0 }
  );

  const warnings = reports.flatMap(({ report }) =>
    report.warnings.map((warning) => `${report.site.name}: ${warning}`)
  );

  const jobs: RenderPdfJob[] = [
    monthEndCoverJob({
      issuer: context.issuer,
      client: context.party,
      generatedAt,
      watermark: unapproved.length > 0 ? DRAFT_WATERMARK : null,
      periodLabel: period.label,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      clientContact: {
        contactPersonName: context.client.contactPersonName,
        contactPersonRole: context.client.contactPersonRole,
        contactPersonMobile: context.client.contactPersonMobile,
        physicalAddress: context.client.physicalAddress,
      },
      recipients: resolveReportRecipients(context.client),
      sites: reports.map(({ report, sheet }) => ({
        siteName: report.site.name,
        timesheetStatus: sheet.status,
        rowCount: sheet.rows.length,
        totalHours: sheet.totals.totalHours,
        absences: sheet.totals.absences,
        incidentCount: report.incidents.length,
      })),
      totals: {
        ...totals,
        totalHours: Math.round(totals.totalHours * 100) / 100,
        overtimeHours: Math.round(totals.overtimeHours * 100) / 100,
      },
      warnings,
    }),
    ...reports.flatMap(({ report, sheet }) => [
      siteReportJob(siteReportTemplateData(report, context.issuer, context.party, generatedAt)),
      siteTimesheetJob(
        siteTimesheetTemplateData(sheet, period, context.issuer, context.party, generatedAt)
      ),
    ]),
  ];

  const buffers = await generateReportBatch(jobs);
  const buffer = await mergePdfs(buffers);
  const safeName = safeFilenamePart(context.client.name, "client");
  const periodPart = period.month ?? `${period.periodStart} to ${period.periodEnd}`;
  return { ok: true, buffer, filename: `Month-end pack ${safeName} ${periodPart}.pdf` };
}

/** One CSV covering every selected site for the period. */
export async function buildMonthEndTimesheetsCsv(
  companyId: string,
  clientId: string,
  period: MonthPeriod,
  siteIds?: string[]
): Promise<{ ok: true; csv: string; filename: string } | { ok: false; statusCode: 400 | 404; message: string }> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId },
    select: { name: true },
  });
  if (!client) return { ok: false, statusCode: 404, message: "Client not found" };

  const clientSites = await prisma.site.findMany({
    where: { companyId, clientId },
    select: { id: true, name: true },
  });
  // No Chromium involved here, so the pack's render cap does not apply.
  const plan = planMonthEndPack(clientSites, siteIds, Number.MAX_SAFE_INTEGER);
  if (!plan.ok) return { ok: false, statusCode: 400, message: plan.message };

  const csvs: string[] = [];
  for (const site of plan.sites) {
    const sheet = await getSiteTimesheet(companyId, site.id, period.periodStart, period.periodEnd);
    csvs.push(buildSiteTimesheetCsv(sheet));
  }

  const safeName = safeFilenamePart(client.name, "client");
  const periodPart = period.month ?? `${period.periodStart} to ${period.periodEnd}`;
  return {
    ok: true,
    csv: mergeTimesheetCsvs(csvs),
    filename: `Timesheets ${safeName} ${periodPart}.csv`,
  };
}
