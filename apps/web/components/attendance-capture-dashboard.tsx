"use client";

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { clsx } from "clsx";
import {
  fetchSiteTimesheetCaptureOverview,
  type AttendanceShiftTypeFilter,
  type SiteTimesheetCaptureOverview,
  type SiteTimesheetCaptureOverviewSite,
} from "@/lib/roster-api";
import { Badge } from "@/components/ui";

type AttendanceCaptureDashboardProps = {
  token: string;
  periodStart: string;
  periodEnd: string;
  shiftType: AttendanceShiftTypeFilter;
  selectedSiteId?: string;
  onSelectSite: (siteId: string) => void;
};

function formatDisplayDate(isoDate: string) {
  return format(parseISO(isoDate), "d MMM yyyy");
}

function shiftTypeLabel(shiftType: AttendanceShiftTypeFilter): string {
  if (shiftType === "day") return "day-shift";
  if (shiftType === "night") return "night-shift";
  return "";
}

function SiteStatusBadge({ status }: { status: SiteTimesheetCaptureOverviewSite["status"] }) {
  if (status === "needs_capture") return <Badge variant="warning">Needs capture</Badge>;
  if (status === "caught_up") return <Badge variant="success">Up to date</Badge>;
  return <Badge variant="neutral">No roster</Badge>;
}

export function AttendanceCaptureDashboard({
  token,
  periodStart,
  periodEnd,
  shiftType,
  selectedSiteId,
  onSelectSite,
}: AttendanceCaptureDashboardProps) {
  const [overview, setOverview] = useState<SiteTimesheetCaptureOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCaughtUp, setShowCaughtUp] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSiteTimesheetCaptureOverview(token, periodStart, periodEnd, shiftType)
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load capture status");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, periodStart, periodEnd, shiftType]);

  const needsCapture = useMemo(
    () => overview?.sites.filter((s) => s.status === "needs_capture") ?? [],
    [overview]
  );
  const caughtUp = useMemo(() => overview?.sites.filter((s) => s.status === "caught_up") ?? [], [overview]);

  if (loading) {
    return (
      <section className="lg:col-span-2 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 dark:border-neutral-700 dark:bg-neutral-900/30 sm:p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="grid gap-2 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-neutral-200 dark:bg-neutral-700" />
            ))}
          </div>
          <div className="h-24 rounded-lg bg-neutral-200 dark:bg-neutral-700" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="lg:col-span-2 rounded-xl border border-red-200 bg-red-50/70 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200 sm:p-5">
        Could not load attendance capture status. {error}
      </section>
    );
  }

  if (!overview) return null;

  const captureLabel = overview.captureThrough
    ? formatDisplayDate(overview.captureThrough)
    : "This period has not started yet";
  const shiftLabel = shiftTypeLabel(shiftType);
  const pendingDay = overview.summary.pendingDayRows ?? 0;
  const pendingNight = overview.summary.pendingNightRows ?? 0;
  const pendingBreakdown =
    pendingDay > 0 || pendingNight > 0
      ? [
          pendingDay > 0 ? `${pendingDay} day-shift approval${pendingDay === 1 ? "" : "s"} pending` : null,
          pendingNight > 0 ? `${pendingNight} night-shift approval${pendingNight === 1 ? "" : "s"} pending` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
  const needCapturePhrase = shiftLabel
    ? `${overview.summary.needsCapture} site${overview.summary.needsCapture === 1 ? "" : "s"} need ${shiftLabel} capture`
    : `${overview.summary.needsCapture} site${overview.summary.needsCapture === 1 ? "" : "s"} need capture`;

  const panelId = "attendance-capture-panel";

  return (
    <section
      className="lg:col-span-2 rounded-xl border border-neutral-200 bg-gradient-to-br from-white to-neutral-50/80 p-4 dark:border-neutral-700 dark:from-neutral-950/80 dark:to-neutral-900/40 sm:p-5"
      aria-label="Attendance capture status"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="group flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <svg
            className={clsx(
              "mt-0.5 h-4 w-4 shrink-0 text-neutral-500 transition-transform group-hover:text-neutral-700 dark:text-neutral-400 dark:group-hover:text-neutral-200",
              expanded && "rotate-180"
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Capture status
            </p>
            <h4 className="mt-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              Attendance should be captured through {captureLabel}
            </h4>
            {expanded ? (
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                {shiftLabel
                  ? `Sites with rostered ${shiftLabel} shifts still waiting for review are listed below. Open a site to capture who worked.`
                  : "Sites with rostered shifts still waiting for review are listed below. Open a site to capture who worked."}
              </p>
            ) : (
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                {overview.summary.needsCapture > 0
                  ? `${needCapturePhrase}${pendingBreakdown ? ` · ${pendingBreakdown}` : ""} · ${overview.summary.caughtUp} up to date`
                  : overview.captureThrough
                    ? `All rostered sites captured through ${captureLabel}`
                    : "No roster activity in this period yet"}
              </p>
            )}
          </div>
        </button>
        <div className="flex shrink-0 items-start gap-2 sm:flex-col sm:items-end">
          <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600 shadow-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
            <span className="font-medium text-neutral-800 dark:text-neutral-100">Today</span>
            <span className="mt-0.5 block">{formatDisplayDate(overview.asOfDate)}</span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="text-xs font-medium text-security-navy-700 hover:text-security-navy-900 dark:text-security-navy-300 dark:hover:text-security-navy-100 sm:hidden"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {expanded && (
        <div id={panelId} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
              <p className="text-2xl font-bold text-amber-900 dark:text-amber-100">{overview.summary.needsCapture}</p>
              <p className="text-xs font-medium text-amber-800/90 dark:text-amber-200/90">
                {shiftLabel ? `Sites need ${shiftLabel} capture` : "Sites need capture"}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-3 py-3 dark:border-amber-900/40 dark:bg-amber-950/10">
              <p className="text-2xl font-bold text-amber-900 dark:text-amber-100">{pendingDay}</p>
              <p className="text-xs font-medium text-amber-800/90 dark:text-amber-200/90">Day approvals pending</p>
            </div>
            <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-3 py-3 dark:border-amber-900/40 dark:bg-amber-950/10">
              <p className="text-2xl font-bold text-amber-900 dark:text-amber-100">{pendingNight}</p>
              <p className="text-xs font-medium text-amber-800/90 dark:text-amber-200/90">Night approvals pending</p>
            </div>
            <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-3 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{overview.summary.caughtUp}</p>
              <p className="text-xs font-medium text-emerald-800/90 dark:text-emerald-200/90">Sites up to date</p>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-white px-3 py-3 dark:border-neutral-700 dark:bg-neutral-950/60">
              <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{overview.summary.noShifts}</p>
              <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">No roster in range</p>
            </div>
          </div>

          {needsCapture.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-amber-200/70 dark:border-amber-900/40">
              <div className="border-b border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                Needs attention
              </div>
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {needsCapture.map((site) => (
                  <li key={site.siteId}>
                    <button
                      type="button"
                      onClick={() => onSelectSite(site.siteId)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-amber-50/60 dark:hover:bg-amber-950/20 ${
                        selectedSiteId === site.siteId ? "bg-amber-50/80 dark:bg-amber-950/30" : "bg-white dark:bg-neutral-950/40"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{site.siteName}</p>
                        <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
                          {site.dueDays} day{site.dueDays === 1 ? "" : "s"} · {site.pendingRows} shift
                          {site.pendingRows === 1 ? "" : "s"} pending
                          {(site.pendingDayRows ?? 0) > 0 || (site.pendingNightRows ?? 0) > 0
                            ? ` (${[
                                (site.pendingDayRows ?? 0) > 0 ? `${site.pendingDayRows} day` : null,
                                (site.pendingNightRows ?? 0) > 0 ? `${site.pendingNightRows} night` : null,
                              ]
                                .filter(Boolean)
                                .join(", ")})`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <SiteStatusBadge status={site.status} />
                        <span className="text-xs font-semibold text-security-navy-700 dark:text-security-navy-300">Open →</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : overview.captureThrough ? (
            <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-100">
              All rostered sites are captured through {captureLabel}.
            </div>
          ) : null}

          {caughtUp.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowCaughtUp((v) => !v)}
                className="text-sm font-medium text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
              >
                {showCaughtUp ? "Hide" : "Show"} {caughtUp.length} site{caughtUp.length === 1 ? "" : "s"} up to date
              </button>
              {showCaughtUp && (
                <ul className="mt-2 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
                  {caughtUp.map((site) => (
                    <li key={site.siteId} className="border-b border-neutral-200 last:border-b-0 dark:border-neutral-800">
                      <button
                        type="button"
                        onClick={() => onSelectSite(site.siteId)}
                        className="flex w-full items-center justify-between gap-3 bg-white px-3 py-2.5 text-left hover:bg-neutral-50 dark:bg-neutral-950/40 dark:hover:bg-neutral-900/60"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{site.siteName}</p>
                          {site.lastCapturedDate && (
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                              Last captured {formatDisplayDate(site.lastCapturedDate)}
                            </p>
                          )}
                        </div>
                        <SiteStatusBadge status={site.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
