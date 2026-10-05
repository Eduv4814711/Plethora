"use client";

import { useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import { useAuth } from "./auth-context";
import { authFetch } from "./api";
import { canAccessRoute } from "./permissions";
import {
  fetchSiteTimesheetCaptureOverview,
  fetchRosterContinuityOverview,
  type SiteTimesheetCaptureOverview,
  type RosterContinuityOverview,
} from "./roster-api";
import {
  buildTodayWorkItems,
  formatPayPeriodLabel,
  type DashboardWorkData,
  type TodayWorkItem,
} from "./today-work-list-utils";

export interface ModuleStatusBadge {
  label: string;
  variant: "critical" | "warning" | "success" | "neutral";
}

export function useDashboardOperationalSummary() {
  const { token, user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardWorkData | null>(null);
  const [captureOverview, setCaptureOverview] = useState<SiteTimesheetCaptureOverview | null>(null);
  const [rosterOverview, setRosterOverview] = useState<RosterContinuityOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const canAttendance = user ? canAccessRoute("/attendance", user) : false;
  const canRostering = user ? canAccessRoute("/rostering", user) : false;

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const now = new Date();
    const todayStr = format(now, "yyyy-MM-dd");
    const currentShift = now.getHours() < 18 ? "day" : "night";

    const promises: Promise<unknown>[] = [
      authFetch("/dashboard", token)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ];

    if (canAttendance) {
      promises.push(
        fetchSiteTimesheetCaptureOverview(token, todayStr, todayStr, currentShift).catch(() => null)
      );
    } else {
      promises.push(Promise.resolve(null));
    }

    if (canRostering) {
      promises.push(fetchRosterContinuityOverview(token).catch(() => null));
    } else {
      promises.push(Promise.resolve(null));
    }

    Promise.all(promises)
      .then(([dash, capture, roster]) => {
        if (cancelled) return;
        if (dash) setDashboard(dash as DashboardWorkData);
        if (capture) setCaptureOverview(capture as SiteTimesheetCaptureOverview);
        if (roster) setRosterOverview(roster as RosterContinuityOverview);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, canAttendance, canRostering]);

  const currentHour = new Date().getHours();
  const currentShift = currentHour >= 6 && currentHour < 18 ? "day" : "night";
  const shiftInfo = useMemo(() => {
    return {
      currentShift,
      shiftLabel: currentShift === "day" ? "Day Shift Active" : "Night Shift Active",
      timeWindow: currentShift === "day" ? "06:00 – 18:00" : "18:00 – 06:00",
    };
  }, [currentShift]);

  const periodLabel = useMemo(
    () => formatPayPeriodLabel(dashboard?.currentPayPeriod),
    [dashboard?.currentPayPeriod]
  );

  const workItems = useMemo<TodayWorkItem[]>(() => {
    return buildTodayWorkItems({
      user,
      dashboard,
      captureOverview,
      rosterOverview,
      currentShift,
    });
  }, [user, dashboard, captureOverview, rosterOverview, currentShift]);

  const moduleStatus = useMemo<Record<string, ModuleStatusBadge>>(() => {
    const statuses: Record<string, ModuleStatusBadge> = {};

    // Attendance
    if (canAttendance) {
      const unconfirmed = captureOverview?.sites.filter((s) => s.status === "needs_capture") ?? [];
      const exceptions = dashboard?.payrollReadiness?.openExceptions ?? 0;
      if (unconfirmed.length > 0) {
        statuses["/attendance"] = {
          label: `${unconfirmed.length} need capture`,
          variant: "critical",
        };
      } else if (exceptions > 0) {
        statuses["/attendance"] = {
          label: `${exceptions} exception${exceptions === 1 ? "" : "s"}`,
          variant: "warning",
        };
      } else if ((dashboard?.pendingSiteTimesheetRows ?? 0) > 0) {
        statuses["/attendance"] = {
          label: `${dashboard!.pendingSiteTimesheetRows} unconfirmed`,
          variant: "warning",
        };
      }
    }

    // Rostering
    if (canRostering) {
      const attentionSites = rosterOverview?.sites.filter((s) => s.state === "needs_attention") ?? [];
      const attentionCount = attentionSites.length || (rosterOverview?.summary?.needsAttention ?? 0);
      if (attentionCount > 0) {
        statuses["/rostering"] = {
          label: `${attentionCount} need attention`,
          variant: "warning",
        };
      }
    }

    // Payroll
    if (dashboard?.payrollReadiness) {
      const pr = dashboard.payrollReadiness;
      if (pr.status === "READY" && pr.openExceptions === 0) {
        statuses["/payroll"] = {
          label: "Ready",
          variant: "success",
        };
      } else if (pr.openExceptions > 0) {
        statuses["/payroll"] = {
          label: `${pr.openExceptions} blocker${pr.openExceptions === 1 ? "" : "s"}`,
          variant: "critical",
        };
      }
    }

    // Approvals
    if ((dashboard?.pendingApprovalsInbox ?? 0) > 0) {
      statuses["/approvals"] = {
        label: `${dashboard!.pendingApprovalsInbox} pending`,
        variant: "warning",
      };
    }

    // Compliance / Documents
    const docAlerts = (dashboard?.operationalAlerts ?? []).filter(
      (a) =>
        a.sourceModule === "DOCUMENTS" ||
        a.title.toLowerCase().includes("expir") ||
        a.title.toLowerCase().includes("psira")
    );
    if (docAlerts.length > 0) {
      statuses["/compliance"] = {
        label: `${docAlerts.length} expiring`,
        variant: "warning",
      };
      statuses["/documents"] = {
        label: `${docAlerts.length} expiring`,
        variant: "warning",
      };
    }

    // Sites
    if (captureOverview && captureOverview.sites.length > 0) {
      const attentionCount = captureOverview.sites.filter((s) => s.status === "needs_capture").length;
      if (attentionCount > 0) {
        statuses["/sites"] = {
          label: `${attentionCount} need attention`,
          variant: "warning",
        };
      }
    }

    // Incidents
    if ((dashboard?.openCriticalIncidents ?? 0) > 0) {
      statuses["/incidents"] = {
        label: `${dashboard!.openCriticalIncidents} critical`,
        variant: "critical",
      };
    }

    return statuses;
  }, [dashboard, captureOverview, rosterOverview, canAttendance, canRostering]);

  return {
    dashboard,
    captureOverview,
    rosterOverview,
    loading,
    workItems,
    periodLabel,
    shiftInfo,
    moduleStatus,
  };
}
