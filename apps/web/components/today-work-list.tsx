"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { clsx } from "clsx";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { canAccessRoute } from "@/lib/permissions";
import {
  fetchSiteTimesheetCaptureOverview,
  fetchRosterContinuityOverview,
  type SiteTimesheetCaptureOverview,
  type RosterContinuityOverview,
} from "@/lib/roster-api";
import {
  buildTodayWorkItems,
  formatPayPeriodLabel,
  type DashboardWorkData,
  type TodayWorkItem,
} from "@/lib/today-work-list-utils";

export function TodayWorkList() {
  const { token, user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardWorkData | null>(null);
  const [captureOverview, setCaptureOverview] = useState<SiteTimesheetCaptureOverview | null>(null);
  const [rosterOverview, setRosterOverview] = useState<RosterContinuityOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const canAttendance = user ? canAccessRoute("/attendance", user) : false;
  const canRostering = user ? canAccessRoute("/rostering", user) : false;

  useEffect(() => {
    if (!token) return;
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

  const currentShift = new Date().getHours() < 18 ? "day" : "night";
  const periodLabel = useMemo(() => formatPayPeriodLabel(dashboard?.currentPayPeriod), [dashboard?.currentPayPeriod]);

  // Build the prioritized work list matching Phase 1 specifications
  const workItems = useMemo<TodayWorkItem[]>(() => {
    return buildTodayWorkItems({
      user,
      dashboard,
      captureOverview,
      rosterOverview,
      currentShift,
    });
  }, [user, dashboard, captureOverview, rosterOverview, currentShift]);

  if (loading) {
    return (
      <div className="mb-4 flex w-full max-w-3xl items-center justify-center py-1">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-security-navy-300 border-t-transparent" />
      </div>
    );
  }

  // Cap the list at 4 items
  const visibleItems = workItems.slice(0, 4);

  // Quiet day: when nothing needs action
  if (visibleItems.length === 0) {
    return (
      <div className="mb-3 flex shrink-0 items-center justify-center gap-2 rounded-full border border-security-emerald-200 bg-security-emerald-50/80 px-4 py-1 text-xs font-medium text-security-emerald-800 shadow-sm animate-fade-in">
        <span className="flex h-2 w-2 rounded-full bg-security-emerald-500" />
        <span>You’re clear for today</span>
        {periodLabel && (
          <>
            <span className="text-security-emerald-400">·</span>
            <span className="text-security-emerald-700">{periodLabel}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mb-3.5 w-full max-w-4xl shrink-0 animate-slide-up rounded-security-lg border border-security-navy-100 bg-white p-3 shadow-security-card sm:p-4">
      <div className="mb-2 flex items-center justify-between border-b border-security-navy-50 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-security-amber-500 animate-pulse" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-security-navy-900">
            Today’s Actions
          </h2>
          <span className="rounded-full bg-security-navy-100 px-2 py-0.5 text-[10px] font-bold text-security-navy-700 tabular-nums">
            {workItems.length}
          </span>
        </div>
        {periodLabel && (
          <span className="text-[11px] font-medium text-security-navy-500">
            {periodLabel}
          </span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {visibleItems.map((item) => (
          <div
            key={item.id}
            className={clsx(
              "flex items-center justify-between gap-3 rounded-md border p-2.5 transition-colors",
              item.priority === "CRITICAL"
                ? "border-red-200 bg-red-50/40 hover:bg-red-50/70"
                : item.priority === "MEDIUM"
                ? "border-amber-200 bg-amber-50/40 hover:bg-amber-50/70"
                : "border-security-navy-100 bg-security-navy-50/40 hover:bg-security-navy-50/80"
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={clsx(
                    "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                    item.priority === "CRITICAL"
                      ? "bg-red-500"
                      : item.priority === "MEDIUM"
                      ? "bg-amber-500"
                      : "bg-security-navy-400"
                  )}
                />
                <p className="truncate text-xs font-semibold text-security-navy-900">
                  {item.title}
                </p>
              </div>
            </div>

            <Link
              href={item.href}
              className={clsx(
                "inline-flex shrink-0 items-center justify-center rounded px-2.5 py-1 text-xs font-semibold shadow-sm transition hover:shadow",
                item.priority === "CRITICAL"
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : item.priority === "MEDIUM"
                  ? "bg-security-amber-500 text-security-navy-950 hover:bg-security-amber-400"
                  : "bg-security-navy-800 text-white hover:bg-security-navy-900"
              )}
            >
              {item.verb} →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
