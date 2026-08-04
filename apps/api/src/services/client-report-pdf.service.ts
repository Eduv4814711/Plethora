import { renderPdf, renderPdfBatch, type RenderPdfJob } from "../lib/render-pdf.js";
import type { BillingPartyDetails } from "./billing-pdf.service.js";

export interface ReportPartyBlock {
  issuer: BillingPartyDetails;
  client: BillingPartyDetails;
  /** Diagonal overlay for anything not yet signed off. */
  watermark?: string | null;
  generatedAt: string;
}

export interface SiteReportTemplateData extends ReportPartyBlock {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  site: {
    name: string;
    physicalAddress: string | null;
    serviceType: string | null;
    contactPersonName: string | null;
    contactPersonPhone: string | null;
    supervisorName: string | null;
  };
  timesheetStatus: string;
  approvedAt: string | null;
  totals: {
    dayShifts: number;
    nightShifts: number;
    relieverShifts: number;
    absences: number;
    totalHours: number;
    overtimeHours: number;
    discrepancies: number;
  };
  exceptions: {
    total: number;
    lateArrivals: number;
    missedClockIns: number;
    missedClockOuts: number;
    earlyDepartures: number;
    absences: number;
    openCritical: number;
  };
  absences: { workDate: string; dayOfWeek: string; guardName: string | null; shiftType: string | null }[];
  incidents: {
    incidentNumber: string;
    title: string;
    incidentType: string;
    severity: string;
    status: string;
    incidentDateTime: string;
  }[];
}

export interface SiteTimesheetTemplateData extends ReportPartyBlock {
  periodLabel: string;
  siteName: string;
  timesheetStatus: string;
  columns: string[];
  rows: string[][];
}

export interface MonthEndCoverTemplateData extends ReportPartyBlock {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  clientContact: {
    contactPersonName: string | null;
    contactPersonRole: string | null;
    contactPersonMobile: string | null;
    physicalAddress: string | null;
  };
  recipients: string[];
  sites: {
    siteName: string;
    timesheetStatus: string;
    rowCount: number;
    totalHours: number;
    absences: number;
    incidentCount: number;
  }[];
  totals: {
    dayShifts: number;
    nightShifts: number;
    absences: number;
    totalHours: number;
    overtimeHours: number;
    incidents: number;
  };
  warnings: string[];
}

const SITE_REPORT_JOB = { templateFile: "site-month-report.html", globalName: "__SITE_REPORT_DATA__" };
const TIMESHEET_JOB = {
  templateFile: "site-timesheet.html",
  globalName: "__SITE_TIMESHEET_DATA__",
  options: { landscape: true, margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" } },
};
const COVER_JOB = { templateFile: "month-end-cover.html", globalName: "__MONTH_END_COVER_DATA__" };

export function siteReportJob(data: SiteReportTemplateData): RenderPdfJob {
  return { ...SITE_REPORT_JOB, data };
}

export function siteTimesheetJob(data: SiteTimesheetTemplateData): RenderPdfJob {
  return { ...TIMESHEET_JOB, data };
}

export function monthEndCoverJob(data: MonthEndCoverTemplateData): RenderPdfJob {
  return { ...COVER_JOB, data };
}

export function generateSiteMonthReportPDF(data: SiteReportTemplateData): Promise<Buffer> {
  return renderPdf(SITE_REPORT_JOB.templateFile, SITE_REPORT_JOB.globalName, data);
}

export function generateSiteTimesheetPDF(data: SiteTimesheetTemplateData): Promise<Buffer> {
  return renderPdf(TIMESHEET_JOB.templateFile, TIMESHEET_JOB.globalName, data, TIMESHEET_JOB.options);
}

export function generateMonthEndCoverPDF(data: MonthEndCoverTemplateData): Promise<Buffer> {
  return renderPdf(COVER_JOB.templateFile, COVER_JOB.globalName, data);
}

/** One browser for a whole pack. Order of the result matches the order of `jobs`. */
export function generateReportBatch(jobs: RenderPdfJob[]): Promise<Buffer[]> {
  return renderPdfBatch(jobs);
}
