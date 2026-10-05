"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { Spinner, Button, Card } from "@/components/ui";
import { ControllerGuardRow } from "./controller-guard-row";
import {
  fetchTodayAttendance,
  type TodayAttendanceResponse,
} from "@/lib/attendance-today-api";

interface ControllerTodayWorkspaceProps {
  token: string;
  onOpenHistory?: () => void;
}

export function ControllerTodayWorkspace({
  token,
  onOpenHistory,
}: ControllerTodayWorkspaceProps) {
  const [data, setData] = useState<TodayAttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [shiftFilter, setShiftFilter] = useState<"all" | "day" | "night">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedSites, setCollapsedSites] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchTodayAttendance(token, {
        date,
        shiftType: shiftFilter,
        q: searchQuery.trim() || undefined,
      });
      setData(res);
    } catch (err: any) {
      setError(err.message || "Failed to load operational attendance");
    } finally {
      setLoading(false);
    }
  }, [token, date, shiftFilter, searchQuery]);

  useEffect(() => {
    loadData();
    // Auto-refresh every 30 seconds for real-time control room updates
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const toggleSite = (siteId: string) => {
    setCollapsedSites((prev) => ({ ...prev, [siteId]: !prev[siteId] }));
  };

  const isToday = date === format(new Date(), "yyyy-MM-dd");

  return (
    <div className="space-y-6">
      {/* Top Banner / Filter Toolbar */}
      <div className="rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card dark:border-security-navy-700 dark:bg-security-navy-900">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <h2 className="text-base font-bold text-security-navy-950 dark:text-security-navy-50">
                  Control Room Live Roster
                </h2>
                {isToday && (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    TODAY
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-security-navy-500 dark:text-security-navy-400">
                Guards expected to work today and their real-time clock-in status.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input-modern min-h-10 text-xs py-1.5"
            />
            <div className="flex rounded-md border border-security-navy-200 bg-security-navy-50 p-0.5 dark:border-security-navy-700 dark:bg-security-navy-950">
              {(["all", "day", "night"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setShiftFilter(st)}
                  className={`px-3 py-1 text-xs font-semibold rounded ${
                    shiftFilter === st
                      ? "bg-security-navy-800 text-white shadow-sm dark:bg-security-navy-600"
                      : "text-security-navy-700 hover:text-security-navy-900 dark:text-security-navy-300"
                  }`}
                >
                  {st === "all" ? "All Shifts" : st === "day" ? "Day" : "Night"}
                </button>
              ))}
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={loadData}
              className="min-h-10 text-xs flex items-center gap-1.5"
            >
              🔄 Refresh
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mt-3.5">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search guard name, site name, or employee ID..."
            className="input-modern w-full min-h-10 text-xs"
          />
        </div>
      </div>

      {/* KPI Stats Strip */}
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-security-md border border-security-navy-100 bg-white p-3 shadow-xs dark:border-security-navy-800 dark:bg-security-navy-900">
            <span className="text-[11px] font-medium text-security-navy-500 dark:text-security-navy-400">
              Expected Today
            </span>
            <div className="mt-1 text-xl font-bold text-security-navy-950 dark:text-white">
              {data.totalScheduled}
            </div>
          </div>
          <div className="rounded-security-md border border-emerald-100 bg-emerald-50/50 p-3 shadow-xs dark:border-emerald-950 dark:bg-emerald-950/20">
            <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-400">
              Clocked In
            </span>
            <div className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-300">
              {data.totalClockedIn}
            </div>
          </div>
          <div className="rounded-security-md border border-security-navy-100 bg-white p-3 shadow-xs dark:border-security-navy-800 dark:bg-security-navy-900">
            <span className="text-[11px] font-medium text-security-navy-500 dark:text-security-navy-400">
              Completed (Clocked Out)
            </span>
            <div className="mt-1 text-xl font-bold text-security-navy-800 dark:text-security-navy-200">
              {data.totalClockedOut}
            </div>
          </div>
          <div className="rounded-security-md border border-amber-200 bg-amber-50/60 p-3 shadow-xs dark:border-amber-950 dark:bg-amber-950/20">
            <span className="text-[11px] font-medium text-amber-800 dark:text-amber-400">
              Missing / Late
            </span>
            <div className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-300">
              {data.totalMissing}
            </div>
          </div>
          <div className="rounded-security-md border border-red-200 bg-red-50/60 p-3 shadow-xs dark:border-red-950 dark:bg-red-950/20">
            <span className="text-[11px] font-medium text-red-800 dark:text-red-400">
              Exceptions / Issues
            </span>
            <div className="mt-1 text-xl font-bold text-red-700 dark:text-red-300">
              {data.totalExceptions}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Areas */}
      {loading && !data && (
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <Spinner className="h-8 w-8 text-security-navy-600 mb-2" />
          <p className="text-sm font-medium text-security-navy-600">Loading today&apos;s shifts...</p>
        </div>
      )}

      {error && (
        <div className="rounded-security-md border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      {data && data.shifts.length === 0 && (
        <Card className="p-8 text-center text-security-navy-500">
          <p className="text-sm font-semibold">No rostered shifts found for this day.</p>
          <p className="text-xs mt-1">Check that shifts were generated or published for this date in Rosters.</p>
        </Card>
      )}

      {data &&
        data.shifts.map((shiftWindow) => (
          <div key={shiftWindow.shiftType} className="space-y-4">
            {/* Shift Window Heading */}
            <div className="flex items-center justify-between border-b border-security-navy-200 pb-2 dark:border-security-navy-800">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight uppercase text-security-navy-900 dark:text-security-navy-100">
                  {shiftWindow.shiftLabel}
                </span>
                <span className="text-xs text-security-navy-500">
                  ({shiftWindow.windowStartTime} – {shiftWindow.windowEndTime})
                </span>
              </div>
              <span className="text-xs font-semibold text-security-navy-600 bg-security-navy-100 px-2 py-0.5 rounded dark:bg-security-navy-800 dark:text-security-navy-300">
                {shiftWindow.sites.reduce((acc, s) => acc + s.guards.length, 0)} guards
              </span>
            </div>

            {/* Sites within this Shift Window */}
            <div className="space-y-4">
              {shiftWindow.sites.map((site) => {
                const isCollapsed = collapsedSites[site.siteId] ?? false;
                return (
                  <div
                    key={site.siteId}
                    className="overflow-hidden rounded-security-lg border border-security-navy-200 bg-security-navy-50/50 shadow-xs dark:border-security-navy-800 dark:bg-security-navy-950/40"
                  >
                    {/* Site Header Row */}
                    <div
                      onClick={() => toggleSite(site.siteId)}
                      className="flex cursor-pointer items-center justify-between bg-white px-4 py-3 hover:bg-security-navy-50 dark:bg-security-navy-900 dark:hover:bg-security-navy-800/80 border-b border-security-navy-100 dark:border-security-navy-800"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-security-navy-400">
                          {isCollapsed ? "▶" : "▼"}
                        </span>
                        <h3 className="font-bold text-sm text-security-navy-950 truncate dark:text-white">
                          {site.siteName}
                        </h3>
                        {site.supervisorName && (
                          <span className="text-xs text-security-navy-500 hidden sm:inline">
                            · Sup: {site.supervisorName}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-emerald-700 font-semibold dark:text-emerald-400">
                            {site.totalClockedIn} in
                          </span>
                          <span className="text-security-navy-300">/</span>
                          <span className="text-security-navy-600 font-medium dark:text-security-navy-400">
                            {site.totalScheduled} total
                          </span>
                          {site.totalMissing > 0 && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              {site.totalMissing} missing
                            </span>
                          )}
                          {site.totalExceptions > 0 && (
                            <span className="rounded bg-red-100 px-1.5 py-0.2 text-[10px] font-bold text-red-800 dark:bg-red-950 dark:text-red-300">
                              {site.totalExceptions} exc
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Guards in Site */}
                    {!isCollapsed && (
                      <div className="p-3 space-y-2">
                        {site.guards.map((guard) => (
                          <ControllerGuardRow
                            key={guard.shiftId}
                            guard={guard}
                            token={token}
                            onRefresh={loadData}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}
