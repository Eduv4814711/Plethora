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
  siteQuery?: string;
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
  if (status === "needs_capture") return <Badge variant="warning">Needs attendance review</Badge>;
  if (status === "caught_up") return <Badge variant="success">Up to date</Badge>;
  return <Badge variant="neutral">No scheduled shifts</Badge>;
}

export function AttendanceCaptureDashboard({
  token,
  periodStart,
  periodEnd,
  shiftType,
  selectedSiteId,
  onSelectSite,
  siteQuery = "",
}: AttendanceCaptureDashboardProps) {
  const [overview, setOverview] = useState<SiteTimesheetCaptureOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCaughtUp, setShowCaughtUp] = useState(false);
  const [showNoShifts, setShowNoShifts] = useState(false);
  const [expanded, setExpanded] = useState(true);

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

  const normalizedQuery = siteQuery.trim().toLowerCase();
  const visibleSites = useMemo(
    () =>
      overview?.sites.filter(
        (site) => !normalizedQuery || site.siteName.toLowerCase().includes(normalizedQuery)
      ) ?? [],
    [normalizedQuery, overview]
  );
  const needsCapture = useMemo(
    () => visibleSites.filter((s) => s.status === "needs_capture"),
    [visibleSites]
  );
  const caughtUp = useMemo(() => visibleSites.filter((s) => s.status === "caught_up"), [visibleSites]);
  const noShifts = useMemo(() => visibleSites.filter((s) => s.status === "no_shifts"), [visibleSites]);

  if (loading) {
    return (
      <section className="lg:col-span-2 rounded-security-lg border border-security-navy-100 bg-security-navy-50/60 p-4 sm:p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-48 rounded bg-security-navy-100" />
          <div className="grid gap-2 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-security-navy-100" />
            ))}
          </div>
          <div className="h-24 rounded-lg bg-security-navy-100" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="lg:col-span-2 rounded-security-lg border border-red-200 bg-red-50/70 p-4 text-sm text-red-800 sm:p-5">
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
      className="lg:col-span-2 rounded-security-lg border border-security-navy-100 bg-gradient-to-br from-white to-security-navy-50/80 p-4 sm:p-5"
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
              "mt-0.5 h-4 w-4 shrink-0 text-security-navy-500 transition-transform group-hover:text-security-navy-700",
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
            <p className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
              Attendance work queue
            </p>
            <h4 className="mt-1 text-base font-semibold text-security-navy-900">
              Attendance should be reviewed through {captureLabel}
            </h4>
            {expanded ? (
              <p className="mt-1 text-sm text-security-navy-600">
                {shiftLabel
                  ? `Sites with scheduled ${shiftLabel} shifts still waiting for review are listed below. Open a site to confirm who worked.`
                  : "Sites with scheduled shifts still waiting for review are listed below. Open a site to confirm who worked."}
              </p>
            ) : (
              <p className="mt-1 text-sm text-security-navy-600">
                {overview.summary.needsCapture > 0
                  ? `${needCapturePhrase}${pendingBreakdown ? ` · ${pendingBreakdown}` : ""} · ${overview.summary.caughtUp} up to date`
                  : overview.captureThrough
                    ? `All scheduled sites are reviewed through ${captureLabel}`
                    : "No scheduled attendance in this period yet"}
              </p>
            )}
          </div>
        </button>
        <div className="flex shrink-0 items-start gap-2 sm:flex-col sm:items-end">
          <div className="rounded-lg border border-security-navy-100 bg-white px-3 py-2 text-xs text-security-navy-600 shadow-security-card">
            <span className="font-medium text-security-navy-900">Today</span>
            <span className="mt-0.5 block">{formatDisplayDate(overview.asOfDate)}</span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="text-xs font-medium text-security-navy-700 hover:text-security-navy-900 sm:hidden"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {expanded && (
        <div id={panelId} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border border-security-amber-200/80 bg-security-amber-50/80 px-3 py-3">
              <p className="text-2xl font-bold text-security-amber-900">{overview.summary.needsCapture}</p>
              <p className="text-xs font-medium text-security-amber-800/90">
                {shiftLabel ? `Sites need ${shiftLabel} review` : "Sites need review"}
              </p>
            </div>
            <div className="rounded-lg border border-security-amber-200/80 bg-security-amber-50/50 px-3 py-3">
              <p className="text-2xl font-bold text-security-amber-900">{pendingDay}</p>
              <p className="text-xs font-medium text-security-amber-800/90">Day approvals pending</p>
            </div>
            <div className="rounded-lg border border-security-amber-200/80 bg-security-amber-50/50 px-3 py-3">
              <p className="text-2xl font-bold text-security-amber-900">{pendingNight}</p>
              <p className="text-xs font-medium text-security-amber-800/90">Night approvals pending</p>
            </div>
            <div className="rounded-lg border border-security-emerald-200/80 bg-security-emerald-50/80 px-3 py-3">
              <p className="text-2xl font-bold text-security-emerald-700">{overview.summary.caughtUp}</p>
              <p className="text-xs font-medium text-security-emerald-700/90">Sites up to date</p>
            </div>
            <div className="rounded-lg border border-security-navy-100 bg-white px-3 py-3">
              <p className="text-2xl font-bold text-security-navy-900">{overview.summary.noShifts}</p>
              <p className="text-xs font-medium text-security-navy-600">No scheduled shifts</p>
            </div>
          </div>

          {needsCapture.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-security-amber-200/70">
              <div className="border-b border-security-amber-200/70 bg-security-amber-50/70 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-security-amber-900">
                Needs attendance review
              </div>
              <ul className="divide-y divide-security-navy-100">
                {needsCapture.map((site) => (
                  <li key={site.siteId}>
                    <button
                      type="button"
                      onClick={() => onSelectSite(site.siteId)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-security-amber-50/60 ${
                        selectedSiteId === site.siteId ? "bg-security-amber-50/80" : "bg-white"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-security-navy-900">{site.siteName}</p>
                        <p className="mt-0.5 text-xs text-security-navy-600">
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
                        <span className="text-xs font-semibold text-security-navy-700">Review site →</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : normalizedQuery && visibleSites.length > 0 ? (
            <div className="rounded-lg border border-security-navy-100 bg-white px-4 py-3 text-sm text-security-navy-700">
              No sites needing attendance review match “{siteQuery.trim()}”.
            </div>
          ) : overview.captureThrough ? (
            <div className="rounded-lg border border-security-emerald-200/80 bg-security-emerald-50/70 px-4 py-3 text-sm text-security-emerald-700">
              All scheduled sites are reviewed through {captureLabel}.
            </div>
          ) : null}

          {caughtUp.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowCaughtUp((v) => !v)}
                className="min-h-11 text-sm font-medium text-security-navy-700 hover:text-security-navy-900"
                aria-expanded={showCaughtUp}
              >
                {showCaughtUp ? "Hide" : "Show"} {caughtUp.length} site{caughtUp.length === 1 ? "" : "s"} up to date
              </button>
              {showCaughtUp && (
                <ul className="mt-2 overflow-hidden rounded-lg border border-security-navy-100">
                  {caughtUp.map((site) => (
                    <li key={site.siteId} className="border-b border-security-navy-100 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => onSelectSite(site.siteId)}
                        className="flex w-full items-center justify-between gap-3 bg-white px-3 py-2.5 text-left hover:bg-security-navy-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-security-navy-900">{site.siteName}</p>
                          {site.lastCapturedDate && (
                            <p className="text-xs text-security-navy-500">
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

          {noShifts.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowNoShifts((value) => !value)}
                className="min-h-11 text-sm font-medium text-security-navy-700 hover:text-security-navy-900"
                aria-expanded={showNoShifts}
              >
                {showNoShifts ? "Hide" : "Show"} {noShifts.length} site{noShifts.length === 1 ? "" : "s"} with no scheduled shifts
              </button>
              {showNoShifts && (
                <ul className="mt-2 overflow-hidden rounded-lg border border-security-navy-100">
                  {noShifts.map((site) => (
                    <li key={site.siteId} className="border-b border-security-navy-100 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => onSelectSite(site.siteId)}
                        className="flex min-h-11 w-full items-center justify-between gap-3 bg-white px-3 py-2.5 text-left hover:bg-security-navy-50"
                      >
                        <span className="truncate text-sm font-medium text-security-navy-900">{site.siteName}</span>
                        <SiteStatusBadge status={site.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {visibleSites.length === 0 && normalizedQuery && (
            <div className="rounded-lg border border-security-navy-100 bg-white px-4 py-6 text-center text-sm text-security-navy-600">
              No sites match “{siteQuery.trim()}”. Try another site name.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
