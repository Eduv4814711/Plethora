"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import { clsx } from "clsx";
import { useAuth } from "@/lib/auth-context";
import { fetchCurrentPayPeriod, fetchPayPeriods, type PayPeriodOption } from "@/lib/api";
import { PayPeriodSelect } from "@/components/pay-period-select";
import { AttendanceCaptureDashboard } from "@/components/attendance-capture-dashboard";
import type { AttendanceShiftTypeFilter } from "@/lib/roster-api";
import { attendanceSiteHref, parseAttendanceDateRange } from "@/lib/attendance-navigation";

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
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [shiftType, setShiftType] = useState<AttendanceShiftTypeFilter>(() =>
    parseShiftTypeParam(searchParams.get("shiftType"))
  );
  const [siteQuery, setSiteQuery] = useState(() => searchParams.get("q") ?? "");
  const [dateRange, setDateRange] = useState(emptyDateRange);
  const [periodKey, setPeriodKey] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [payPeriodOptions, setPayPeriodOptions] = useState<PayPeriodOption[]>([]);
  const [loading, setLoading] = useState(true);
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
    if (siteQuery.trim()) params.set("q", siteQuery.trim());
    else params.delete("q");
    if (!searchParams.get("siteId")) params.delete("siteId");
    const next = params.toString();
    if (next !== searchParams.toString()) router.replace(`${pathname}?${next}`, { scroll: false });
  }, [dateRange, pathname, router, searchParams, shiftType, siteQuery]);

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
      <div className="animate-pulse space-y-4" aria-label="Loading attendance">
        <div className="h-8 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-32 rounded-xl bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-72 rounded-xl bg-neutral-200 dark:bg-neutral-700" />
      </div>
    );
  }

  const dateLabel = `${format(dateRange.start, "d MMM yyyy")} – ${format(dateRange.end, "d MMM yyyy")}`;
  const exceptionParams = new URLSearchParams({
    start: format(dateRange.start, "yyyy-MM-dd"),
    end: format(dateRange.end, "yyyy-MM-dd"),
    shiftType,
  });

  return (
    <main className="animate-fade-in space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-security-navy-600 dark:text-security-navy-300">
            Daily operations
          </p>
          <h1 className="page-title mt-1">Attendance</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
            Start with a site that needs attention, confirm who worked, then approve its timesheet for payroll.
          </p>
        </div>
        <Link
          href={`/attendance/exceptions?${exceptionParams}`}
          className="btn-secondary min-h-11 shrink-0 self-start text-sm"
        >
          Review attendance issues
        </Link>
      </header>

      <section className="sticky top-0 z-20 rounded-xl border border-neutral-200 bg-white/95 p-4 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-950/95">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Choose the work to review</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{periodLabel || "Selected pay period"} · {dateLabel}</p>
          </div>
          <span className="rounded-full bg-security-navy-50 px-3 py-1 text-xs font-medium text-security-navy-700 dark:bg-security-navy-950/40 dark:text-security-navy-200">
            Step 1 of 2 · Select a site
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(16rem,1fr)_auto_minmax(14rem,0.8fr)] lg:items-end">
          <div>
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Pay period</label>
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
              <button type="button" onClick={() => shiftPayPeriod(-1)} className="btn-secondary min-h-11 px-2 text-sm">Previous</button>
              <button
                type="button"
                onClick={() => {
                  const current = payPeriodOptions.find((period) => period.isCurrent);
                  if (current) applyPayPeriod(current);
                }}
                className="btn-secondary min-h-11 px-2 text-sm"
              >
                Current
              </button>
              <button type="button" onClick={() => shiftPayPeriod(1)} className="btn-secondary min-h-11 px-2 text-sm">Next</button>
            </div>
          </div>

          <fieldset>
            <legend className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Shift</legend>
            <div className="mt-1 flex flex-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-700 dark:bg-neutral-900">
              {SHIFT_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setShiftType(option.value)}
                  aria-pressed={shiftType === option.value}
                  className={clsx(
                    "min-h-11 rounded-md px-3 text-sm font-medium",
                    shiftType === option.value
                      ? "bg-security-navy-800 text-white shadow-sm dark:bg-security-navy-600"
                      : "text-neutral-700 hover:bg-white dark:text-neutral-300 dark:hover:bg-neutral-800"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="attendance-site-search" className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Find a site
            </label>
            <input
              id="attendance-site-search"
              type="search"
              value={siteQuery}
              onChange={(event) => setSiteQuery(event.target.value)}
              placeholder="Type a site name…"
              className="input-modern mt-1 min-h-11 w-full"
              autoComplete="off"
            />
          </div>
        </div>
      </section>

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
    </main>
  );
}
