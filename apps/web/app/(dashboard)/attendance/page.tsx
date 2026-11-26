"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import { clsx } from "clsx";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import { fetchCurrentPayPeriod, fetchPayPeriods, type PayPeriodOption } from "@/lib/api";
import { PayPeriodSelect } from "@/components/pay-period-select";
import { AttendanceCaptureDashboard } from "@/components/attendance-capture-dashboard";
import { AttendanceNeedsAttentionPanel } from "@/components/attendance-needs-attention-panel";
import { ControllerTodayWorkspace } from "@/components/controller-today-workspace";
import { StaffRollCall } from "@/components/staff-rollcall";
import { ShiftRollCallModal } from "@/components/shift-rollcall-modal";
import { fetchStaffAttendanceDay } from "@/lib/staff-attendance-api";
import type { AttendanceShiftTypeFilter } from "@/lib/roster-api";
import {
  attendanceSiteHref,
  parseAttendanceDateRange,
  parseAttendanceView,
  type AttendanceView,
} from "@/lib/attendance-navigation";
import {
  Button,
  Card,
  Field,
  PageHeader,
  PageShell,
  SearchInput,
  SkeletonBlock,
  Tabs,
} from "@/components/ui";

const SHIFT_TYPE_OPTIONS: Array<{ value: AttendanceShiftTypeFilter; label: string }> = [
  { value: "day", label: "Day shift" },
  { value: "night", label: "Night shift" },
  { value: "all", label: "All shifts" },
];

function defaultShiftTypeByLocalTime(): AttendanceShiftTypeFilter {
  return new Date().getHours() >= 18 ? "night" : "day";
}

function parseShiftTypeParam(value: string | null): AttendanceShiftTypeFilter {
  return value === "day" || value === "night" || value === "all"
    ? value
    : defaultShiftTypeByLocalTime();
}

function emptyDateRange() {
  const now = new Date();
  return { start: now, end: now };
}

export default function AttendancePage() {
  const { token, user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [shiftType, setShiftType] = useState<AttendanceShiftTypeFilter>(() =>
    parseShiftTypeParam(searchParams.get("shiftType"))
  );
  const [view, setView] = useState<AttendanceView>(() => parseAttendanceView(searchParams.get("view")));
  const [staffDate, setStaffDate] = useState(() => new Date().toISOString().slice(0, 10));
  /**
   * Hide the office tab for pure-guarding companies. Starts null (unknown) and is filled
   * in the first time the roll call loads, so the tab never flickers in and out.
   */
  const [officeStaffCount, setOfficeStaffCount] = useState<number | null>(null);
  const [siteQuery, setSiteQuery] = useState(() => searchParams.get("q") ?? "");
  const [dateRange, setDateRange] = useState(emptyDateRange);
  const [periodKey, setPeriodKey] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [payPeriodOptions, setPayPeriodOptions] = useState<PayPeriodOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [rollCallOpen, setRollCallOpen] = useState(false);
  const readyRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    const deepStart = searchParams.get("start");
    const deepEnd = searchParams.get("end");
    const deepRange = parseAttendanceDateRange(deepStart, deepEnd);
    Promise.all([
      fetchCurrentPayPeriod(token),
      fetchPayPeriods(token, { before: 12, after: 3 }),
    ])
      .then(([current, periods]) => {
        setPayPeriodOptions(periods);
        if (deepRange) {
          const matched = periods.find(
            (period) =>
              period.periodStart.slice(0, 10) === deepRange.start &&
              period.periodEnd.slice(0, 10) === deepRange.end
          );
          if (matched) {
            setPeriodKey(matched.periodKey);
            setPeriodLabel(matched.label);
            setDateRange({ start: parseISO(matched.periodStart), end: parseISO(matched.periodEnd) });
          } else {
            setDateRange({ start: parseISO(deepRange.start), end: parseISO(deepRange.end) });
            setPeriodLabel(`${deepStart} – ${deepEnd}`);
          }
        } else {
          setPeriodKey(current.periodKey);
          setPeriodLabel(current.label);
          setDateRange({ start: parseISO(current.periodStart), end: parseISO(current.periodEnd) });
        }
        readyRef.current = true;
      })
      .catch(console.error)
      .finally(() => setLoading(false));
    // The initial URL is the source of truth; subsequent updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!readyRef.current) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("start", format(dateRange.start, "yyyy-MM-dd"));
    params.set("end", format(dateRange.end, "yyyy-MM-dd"));
    params.set("shiftType", shiftType);
    if (view === "staff") params.set("view", "staff");
    else if (view === "sites") params.set("view", "sites");
    else if (view === "attention") params.set("view", "attention");
    else params.delete("view");
    if (siteQuery.trim()) params.set("q", siteQuery.trim());
    else params.delete("q");
    if (!searchParams.get("siteId")) params.delete("siteId");
    const next = params.toString();
    if (next !== searchParams.toString()) router.replace(`${pathname}?${next}`, { scroll: false });
  }, [dateRange, pathname, router, searchParams, shiftType, siteQuery, view]);

  // Resolve the office headcount once so the tab is right from the first paint rather
  // than only after someone opens it. A failure leaves the tab visible, which is the
  // safe default.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchStaffAttendanceDay(token, new Date().toISOString().slice(0, 10))
      .then((day) => {
        if (!cancelled) setOfficeStaffCount(day.totalGeneralEmployees);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!readyRef.current) return;
    const legacySiteId = searchParams.get("siteId");
    if (!legacySiteId) return;
    const params = new URLSearchParams({
      start: format(dateRange.start, "yyyy-MM-dd"),
      end: format(dateRange.end, "yyyy-MM-dd"),
      shiftType,
    });
    router.replace(`/attendance/sites/${encodeURIComponent(legacySiteId)}?${params}`);
  }, [dateRange, router, searchParams, shiftType]);

  const applyPayPeriod = (period: PayPeriodOption) => {
    setPeriodKey(period.periodKey);
    setPeriodLabel(period.label);
    setDateRange({ start: parseISO(period.periodStart), end: parseISO(period.periodEnd) });
  };

  const shiftPayPeriod = (direction: -1 | 1) => {
    const index = payPeriodOptions.findIndex((period) => period.periodKey === periodKey);
    const next = payPeriodOptions[index + direction];
    if (next) applyPayPeriod(next);
  };

  const openSite = (siteId: string) => {
    router.push(
      attendanceSiteHref(siteId, {
        start: format(dateRange.start, "yyyy-MM-dd"),
        end: format(dateRange.end, "yyyy-MM-dd"),
        shiftType,
      })
    );
  };

  if (loading) {
    return (
      <PageShell width="wide" className="space-y-4" aria-label="Loading attendance">
        <SkeletonBlock className="h-10 w-52" />
        <SkeletonBlock className="h-32 w-full" />
        <SkeletonBlock className="h-72 w-full" />
      </PageShell>
    );
  }

  const dateLabel = `${format(dateRange.start, "d MMM yyyy")} – ${format(dateRange.end, "d MMM yyyy")}`;
  const exceptionParams = new URLSearchParams({
    start: format(dateRange.start, "yyyy-MM-dd"),
    end: format(dateRange.end, "yyyy-MM-dd"),
    shiftType,
  });

  const attendanceTabItems: Array<{ value: AttendanceView; label: string }> = [
    { value: "today", label: "Live Today" },
    { value: "attention", label: "Needs Attention" },
    { value: "sites", label: "Monthly Sign-Off" },
    ...(officeStaffCount !== 0 ? [{ value: "staff" as const, label: "Office Staff" }] : []),
  ];

  return (
    <PageShell width="wide" className="animate-fade-in">
      <PageHeader
        title="Attendance"
        description={
          view === "today"
            ? "Live control room: track who clocked in today, mark absences, or swap a reliever."
            : view === "attention"
            ? "Quickly resolve open clock-in issues, no-shows, and sites waiting for confirmation."
            : view === "staff"
            ? "Mark who was at the office today. Salaried staff are recorded for leave and reporting only."
            : "Review, confirm, and approve site timesheets for Sage payroll export."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="signal" onClick={() => setRollCallOpen(true)}>
              Shift Roll-Call
            </Button>
            <Link
              href={`/attendance/exceptions?${exceptionParams}`}
              className="btn-secondary no-underline"
            >
              Full exception log
            </Link>
          </div>
        }
      />

      <Tabs
        ariaLabel="Attendance views"
        value={view}
        onChange={setView}
        items={attendanceTabItems}
      />

      {view === "today" && token && (
        <ControllerTodayWorkspace
          token={token}
          onOpenHistory={() => setView("sites")}
        />
      )}

      {view === "attention" && token && (
        <AttendanceNeedsAttentionPanel
          token={token}
          periodStart={format(dateRange.start, "yyyy-MM-dd")}
          periodEnd={format(dateRange.end, "yyyy-MM-dd")}
          shiftType={shiftType}
          canApprove={Boolean(user && hasCapability(user, "/attendance", "approve"))}
        />
      )}

      {view === "staff" && token && (
        <StaffRollCall
          token={token}
          date={staffDate}
          onDateChange={setStaffDate}
          onLoaded={(day) => setOfficeStaffCount(day.totalGeneralEmployees)}
        />
      )}

      {view === "sites" && (
        <>
          <Card className="sticky top-0 z-20 p-4 shadow-security-card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-semibold text-security-navy-900">
                  Choose the work to review
                </h2>
                <p className="text-xs text-security-navy-500">
                  {periodLabel || "Selected pay period"} · {dateLabel}
                </p>
              </div>
              <span className="text-xs font-medium text-security-navy-500">
                Step 1 of 2 · Select a site
              </span>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(16rem,1fr)_auto_minmax(14rem,0.8fr)] lg:items-end">
              <div>
                <label className="label-text block">Pay period</label>
                {token && (
                  <PayPeriodSelect
                    token={token}
                    variant="pay"
                    value={periodKey}
                    onChange={applyPayPeriod}
                    className="input-modern mt-1 w-full"
                  />
                )}
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => shiftPayPeriod(-1)}>
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const current = payPeriodOptions.find((period) => period.isCurrent);
                      if (current) applyPayPeriod(current);
                    }}
                  >
                    Current
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => shiftPayPeriod(1)}>
                    Next
                  </Button>
                </div>
              </div>

              <div>
                <p className="label-text mb-1.5">Shift</p>
                <Tabs
                  ariaLabel="Filter by shift"
                  variant="segmented"
                  value={shiftType}
                  onChange={setShiftType}
                  items={SHIFT_TYPE_OPTIONS}
                />
              </div>

              <Field label="Find a site" id="attendance-site-search">
                <SearchInput
                  density="default"
                  value={siteQuery}
                  onChange={setSiteQuery}
                  placeholder="Type a site name..."
                />
              </Field>
            </div>
          </Card>

          {token && (
            <AttendanceCaptureDashboard
              token={token}
              periodStart={format(dateRange.start, "yyyy-MM-dd")}
              periodEnd={format(dateRange.end, "yyyy-MM-dd")}
              shiftType={shiftType}
              onSelectSite={openSite}
              siteQuery={siteQuery}
            />
          )}
        </>
      )}
      {token && (
        <ShiftRollCallModal
          token={token}
          isOpen={rollCallOpen}
          onClose={() => setRollCallOpen(false)}
        />
      )}
    </PageShell>
  );
}
