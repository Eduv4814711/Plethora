"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { format, isValid, parseISO } from "date-fns";
import { useAuth } from "@/lib/auth-context";
import { authFetch, fetchCurrentPayPeriod } from "@/lib/api";
import type { AttendanceShiftTypeFilter } from "@/lib/roster-api";
import { attendanceSiteHref } from "@/lib/attendance-navigation";
import { SiteTimesheetsSection } from "../../SiteTimesheetsSection";
import { Card, PageShell, SkeletonBlock, Tabs } from "@/components/ui";

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
  const focusShiftId = searchParams.get("focusShiftId") || undefined;
  const focusEmployeeId = searchParams.get("focusEmployeeId") || undefined;
  const focusDate = validDate(searchParams.get("focusDate")) ? searchParams.get("focusDate")! : undefined;
  const focus = focusShiftId || focusEmployeeId || focusDate
    ? { shiftId: focusShiftId, employeeId: focusEmployeeId, workDate: focusDate }
    : undefined;
  const returnToParam = searchParams.get("returnTo");
  const returnTo = returnToParam?.startsWith("/attendance/exceptions") ? returnToParam : undefined;

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
      <PageShell width="wide" className="space-y-4" aria-label="Loading site attendance">
        <SkeletonBlock className="h-20 w-full" />
        <SkeletonBlock className="h-72 w-full" />
      </PageShell>
    );
  }

  const routeState = { start, end, shiftType };
  const showAllHref = attendanceSiteHref(siteId, routeState);

  return (
    <PageShell width="wide" className="animate-fade-in pb-24">
      <Card className="sticky top-0 z-30 p-4 shadow-security-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Link
              href={returnTo ?? `/attendance?view=sites&start=${start}&end=${end}&shiftType=${shiftType}`}
              className="inline-flex items-center text-xs font-medium text-security-navy-600 hover:text-security-navy-900"
            >
              {returnTo ? "← Back to attendance issues" : "← Back to Monthly Sign-Off"}
            </Link>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="font-display text-xl font-semibold text-security-navy-950">{siteName}</h1>
              <span className="text-sm tabular-nums text-security-navy-500">
                {format(parseISO(start), "d MMM yyyy")} – {format(parseISO(end), "d MMM yyyy")}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-security-navy-500">
              Step 2 of 2 · Confirm attendance and approve the timesheet
            </p>
          </div>

          <Tabs
            ariaLabel="Filter attendance by shift"
            variant="segmented"
            value={shiftType}
            onChange={setShiftType}
            items={SHIFT_OPTIONS}
          />
        </div>
      </Card>

      {token && (
        <SiteTimesheetsSection
          token={token}
          siteId={siteId}
          siteName={siteName}
          periodStart={start}
          periodEnd={end}
          shiftType={shiftType}
          focus={focus}
          returnTo={returnTo}
          showAllHref={showAllHref}
        />
      )}
    </PageShell>
  );
}
