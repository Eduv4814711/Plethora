"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { format, parseISO } from "date-fns";
import { fetchCurrentPayPeriod, fetchPayPeriods, type PayPeriodOption } from "@/lib/api";
import { PayPeriodSelect } from "@/components/pay-period-select";
import { OperationalWorkflowSteps } from "@/components/operational-workflow-steps";
import { SiteTimesheetsSection } from "./SiteTimesheetsSection";
import { AttendanceCaptureDashboard } from "@/components/attendance-capture-dashboard";

interface SiteOption {
  id: string;
  name: string;
}

function emptyDateRange() {
  const now = new Date();
  return { start: now, end: now };
}

const WORKFLOW_STEPS = [
  "Pick site & period",
  "Check who was scheduled",
  "Confirm who worked",
  "Approve timesheet",
  "Send to payroll",
];

export default function AttendancePage() {
  const { token } = useAuth();
  const searchParams = useSearchParams();

  const [sites, setSites] = useState<SiteOption[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [dateRange, setDateRange] = useState(emptyDateRange);
  const [periodKey, setPeriodKey] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [payPeriodOptions, setPayPeriodOptions] = useState<PayPeriodOption[]>([]);
  const timesheetSectionRef = useRef<HTMLDivElement>(null);
  const pendingTimesheetScrollRef = useRef(false);

  const handleCaptureSiteSelect = (nextSiteId: string) => {
    pendingTimesheetScrollRef.current = true;
    setSiteId(nextSiteId);
    if (nextSiteId === siteId) {
      pendingTimesheetScrollRef.current = false;
      requestAnimationFrame(() => {
        timesheetSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

  useEffect(() => {
    if (!siteId || !pendingTimesheetScrollRef.current) return;
    pendingTimesheetScrollRef.current = false;
    requestAnimationFrame(() => {
      timesheetSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [siteId]);

  useEffect(() => {
    const deepLinkedSite = searchParams.get("siteId");
    if (deepLinkedSite) setSiteId(deepLinkedSite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) return;
    const deepStart = searchParams.get("start");
    const deepEnd = searchParams.get("end");
    Promise.all([
      fetchCurrentPayPeriod(token),
      fetchPayPeriods(token, { before: 12, after: 3 }),
    ])
      .then(([current, periods]) => {
        setPayPeriodOptions(periods);
        if (deepStart && deepEnd) {
          const matched = periods.find(
            (p) => p.periodStart.slice(0, 10) === deepStart && p.periodEnd.slice(0, 10) === deepEnd
          );
          if (matched) {
            setPeriodKey(matched.periodKey);
            setPeriodLabel(matched.label);
            setDateRange({ start: parseISO(matched.periodStart), end: parseISO(matched.periodEnd) });
            return;
          }
          setDateRange({ start: parseISO(deepStart), end: parseISO(deepEnd) });
          setPeriodLabel(`${deepStart} – ${deepEnd}`);
          return;
        }
        setPeriodKey(current.periodKey);
        setPeriodLabel(current.label);
        setDateRange({ start: parseISO(current.periodStart), end: parseISO(current.periodEnd) });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token) return;
    authFetch("/sites?limit=100", token)
      .then((r) => r.json())
      .then((d) => setSites(d.data || []))
      .catch(console.error);
  }, [token]);

  const applyPayPeriod = (period: PayPeriodOption) => {
    setPeriodKey(period.periodKey);
    setPeriodLabel(period.label);
    setDateRange({ start: parseISO(period.periodStart), end: parseISO(period.periodEnd) });
  };

  const shiftPayPeriod = (direction: -1 | 1) => {
    const idx = payPeriodOptions.findIndex((p) => p.periodKey === periodKey);
    const next = payPeriodOptions[idx + direction];
    if (next) applyPayPeriod(next);
  };

  const goPrevPeriod = () => shiftPayPeriod(-1);
  const goNextPeriod = () => shiftPayPeriod(1);
  const goCurrentPeriod = () => {
    const current = payPeriodOptions.find((p) => p.isCurrent);
    if (current) applyPayPeriod(current);
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-neutral-200 dark:bg-neutral-700 rounded w-48 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-neutral-200 dark:bg-neutral-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="page-title">Attendance</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Confirm who actually worked at each site, then approve the timesheet so payroll pays the right hours.
        </p>
      </div>

      <div className="card-wireframe mb-6 overflow-hidden p-4 sm:p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          How attendance works
        </p>
        <OperationalWorkflowSteps steps={WORKFLOW_STEPS} />
      </div>

      <div className="card-wireframe mb-8 overflow-hidden">
        <div className="border-b border-neutral-200 bg-neutral-50/70 px-4 py-4 dark:border-neutral-700 dark:bg-neutral-900/40 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="section-title">Step 1 — Choose period and site</h3>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Select the pay period, then the site you are recording attendance for.
              </p>
            </div>
            {periodLabel && (
              <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600 shadow-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
                <span className="font-medium text-neutral-800 dark:text-neutral-100">{periodLabel}</span>
                <span className="block mt-0.5">
                  {format(dateRange.start, "d MMM yyyy")} – {format(dateRange.end, "d MMM yyyy")}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-2">
          <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-950/60">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Pay period
            </label>
            <div className="mt-2 grid gap-2">
              {token && (
                <PayPeriodSelect
                  token={token}
                  variant="pay"
                  value={periodKey}
                  onChange={applyPayPeriod}
                  className="input-modern w-full"
                />
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button type="button" onClick={goPrevPeriod} className="btn-secondary px-2 py-2.5 text-sm">
                  ← Previous
                </button>
                <button type="button" onClick={goCurrentPeriod} className="btn-secondary px-2 py-2.5 text-sm">
                  Current period
                </button>
                <button type="button" onClick={goNextPeriod} className="btn-secondary px-2 py-2.5 text-sm">
                  Next →
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-950/60">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Site
            </label>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="input-modern mt-2 w-full"
            >
              <option value="">Select a site…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              Each site has its own timesheet for this period.
            </p>
          </section>

          {token && (
            <AttendanceCaptureDashboard
              token={token}
              periodStart={format(dateRange.start, "yyyy-MM-dd")}
              periodEnd={format(dateRange.end, "yyyy-MM-dd")}
              selectedSiteId={siteId || undefined}
              onSelectSite={handleCaptureSiteSelect}
            />
          )}
        </div>
      </div>

      {siteId && token ? (
        <div ref={timesheetSectionRef} id="attendance-site-timesheet" className="scroll-mt-6">
          <SiteTimesheetsSection
            token={token}
            siteId={siteId}
            siteName={sites.find((s) => s.id === siteId)?.name}
            periodStart={format(dateRange.start, "yyyy-MM-dd")}
            periodEnd={format(dateRange.end, "yyyy-MM-dd")}
          />
        </div>
      ) : (
        <div className="card-wireframe p-8 text-center">
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Select a site to open its timesheet
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
            Choose a site above to see every guard scheduled for the period, capture who actually worked, resolve
            discrepancies, and approve the timesheet for payroll.
          </p>
        </div>
      )}
    </div>
  );
}
