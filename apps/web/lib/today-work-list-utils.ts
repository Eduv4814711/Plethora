import { format, parseISO } from "date-fns";
import { canAccessRoute, type AuthUser } from "./permissions";
import { alertFixTarget } from "./alert-links";
import type { OperationalAlert, AlertCounts } from "./msr-api";
import type {
  SiteTimesheetCaptureOverview,
  RosterContinuityOverview,
} from "./roster-api";

export interface DashboardWorkData {
  operationalAlerts?: OperationalAlert[];
  alertCounts?: AlertCounts;
  payrollReadiness?: {
    status: string;
    openExceptions: number;
    periodStart: string;
    periodEnd: string;
  } | null;
  currentPayPeriod?: {
    periodStart: string;
    periodEnd: string;
    label: string;
  } | null;
  pendingApprovalsInbox?: number;
  pendingSiteTimesheetRows?: number;
}

export interface TodayWorkItem {
  id: string;
  sourceModule: "ATTENDANCE" | "ROSTERING" | "PAYROLL" | "DOCUMENTS" | "APPROVALS";
  title: string;
  count: number;
  verb: string;
  href: string;
  priority: "CRITICAL" | "MEDIUM" | "LOW";
  badge?: string;
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
  const canPayroll = canAccessRoute("/payroll", user);
  const canDocuments = canAccessRoute("/documents", user) || canAccessRoute("/employees", user);
  const canApprovals = canAccessRoute("/approvals", user);

  const items: TodayWorkItem[] = [];

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
        verb: rowCount === 1 ? "Confirm 1 shift" : `Confirm ${rowCount} shifts`,
        href: "/attendance",
        priority: "CRITICAL",
      });
    }
  }

  // 2. Open attendance exceptions
  if (canAttendance) {
    const openExceptions = dashboard.payrollReadiness?.openExceptions ?? 0;
    if (openExceptions > 0) {
      items.push({
        id: "attendance-exceptions",
        sourceModule: "ATTENDANCE",
        title: `${openExceptions} open attendance exception${openExceptions === 1 ? "" : "s"} need review`,
        count: openExceptions,
        verb: openExceptions === 1 ? "Clear 1 exception" : `Clear ${openExceptions} exceptions`,
        href: "/attendance/exceptions?status=OPEN",
        priority: "CRITICAL",
      });
    }
  }

  // 3. Payroll readiness for the open 26-25 period (first real blocker)
  if (canPayroll) {
    const pr = dashboard.payrollReadiness;
    if (pr && pr.status !== "READY" && pr.openExceptions > 0) {
      const startParam = pr.periodStart ? pr.periodStart.slice(0, 10) : "";
      const endParam = pr.periodEnd ? pr.periodEnd.slice(0, 10) : "";
      const href =
        startParam && endParam
          ? `/attendance/exceptions?status=OPEN&severity=CRITICAL&start=${startParam}&end=${endParam}`
          : "/attendance/exceptions?status=OPEN&severity=CRITICAL";

      items.push({
        id: "payroll-readiness",
        sourceModule: "PAYROLL",
        title: `${pr.openExceptions} critical attendance issue${pr.openExceptions === 1 ? "" : "s"} blocking payroll calculation`,
        count: pr.openExceptions,
        verb: pr.openExceptions === 1 ? "Clear 1 blocker" : `Clear ${pr.openExceptions} blockers`,
        href,
        priority: "CRITICAL",
        badge: "Payroll",
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
        verb: pendingApprovals === 1 ? "Review 1 approval" : `Review ${pendingApprovals} approvals`,
        href: "/approvals",
        priority: "MEDIUM",
      });
    }
  }

  return items;
}
