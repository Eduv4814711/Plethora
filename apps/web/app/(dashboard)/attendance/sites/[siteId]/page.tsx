"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { clsx } from "clsx";
import { format, isValid, parseISO } from "date-fns";
import { useAuth } from "@/lib/auth-context";
import { authFetch, fetchCurrentPayPeriod } from "@/lib/api";
import type { AttendanceShiftTypeFilter } from "@/lib/roster-api";
import { attendanceOverviewHref } from "@/lib/attendance-navigation";
import { SiteTimesheetsSection } from "../../SiteTimesheetsSection";

const SHIFT_OPTIONS: Array<{ value: AttendanceShiftTypeFilter; label: string }> = [
  { value: "day", label: "Day shift" },
  { value: "night", label: "Night shift" },
  { value: "all", label: "All shifts" },
];

function validDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value)));
}

function validShift(value: string | null): AttendanceShiftTypeFilter {
  return value === "day" || value === "night" || value === "all" ? value : "all";
}

export default function AttendanceSitePage() {
  const { token } = useAuth();
  const params = useParams<{ siteId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const siteId = decodeURIComponent(params.siteId);
  const [siteName, setSiteName] = useState("Selected site");
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const start = validDate(searchParams.get("start")) ? searchParams.get("start")! : null;
  const end = validDate(searchParams.get("end")) ? searchParams.get("end")! : null;
  const shiftType = validShift(searchParams.get("shiftType"));

  useEffect(() => {
    if (!token || (start && end)) return;
    setLoadingPeriod(true);
    fetchCurrentPayPeriod(token)
      .then((period) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("start", period.periodStart.slice(0, 10));
        next.set("end", period.periodEnd.slice(0, 10));
        next.set("shiftType", shiftType);
        router.replace(`${pathname}?${next}`, { scroll: false });
      })
      .finally(() => setLoadingPeriod(false));
  }, [end, pathname, router, searchParams, shiftType, start, token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    authFetch("/sites?limit=200", token)
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load the site name");
        return response.json();
      })
      .then((body) => {
        if (cancelled) return;
        const site = (body.data ?? []).find((item: { id: string }) => item.id === siteId);
        if (site?.name) setSiteName(site.name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [siteId, token]);

  const setShiftType = (value: AttendanceShiftTypeFilter) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("shiftType", value);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  if (!start || !end || loadingPeriod) {
    return (
      <div className="animate-pulse space-y-4" aria-label="Loading site attendance">
        <div className="h-20 rounded-security-lg bg-security-navy-100 dark:bg-security-navy-700" />
        <div className="h-72 rounded-security-lg bg-security-navy-100 dark:bg-security-navy-700" />
      </div>
    );
  }

  return (
    <main className="animate-fade-in space-y-4 pb-24">
      <header className="sticky top-0 z-30 rounded-security-lg border border-security-navy-100 bg-white/95 p-4 shadow-security-card backdrop-blur dark:border-security-navy-700 dark:bg-security-navy-900/95">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Link
              href={attendanceOverviewHref({ start, end, shiftType })}
              className="inline-flex min-h-11 items-center text-sm font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
            >
              ← Back to attendance overview
            </Link>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-xl font-semibold text-security-navy-900 dark:text-security-navy-100">{siteName}</h1>
              <span className="text-sm text-security-navy-500 dark:text-security-navy-400">
                {format(parseISO(start), "d MMM yyyy")} – {format(parseISO(end), "d MMM yyyy")}
              </span>
            </div>
            <p className="mt-1 text-xs text-security-navy-500 dark:text-security-navy-400">Step 2 of 2 · Confirm attendance and approve the timesheet</p>
          </div>

          <fieldset>
            <legend className="sr-only">Filter attendance by shift</legend>
            <div className="flex flex-wrap rounded-lg border border-security-navy-100 bg-security-navy-50 p-1 dark:border-security-navy-700 dark:bg-security-navy-900">
              {SHIFT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setShiftType(option.value)}
                  aria-pressed={shiftType === option.value}
                  className={clsx(
                    "min-h-11 rounded-md px-3 text-sm font-medium",
                    shiftType === option.value
                      ? "bg-security-navy-800 text-white shadow-security-card dark:bg-security-navy-600"
                      : "text-security-navy-700 hover:bg-white dark:text-security-navy-300 dark:hover:bg-security-navy-800"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </header>

      {token && (
        <SiteTimesheetsSection
          token={token}
          siteId={siteId}
          siteName={siteName}
          periodStart={start}
          periodEnd={end}
          shiftType={shiftType}
        />
      )}
    </main>
  );
}
