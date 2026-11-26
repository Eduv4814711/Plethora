import { format, parseISO } from "date-fns";
import { canAccessRoute, type AuthUser } from "./permissions";
import { alertFixTarget } from "./alert-links";
import type { OperationalAlert, AlertCounts } from "./msr-api";
import type {
  SiteTimesheetCaptureOverview,
  RosterContinuityOverview,
} from "./roster-api";

export interface AttendanceTrendDay {
  date: string;
  label: string;
  attended: number;
  scheduled: number;
  unconfirmed: number;
  rate: number | null;
}

export interface DashboardWorkData {
  operationalAlerts?: OperationalAlert[];
  alertCounts?: AlertCounts;
  exportReadiness?: {
    status: string;
    openExceptions: number;
    openCritical?: number;
    periodKey?: string;
    periodStart: string;
    periodEnd: string;
    latestBatch?: {
      id: string;
      status: string;
      periodKey: string;
      exportedAt?: string | null;
    } | null;
  } | null;
  exportBatchByStatus?: Record<string, number>;
  currentPayPeriod?: {
    periodStart: string;
    periodEnd: string;
    label: string;
    periodKey?: string;
  } | null;
  pendingApprovalsInbox?: number;
  pendingSiteTimesheetRows?: number;
  openCriticalIncidents?: number;
  activeSitesCount?: number;
  activeSitesDelta?: number;
  guardsOnDuty?: number;
  totalEmployees?: number;
  activeEmployeesCount?: number;
  onLeaveToday?: number;
  totalPosts?: number;
  activeClientsCount?: number;
  attendanceTrend14d?: AttendanceTrendDay[];
}

export interface TodayWorkItem {
  id: string;
  sourceModule:
    | "ATTENDANCE"
    | "ROSTERING"
    | "PAYROLL_EXPORT"
    | "DOCUMENTS"
    | "APPROVALS"
    | "INCIDENTS";
  title: string;
  count: number;
  verb: string;
  href: string;
  priority: "CRITICAL" | "MEDIUM" | "LOW";
  badge?: string;
  focalCount?: string;
  description?: string;
}

/** Formats the period in plain language: "September roster · 26 Aug – 25 Sep" */
export function formatPayPeriodLabel(
  period?: { periodStart: string; periodEnd: string; label: string } | null
): string {
  if (!period) return "";
  const name = period.label
    ? `${period.label.replace(/\s*\d{4}$/, "")} roster`
    : "Current roster";
  try {
    const startStr = format(parseISO(period.periodStart.slice(0, 10)), "d MMM");
    const endStr = format(parseISO(period.periodEnd.slice(0, 10)), "d MMM");
    return `${name} · ${startStr} – ${endStr}`;
  } catch {
    return name;
  }
}

export function buildTodayWorkItems(params: {
  user: AuthUser | null;
  dashboard: DashboardWorkData | null;
  captureOverview?: SiteTimesheetCaptureOverview | null;
  rosterOverview?: RosterContinuityOverview | null;
  currentShift?: "day" | "night";
}): TodayWorkItem[] {
  const { user, dashboard, captureOverview, rosterOverview } = params;
  if (!user || !dashboard) return [];

  const currentShift = params.currentShift ?? (new Date().getHours() < 18 ? "day" : "night");
  const canAttendance = canAccessRoute("/attendance", user);
  const canRostering = canAccessRoute("/rostering", user);
  const canPayrollExport = canAccessRoute("/payroll-exports", user);
  const canDocuments = canAccessRoute("/documents", user) || canAccessRoute("/employees", user);
  const canApprovals = canAccessRoute("/approvals", user);
  const canIncidents = canAccessRoute("/incidents", user);

  const items: TodayWorkItem[] = [];

  // 0. Open critical incidents
  if (canIncidents) {
    const criticalIncidents = dashboard.openCriticalIncidents ?? 0;
    if (criticalIncidents > 0) {
      items.push({
        id: "critical-incidents",
        sourceModule: "INCIDENTS",
        title: `${criticalIncidents} critical incident${criticalIncidents === 1 ? "" : "s"} requiring investigation`,
        count: criticalIncidents,
        focalCount: `${criticalIncidents} incident${criticalIncidents === 1 ? "" : "s"}`,
        description: `Critical field incident${criticalIncidents === 1 ? "" : "s"} awaiting review`,
        verb: criticalIncidents === 1 ? "Review 1 incident" : `Review ${criticalIncidents} incidents`,
        href: "/incidents?severity=CRITICAL",
        priority: "CRITICAL",
        badge: "Incident",
      });
    }
  }

  // 1. Sites still to capture for the current day or night shift
  if (canAttendance) {
    const unconfirmed = captureOverview?.sites.filter((s) => s.status === "needs_capture") ?? [];
    const count = unconfirmed.length;
    if (count > 0) {
      items.push({
        id: "attendance-capture",
        sourceModule: "ATTENDANCE",
        title: `${count} site${count === 1 ? "" : "s"} waiting for ${currentShift}-shift confirmation`,
        count,
        focalCount: `${count} site${count === 1 ? "" : "s"}`,
        description: `Waiting for ${currentShift}-shift confirmation`,
        verb: count === 1 ? "Confirm 1 site" : `Confirm ${count} sites`,
        href: count === 1 ? `/attendance?siteId=${unconfirmed[0].siteId}` : "/attendance",
        priority: "CRITICAL",
        badge: `${currentShift} shift`,
      });
    } else if (!captureOverview && (dashboard.pendingSiteTimesheetRows ?? 0) > 0) {
      const rowCount = dashboard.pendingSiteTimesheetRows!;
      items.push({
        id: "attendance-rows",
        sourceModule: "ATTENDANCE",
        title: `${rowCount} unconfirmed attendance shift${rowCount === 1 ? "" : "s"}`,
        count: rowCount,
        focalCount: `${rowCount} shift${rowCount === 1 ? "" : "s"}`,
        description: "Unconfirmed attendance shifts require review",
        verb: rowCount === 1 ? "Confirm 1 shift" : `Confirm ${rowCount} shifts`,
        href: "/attendance",
        priority: "CRITICAL",
      });
    }
  }

  // 2. Open attendance exceptions
  if (canAttendance) {
    const openExceptions = dashboard.exportReadiness?.openExceptions ?? 0;
    if (openExceptions > 0) {
      items.push({
        id: "attendance-exceptions",
        sourceModule: "ATTENDANCE",
        title: `${openExceptions} open attendance exception${openExceptions === 1 ? "" : "s"} need review`,
        count: openExceptions,
        focalCount: `${openExceptions} exception${openExceptions === 1 ? "" : "s"}`,
        description: `Open attendance exception${openExceptions === 1 ? "" : "s"} need review`,
        verb: openExceptions === 1 ? "Clear 1 exception" : `Clear ${openExceptions} exceptions`,
        href: "/attendance/exceptions?status=OPEN",
        priority: "CRITICAL",
      });
    }
  }

  // 3. Payroll export readiness for the open 26-25 period
  if (canPayrollExport) {
    const er = dashboard.exportReadiness;
    if (er && er.status !== "READY" && er.openExceptions > 0) {
      const startParam = er.periodStart ? er.periodStart.slice(0, 10) : "";
      const endParam = er.periodEnd ? er.periodEnd.slice(0, 10) : "";
      const href =
        startParam && endParam
          ? `/attendance/exceptions?status=OPEN&severity=CRITICAL&start=${startParam}&end=${endParam}`
          : "/attendance/exceptions?status=OPEN&severity=CRITICAL";

      items.push({
        id: "payroll-export-readiness",
        sourceModule: "PAYROLL_EXPORT",
        title: `${er.openExceptions} critical attendance issue${er.openExceptions === 1 ? "" : "s"} blocking payroll export`,
        count: er.openExceptions,
        focalCount: `${er.openExceptions} blocker${er.openExceptions === 1 ? "" : "s"}`,
        description: `Critical attendance issue${er.openExceptions === 1 ? "" : "s"} blocking payroll export`,
        verb: er.openExceptions === 1 ? "Clear 1 blocker" : `Clear ${er.openExceptions} blockers`,
        href,
        priority: "CRITICAL",
        badge: "Payroll Export",
      });
    }
  }

  // 4. Roster sites that need attention
  if (canRostering) {
    const attentionSites = rosterOverview?.sites.filter((s) => s.state === "needs_attention") ?? [];
    const attentionCount = attentionSites.length || (rosterOverview?.summary?.needsAttention ?? 0);
    if (attentionCount > 0) {
      items.push({
        id: "roster-attention",
        sourceModule: "ROSTERING",
        title: `${attentionCount} site roster${attentionCount === 1 ? "" : "s"} need coverage attention`,
        count: attentionCount,
        focalCount: `${attentionCount} roster${attentionCount === 1 ? "" : "s"}`,
        description: `Site roster${attentionCount === 1 ? "" : "s"} need coverage attention`,
        verb: attentionCount === 1 ? "Fix 1 roster" : `Fix ${attentionCount} rosters`,
        href: attentionSites.length === 1 ? `/rostering/sites/${attentionSites[0].siteId}` : "/rostering",
        priority: "MEDIUM",
      });
    }
  }

  // 5. Documents and PSIRA records expiring
  if (canDocuments) {
    const docAlerts = (dashboard.operationalAlerts ?? []).filter(
      (a) =>
        a.sourceModule === "DOCUMENTS" ||
        a.title.toLowerCase().includes("expir") ||
        a.title.toLowerCase().includes("psira")
    );
    if (docAlerts.length > 0) {
      const firstTarget = alertFixTarget(docAlerts[0]);
      items.push({
        id: "documents-expiring",
        sourceModule: "DOCUMENTS",
        title: `${docAlerts.length} compliance or PSIRA record${docAlerts.length > 1 ? "" : "s"} expiring soon`,
        count: docAlerts.length,
        focalCount: `${docAlerts.length} record${docAlerts.length > 1 ? "" : "s"}`,
        description: `Compliance or PSIRA record${docAlerts.length > 1 ? "" : "s"} expiring soon`,
        verb: docAlerts.length === 1 ? "Review 1 document" : `Review ${docAlerts.length} documents`,
        href: firstTarget?.href ?? "/documents",
        priority: "LOW",
      });
    }
  }

  // 6. Approvals waiting
  if (canApprovals) {
    const pendingApprovals = dashboard.pendingApprovalsInbox ?? 0;
    if (pendingApprovals > 0) {
      items.push({
        id: "approvals-waiting",
        sourceModule: "APPROVALS",
        title: `${pendingApprovals} approval request${pendingApprovals === 1 ? "" : "s"} waiting for review`,
        count: pendingApprovals,
        focalCount: `${pendingApprovals} request${pendingApprovals === 1 ? "" : "s"}`,
        description: `Approval request${pendingApprovals === 1 ? "" : "s"} waiting for review`,
        verb: pendingApprovals === 1 ? "Review 1 approval" : `Review ${pendingApprovals} approvals`,
        href: "/approvals",
        priority: "MEDIUM",
      });
    }
  }

  return items;
}
