"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { DateInput } from "@/components/date-input";

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function SarsExportsDropdown({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [emp201Period, setEmp201Period] = useState(format(new Date(), "yyyy-MM"));
  const [irp5Year, setIrp5Year] = useState(String(new Date().getFullYear()));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const handleEmp201 = async () => {
    setDownloading("emp201");
    try {
      const res = await authFetch(`/payroll/emp201-export?period=${emp201Period}`, token);
      if (!res.ok) throw new Error("Failed to download");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `EMP201-${emp201Period}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to download EMP201");
    } finally {
      setDownloading(null);
    }
  };

  const handleIrp5 = async () => {
    setDownloading("irp5");
    try {
      const res = await authFetch(`/payroll/irp5-export?taxYear=${irp5Year}`, token);
      if (!res.ok) throw new Error("Failed to download");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `IRP5-${irp5Year}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to download IRP5");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-security border-2 border-security-navy-300 bg-white text-security-navy hover:bg-security-navy-50 hover:border-security-navy-400 transition-all text-sm font-medium"
        aria-label="SARS exports"
      >
        SARS Exports
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-72 p-3 bg-white border border-neutral-200 rounded-security-lg shadow-security-elevated z-20">
          <p className="text-xs text-security-navy-600 mb-3">Export for SARS eFiling</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-security-navy-600 mb-1">EMP201 (monthly)</label>
              <div className="flex gap-2">
                <input
                  type="month"
                  value={emp201Period}
                  onChange={(e) => setEmp201Period(e.target.value)}
                  className="input-modern text-sm flex-1"
                />
                <button onClick={handleEmp201} disabled={downloading === "emp201"} className="btn-primary text-sm py-1.5 px-3 disabled:opacity-50">
                  {downloading === "emp201" ? "…" : "Download"}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-security-navy-600 mb-1">IRP5 (tax year)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={2020}
                  max={2030}
                  value={irp5Year}
                  onChange={(e) => setIrp5Year(e.target.value)}
                  className="input-modern text-sm w-24"
                />
                <button onClick={handleIrp5} disabled={downloading === "irp5"} className="btn-primary text-sm py-1.5 px-3 disabled:opacity-50">
                  {downloading === "irp5" ? "…" : "Download"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface PayrollRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
}

interface RunSummary {
  totalGrossPay: number;
  totalNetPay: number;
  totalOvertime: number;
  employeeCount: number;
  complianceIssueCount: number;
  criticalComplianceCount: number;
  warningComplianceCount: number;
}

interface ReserveSnapshot {
  monthlyPayrollBurden: number;
  oneMonthReserve: number;
  threeMonthReserve: number;
  statutoryReserve: number;
  reserveGap?: number;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-security-navy-100 text-security-navy-700 border-neutral-200" },
  calculated: { label: "Calculated", className: "bg-security-amber-100 text-security-amber-700 border-security-amber-200" },
  approved: { label: "Approved", className: "bg-security-emerald-50 text-security-emerald-600 border-security-emerald-200" },
  paid: { label: "Paid", className: "bg-security-emerald-50 text-security-emerald-600 border-security-emerald-200" },
};

const PAYROLL_WORKFLOW_STEPS = [
  { step: 1, title: "Attendance", caption: "Timesheets & clock data", ring: "border-neutral-200 bg-white text-security-navy" },
  { step: 2, title: "Create run", caption: "Open a pay period", ring: "border-neutral-200 bg-white text-security-navy" },
  {
    step: 3,
    title: "Calculate",
    caption: "Pay, tax & compliance",
    ring: "border-security-amber-400 bg-security-amber-50 text-security-amber-800 shadow-sm shadow-security-amber-200/50",
  },
  { step: 4, title: "Approve", caption: "Review & sign off", ring: "border-neutral-200 bg-white text-security-navy" },
  {
    step: 5,
    title: "Mark paid",
    caption: "Close the period",
    ring: "border-security-emerald-400 bg-security-emerald-50 text-security-emerald-800 shadow-sm shadow-security-emerald-200/40",
  },
] as const;

export default function PayrollPage() {
  const { token } = useAuth();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [metrics, setMetrics] = useState<{
    pendingApprovals: number;
    reserve: ReserveSnapshot | null;
    latestRunSummary: RunSummary | null;
    totalComplianceIssues: number;
  }>({ pendingApprovals: 0, reserve: null, latestRunSummary: null, totalComplianceIssues: 0 });
  const [metricsLoading, setMetricsLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!token) return;
    authFetch("/payroll/runs", token)
      .then((r) => r.json())
      .then((d) => {
        const newRuns = d.data || [];
        setRuns(newRuns);
        const calculated = newRuns.find((r: PayrollRun) => r.status === "calculated");
        if (calculated) {
          authFetch(`/payroll/runs/${calculated.id}/summary`, token)
            .then((res) => (res.ok ? res.json() : null))
            .then((s) => s && setMetrics((m) => ({ ...m, latestRunSummary: s, totalComplianceIssues: s.complianceIssueCount ?? 0 })))
            .catch(() => {});
        } else {
          setMetrics((m) => ({ ...m, latestRunSummary: null, totalComplianceIssues: 0 }));
        }
      })
      .catch(console.error);
    setMetricsLoading(true);
    Promise.all([
      authFetch("/dashboard", token).then((r) => r.json()),
      authFetch("/payroll/reserve", token).then((r) => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([dashboard, reserve]) => {
        const pa = dashboard?.alerts?.find((a: { type: string }) => a.type === "pending_approvals");
        setMetrics((m) => ({
          ...m,
          pendingApprovals: pa?.count ?? 0,
          reserve: reserve ?? null,
        }));
      })
      .catch(() => {})
      .finally(() => setMetricsLoading(false));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    authFetch("/payroll/runs", token)
      .then((r) => r.json())
      .then((d) => {
        const newRuns = d.data || [];
        setRuns(newRuns);
        const calculated = newRuns.find((r: PayrollRun) => r.status === "calculated");
        if (calculated) {
          authFetch(`/payroll/runs/${calculated.id}/summary`, token)
            .then((res) => (res.ok ? res.json() : null))
            .then((s) => s && setMetrics((m) => ({ ...m, latestRunSummary: s, totalComplianceIssues: s.complianceIssueCount ?? 0 })))
            .catch(() => {});
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    setMetricsLoading(true);
    Promise.all([
      authFetch("/dashboard", token).then((r) => r.json()),
      authFetch("/payroll/reserve", token).then((r) => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([dashboard, reserve]) => {
        const pa = dashboard?.alerts?.find((a: { type: string }) => a.type === "pending_approvals");
        setMetrics((m) => ({
          ...m,
          pendingApprovals: pa?.count ?? 0,
          reserve: reserve ?? null,
        }));
      })
      .catch(() => {})
      .finally(() => setMetricsLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-security-navy-200 rounded w-48 mb-6" />
        <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-security-navy-100 rounded-security-lg" />
          ))}
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-security-navy-100 rounded-security-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
        <div>
          <h1 className="page-title">Payroll</h1>
          <p className="text-security-navy-600 mt-1 text-sm">Manage payroll runs, view financial metrics, and control the workflow</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            {showForm ? "Cancel" : "+ New Payroll Run"}
          </button>
          <SarsExportsDropdown token={token!} />
          <Link
            href="/payroll/leave-requests"
            className="flex items-center gap-2 px-4 py-2.5 rounded-security border-2 border-security-navy-300 bg-white text-security-navy hover:bg-security-navy-50 hover:border-security-navy-400 transition-all text-sm font-medium"
          >
            Leave Requests
          </Link>
          <Link
            href="/payroll/configuration"
            className="flex items-center gap-2 px-4 py-2.5 rounded-security border-2 border-security-navy-300 bg-white text-security-navy hover:bg-security-navy-50 hover:border-security-navy-400 transition-all"
            aria-label="Payroll configuration"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-sm font-medium">Configuration</span>
          </Link>
        </div>
      </div>

      {/* Payroll workflow — high-visibility guide aligned with dashboard aesthetic */}
      <section
        className="mb-6 overflow-hidden rounded-security-lg border border-security-navy-200/70 bg-white shadow-security-elevated"
        aria-label="Payroll workflow steps"
      >
        <div className="border-b border-neutral-100 bg-gradient-to-r from-security-navy-50/90 via-white to-security-emerald-50/40 px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-security-lg border border-security-emerald-200/80 bg-security-emerald-50 text-security-emerald-700 shadow-sm"
              aria-hidden
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.75}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-security-navy-500">Process guide</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-security-navy sm:text-xl">Payroll workflow</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-security-navy-600">
                Follow these stages in order for every period: capture attendance, create the run, calculate pay and statutory amounts, approve, then mark as paid.
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-5 sm:px-6 sm:py-6">
          {/* Desktop: horizontal stepper with connector line */}
          <div className="relative hidden md:block">
            <div
              className="absolute left-[10%] right-[10%] top-5 h-px bg-gradient-to-r from-neutral-200 via-security-navy-200 to-security-emerald-300"
              aria-hidden
            />
            <ol className="relative grid grid-cols-5 gap-2">
              {PAYROLL_WORKFLOW_STEPS.map((s) => (
                <li key={s.step} className="flex flex-col items-center text-center">
                  <div
                    className={`relative z-[1] flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums ${s.ring}`}
                  >
                    {s.step}
                  </div>
                  <p className="mt-3 text-xs font-semibold text-security-navy">{s.title}</p>
                  <p className="mt-1 max-w-[9rem] text-[11px] leading-snug text-security-navy-500">{s.caption}</p>
                </li>
              ))}
            </ol>
          </div>

          {/* Mobile / small: vertical timeline */}
          <div className="relative md:hidden">
            <div
              className="absolute left-[19px] top-3 bottom-3 w-px bg-gradient-to-b from-neutral-200 via-security-navy-200 to-security-emerald-300"
              aria-hidden
            />
            <ol className="relative m-0 list-none space-y-0 p-0">
              {PAYROLL_WORKFLOW_STEPS.map((s) => (
                <li key={s.step} className="relative flex gap-4 pb-6 last:pb-0">
                  <div
                    className={`relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums ${s.ring}`}
                  >
                    {s.step}
                  </div>
                  <div className="min-w-0 pt-1">
                    <p className="text-sm font-semibold text-security-navy">{s.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-security-navy-600">{s.caption}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <p className="mt-5 rounded-security border border-neutral-100 bg-security-navy-50/50 px-3 py-2.5 text-center text-xs text-security-navy-600 md:text-left">
            <span className="font-medium text-security-navy">Tip:</span> always run <strong className="font-semibold text-security-amber-800">Calculate</strong> before{" "}
            <strong className="font-semibold text-security-navy">Approve</strong>, then <strong className="font-semibold text-security-emerald-800">Mark paid</strong> when funds have cleared.
          </p>
        </div>
      </section>

      {showForm && (
        <PayrollRunForm
          token={token!}
          onSuccess={() => {
            setShowForm(false);
            refresh();
          }}
        />
      )}

      {/* Payroll Intelligence - Reserve, Contract Labour, Employee Costs (at top) */}
      <PayrollIntelligenceSection token={token!} runs={runs} onRefresh={refresh} />

      {/* Dashboard metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="card-wireframe p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-security-navy-500">Pending Approvals</p>
              {metricsLoading ? (
                <div className="h-8 w-16 bg-security-navy-100 rounded mt-2 animate-pulse" />
              ) : (
                <p className="text-2xl font-bold text-security-navy mt-1">{metrics.pendingApprovals}</p>
              )}
              <p className="text-xs text-security-navy-500 mt-0.5">Runs awaiting approval</p>
            </div>
            <div className="w-10 h-10 rounded-security-lg bg-security-amber-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-security-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="card-wireframe p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-security-navy-500">1-Month Reserve</p>
              {metricsLoading ? (
                <div className="h-8 w-24 bg-security-navy-100 rounded mt-2 animate-pulse" />
              ) : metrics.reserve ? (
                <p className="text-xl font-bold text-security-navy mt-1">{formatCurrency(metrics.reserve.oneMonthReserve)}</p>
              ) : (
                <p className="text-sm text-security-navy-500 mt-1">—</p>
              )}
              <p className="text-xs text-security-navy-500 mt-0.5">Recommended reserve</p>
            </div>
            <div className="w-10 h-10 rounded-security-lg bg-security-emerald-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-security-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="card-wireframe p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-security-navy-500">Latest Run</p>
              {metrics.latestRunSummary ? (
                <>
                  <p className="text-xl font-bold text-security-navy mt-1">{formatCurrency(metrics.latestRunSummary.totalGrossPay)}</p>
                  <p className="text-xs text-security-navy-500 mt-0.5">{metrics.latestRunSummary.employeeCount} employees</p>
                </>
              ) : (
                <p className="text-sm text-security-navy-500 mt-1">No calculated run</p>
              )}
            </div>
            <div className="w-10 h-10 rounded-security-lg bg-security-navy-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-security-navy-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="card-wireframe p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-security-navy-500">Compliance</p>
              {metrics.latestRunSummary?.complianceIssueCount != null ? (
                <>
                  <p className={`text-xl font-bold mt-1 ${metrics.latestRunSummary.criticalComplianceCount > 0 ? "text-red-600" : metrics.latestRunSummary.warningComplianceCount > 0 ? "text-security-amber-600" : "text-security-navy"}`}>
                    {metrics.latestRunSummary.complianceIssueCount} issues
                  </p>
                  <p className="text-xs text-security-navy-500 mt-0.5">
                    {metrics.latestRunSummary.criticalComplianceCount} critical
                  </p>
                </>
              ) : (
                <p className="text-sm text-security-navy-500 mt-1">No data</p>
              )}
            </div>
            <div className={`w-10 h-10 rounded-security-lg flex items-center justify-center ${
              metrics.latestRunSummary?.criticalComplianceCount ? "bg-red-50" : metrics.latestRunSummary?.warningComplianceCount ? "bg-security-amber-50" : "bg-security-navy-100"
            }`}>
              <svg className={`w-5 h-5 ${metrics.latestRunSummary?.criticalComplianceCount ? "text-red-600" : metrics.latestRunSummary?.warningComplianceCount ? "text-security-amber-600" : "text-security-navy-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Payroll runs */}
      <div className="space-y-4">
        {runs.map((run) => (
          <PayrollRunCard key={run.id} run={run} token={token!} onAction={refresh} />
        ))}
      </div>

      {runs.length === 0 && (
        <div className="card-wireframe p-12 text-center">
          <p className="text-security-navy-600 mb-4">No payroll runs yet</p>
          <button onClick={() => setShowForm(true)} className="btn-primary">
            Create your first payroll run
          </button>
        </div>
      )}
    </div>
  );
}

interface ContractLabourItem {
  siteId: string;
  siteName: string;
  employeeCount: number;
  totalLabourCost: number;
  overtimeCost: number;
  allowancesCost: number;
  revenue: number | null;
  labourRatio: number | null;
  healthIndicator: "healthy" | "warning" | "danger" | null;
  insufficientData: boolean;
  overtimePct: number;
}

interface ContractLabourResult {
  contracts: ContractLabourItem[];
  unallocatedCost: number;
  periodStart: string;
  periodEnd: string;
}

interface EmployeeCostItem {
  employeeId: string;
  employeeName: string | null;
  employeeNumber: string | null;
  basePay: number;
  overtimePay: number;
  allowances: number;
  deductions: number;
  totalEmployerCost: number;
  grossPay: number;
  netPay: number;
}

interface EmployeeCostResult {
  payrollRunId: string;
  periodStart: string;
  periodEnd: string;
  employees: EmployeeCostItem[];
}

function PayrollIntelligenceSection({
  token,
  runs,
  onRefresh,
}: {
  token: string;
  runs: PayrollRun[];
  onRefresh: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"reserve" | "contracts" | "employees">("reserve");

  return (
    <div className="card-wireframe mb-8 overflow-hidden">
      <div className="border-b border-neutral-200">
        <div className="flex">
          {(["reserve", "contracts", "employees"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-security-navy text-security-navy bg-security-navy-50"
                  : "text-security-navy-600 hover:text-security-navy hover:bg-security-navy-50/50"
              }`}
            >
              {tab === "reserve" && "Reserve Summary"}
              {tab === "contracts" && "Contract Labour Cost"}
              {tab === "employees" && "Employee Cost Summary"}
            </button>
          ))}
        </div>
      </div>
      <div className="p-5">
        {activeTab === "reserve" && <ReserveSummaryPanel token={token} onRefresh={onRefresh} />}
        {activeTab === "contracts" && <ContractLabourCostPanel token={token} />}
        {activeTab === "employees" && <EmployeeCostSummaryPanel token={token} runs={runs} />}
      </div>
    </div>
  );
}

function ReserveSummaryPanel({ token, onRefresh }: { token: string; onRefresh: () => void }) {
  const [data, setData] = useState<ReserveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [availableCash, setAvailableCash] = useState("");
  const [cashInput, setCashInput] = useState("");

  const fetchReserve = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (cashInput && !Number.isNaN(parseFloat(cashInput))) params.set("availableCash", cashInput);
    authFetch(`/payroll/reserve?${params.toString()}`, token)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [token, cashInput]);

  useEffect(() => {
    fetchReserve();
  }, [fetchReserve]);

  const handleApplyCash = () => {
    setCashInput(availableCash);
    setAvailableCash("");
  };

  if (loading && !data) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-security-navy-100 rounded w-48" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-security-navy-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8">
        <p className="text-security-navy-600 mb-4">No reserve data available. Add paid payroll runs to see estimates.</p>
        <button onClick={fetchReserve} className="btn-secondary">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h4 className="font-semibold text-security-navy">Payroll Reserve Summary</h4>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="Available cash (optional)"
            value={availableCash}
            onChange={(e) => setAvailableCash(e.target.value)}
            className="input-modern text-sm w-40"
          />
          <button onClick={handleApplyCash} className="btn-secondary text-sm">Apply</button>
          <button onClick={fetchReserve} className="btn-ghost text-sm">Refresh</button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-3 rounded-security bg-security-navy-50 border border-neutral-200">
          <p className="text-xs font-medium text-security-navy-600">Monthly Burden</p>
          <p className="text-lg font-bold text-security-navy mt-1">{formatCurrency(data.monthlyPayrollBurden)}</p>
        </div>
        <div className="p-3 rounded-security bg-security-navy-50 border border-neutral-200">
          <p className="text-xs font-medium text-security-navy-600">1-Month Reserve</p>
          <p className="text-lg font-bold text-security-navy mt-1">{formatCurrency(data.oneMonthReserve)}</p>
        </div>
        <div className="p-3 rounded-security bg-security-navy-50 border border-neutral-200">
          <p className="text-xs font-medium text-security-navy-600">3-Month Reserve</p>
          <p className="text-lg font-bold text-security-navy mt-1">{formatCurrency(data.threeMonthReserve)}</p>
        </div>
        <div className="p-3 rounded-security bg-security-navy-50 border border-neutral-200">
          <p className="text-xs font-medium text-security-navy-600">Statutory Reserve</p>
          <p className="text-lg font-bold text-security-navy mt-1">{formatCurrency(data.statutoryReserve)}</p>
        </div>
      </div>
      {data.reserveGap != null && (
        <div className={`p-3 rounded-security border ${data.reserveGap > 0 ? "bg-red-50 border-red-200" : "bg-security-emerald-50 border-security-emerald-200"}`}>
          <p className="text-sm font-medium">Reserve Gap</p>
          <p className={`text-lg font-bold mt-1 ${data.reserveGap > 0 ? "text-red-600" : "text-security-emerald-600"}`}>
            {formatCurrency(data.reserveGap)}
          </p>
          <p className="text-xs text-security-navy-600 mt-0.5">
            {data.reserveGap > 0 ? "Shortfall – reserve below target" : "Surplus – reserve above 1-month target"}
          </p>
        </div>
      )}
    </div>
  );
}

function ContractLabourCostPanel({ token }: { token: string }) {
  const now = new Date();
  const [periodStart, setPeriodStart] = useState(format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd"));
  const [periodEnd, setPeriodEnd] = useState(format(now, "yyyy-MM-dd"));
  const [data, setData] = useState<ContractLabourResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleLoad = () => {
    setLoading(true);
    setLoaded(false);
    authFetch(`/payroll/contracts/labour-cost?periodStart=${periodStart}&periodEnd=${periodEnd}`, token)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-security-navy-600">From</span>
          <DateInput value={periodStart} onChange={setPeriodStart} className="input-modern text-sm w-40" showToday ariaLabel="Period start" />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-security-navy-600">To</span>
          <DateInput value={periodEnd} onChange={setPeriodEnd} className="input-modern text-sm w-40" showToday ariaLabel="Period end" />
        </label>
        <button onClick={handleLoad} disabled={loading} className="btn-primary text-sm disabled:opacity-50">
          {loading ? "Loading…" : "Load"}
        </button>
      </div>

      {loaded && data && (
        <>
          {data.contracts.length === 0 && data.unallocatedCost === 0 ? (
            <p className="text-security-navy-600">No contract labour data for this period. Ensure payroll runs exist and employees have shifts at sites.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left py-2 text-security-navy-600 font-medium">Site</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Employees</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Labour Cost</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Overtime</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Revenue</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Labour %</th>
                    <th className="text-center py-2 text-security-navy-600 font-medium">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {data.contracts.map((c) => (
                    <tr key={c.siteId} className="border-t border-security-navy-100">
                      <td className="py-2.5 font-medium">{c.siteName}</td>
                      <td className="text-right py-2.5">{c.employeeCount}</td>
                      <td className="text-right py-2.5">{formatCurrency(c.totalLabourCost)}</td>
                      <td className="text-right py-2.5">{formatCurrency(c.overtimeCost)}</td>
                      <td className="text-right py-2.5">{c.revenue != null ? formatCurrency(c.revenue) : "—"}</td>
                      <td className="text-right py-2.5">
                        {c.labourRatio != null ? `${(c.labourRatio * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="text-center py-2.5">
                        {c.healthIndicator && (
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            c.healthIndicator === "healthy" ? "bg-security-emerald-100 text-security-emerald-700" :
                            c.healthIndicator === "warning" ? "bg-security-amber-100 text-security-amber-700" :
                            "bg-red-100 text-red-700"
                          }`}>
                            {c.healthIndicator}
                          </span>
                        )}
                        {c.insufficientData && <span className="text-security-navy-500 text-xs">No revenue</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.unallocatedCost > 0 && (
                <p className="text-sm text-security-navy-600 mt-3">Unallocated cost: {formatCurrency(data.unallocatedCost)} (e.g. office staff)</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EmployeeCostSummaryPanel({ token, runs }: { token: string; runs: PayrollRun[] }) {
  const runsWithItems = runs.filter((r) => ["calculated", "approved", "paid"].includes(r.status));
  const [selectedRunId, setSelectedRunId] = useState("");
  const [data, setData] = useState<EmployeeCostResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleLoad = () => {
    if (!selectedRunId) return;
    setLoading(true);
    setLoaded(false);
    authFetch(`/payroll/employees/cost-summary?payrollRunId=${selectedRunId}`, token)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-security-navy-600">Payroll Run</span>
          <select
            value={selectedRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
            className="input-modern text-sm w-64"
          >
            <option value="">Select a run</option>
            {runsWithItems.map((r) => (
              <option key={r.id} value={r.id}>
                {format(new Date(r.periodStart), "d MMM yyyy")} – {format(new Date(r.periodEnd), "d MMM yyyy")} ({r.status})
              </option>
            ))}
          </select>
        </label>
        <button onClick={handleLoad} disabled={loading || !selectedRunId} className="btn-primary text-sm disabled:opacity-50">
          {loading ? "Loading…" : "Load"}
        </button>
      </div>

      {loaded && data && (
        <>
          {data.employees.length === 0 ? (
            <p className="text-security-navy-600">No employee cost data for this run.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left py-2 text-security-navy-600 font-medium">Employee</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Base Pay</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Overtime</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Allowances</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Deductions</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Gross</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Net</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((c) => (
                    <tr key={c.employeeId} className="border-t border-security-navy-100">
                      <td className="py-2.5">
                        <span className="font-medium">{c.employeeName ?? "—"}</span>
                        {c.employeeNumber && <span className="text-xs text-security-navy-500 ml-1">({c.employeeNumber})</span>}
                      </td>
                      <td className="text-right py-2.5">{formatCurrency(c.basePay)}</td>
                      <td className="text-right py-2.5">{formatCurrency(c.overtimePay)}</td>
                      <td className="text-right py-2.5">{formatCurrency(c.allowances)}</td>
                      <td className="text-right py-2.5">{formatCurrency(c.deductions)}</td>
                      <td className="text-right py-2.5">{formatCurrency(c.grossPay)}</td>
                      <td className="text-right py-2.5">{formatCurrency(c.netPay)}</td>
                      <td className="text-right py-2.5 font-semibold">{formatCurrency(c.totalEmployerCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-security-navy-500 mt-3">Total Cost includes gross pay + employer UIF + SDL</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PayrollRunForm({ token, onSuccess }: { token: string; onSuccess: () => void }) {
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await authFetch("/payroll/runs", token, {
      method: "POST",
      body: JSON.stringify({
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
      }),
    });
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="card-wireframe mb-8 p-6">
      <h3 className="font-semibold text-security-navy mb-4">New Payroll Run</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label-text block mb-1">Period start</label>
          <DateInput value={periodStart} onChange={setPeriodStart} className="input-modern" showToday required />
        </div>
        <div>
          <label className="label-text block mb-1">Period end</label>
          <DateInput value={periodEnd} onChange={setPeriodEnd} className="input-modern" showToday required />
        </div>
      </div>
      <button type="submit" className="mt-4 btn-primary">Create</button>
    </form>
  );
}

interface PayrollItem {
  id: string;
  employee: { firstName: string; lastName: string };
  netPay: string;
}

function PayrollRunCard({
  run,
  token,
  onAction,
}: {
  run: PayrollRun;
  token: string;
  onAction: () => void;
}) {
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [showItems, setShowItems] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloadingFnb, setDownloadingFnb] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchItems = () => {
    authFetch(`/payroll/runs/${run.id}/items`, token)
      .then((r) => r.json())
      .then((d) => setItems(d.data || []));
  };

  const fetchSummary = () => {
    authFetch(`/payroll/runs/${run.id}/summary`, token)
      .then((r) => r.ok ? r.json() : null)
      .then(setSummary)
      .catch(() => setSummary(null));
  };

  const handleCalculate = async () => {
    setActionLoading(true);
    try {
      await authFetch(`/payroll/runs/${run.id}/calculate`, token, { method: "POST" });
      onAction();
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      await authFetch(`/payroll/runs/${run.id}/approve`, token, { method: "POST" });
      onAction();
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkPaid = async () => {
    setActionLoading(true);
    try {
      await authFetch(`/payroll/runs/${run.id}/mark-paid`, token, { method: "POST" });
      onAction();
    } finally {
      setActionLoading(false);
    }
  };

  const handlePreviewPayslip = async (item: PayrollItem) => {
    setPreviewingId(item.id);
    setPreviewError(null);
    try {
      const res = await authFetch(`/payroll/runs/${run.id}/items/${item.id}/payslip/pdf`, token);
      if (!res.ok) throw new Error("Failed to load payslip");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to load payslip");
    } finally {
      setPreviewingId(null);
    }
  };

  const handleDownloadFnbCsv = async () => {
    setDownloadingFnb(true);
    try {
      const res = await authFetch(`/payroll/runs/${run.id}/export/fnb`, token);
      if (!res.ok) throw new Error("Failed to download FNB CSV");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll-fnb-${format(new Date(run.periodStart), "yyyy-MM")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to download FNB CSV");
    } finally {
      setDownloadingFnb(false);
    }
  };

  const canExportFnb = ["calculated", "approved", "paid"].includes(run.status);
  const status = statusConfig[run.status] ?? { label: run.status, className: "bg-security-navy-100 text-security-navy-600" };

  const toggleExpand = () => {
    if (!showItems) {
      fetchItems();
      if (["calculated", "approved", "paid"].includes(run.status)) fetchSummary();
    }
    setShowItems(!showItems);
  };

  return (
    <div className="card-wireframe p-5 hover:shadow-security-card-hover transition-shadow">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div>
            <span className="font-semibold text-security-navy">
              {format(new Date(run.periodStart), "d MMM yyyy")} – {format(new Date(run.periodEnd), "d MMM yyyy")}
            </span>
            <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium border ${status.className}`}>
              {status.label}
            </span>
          </div>
          {summary && (
            <div className="flex flex-wrap gap-4 text-sm text-security-navy-600">
              <span>Gross: {formatCurrency(summary.totalGrossPay)}</span>
              <span>Net: {formatCurrency(summary.totalNetPay)}</span>
              <span>{summary.employeeCount} employees</span>
              {summary.complianceIssueCount > 0 && (
                <span className={summary.criticalComplianceCount > 0 ? "text-red-600 font-medium" : "text-security-amber-600"}>
                  {summary.complianceIssueCount} compliance issues
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {run.status === "draft" && (
            <button onClick={handleCalculate} disabled={actionLoading} className="btn-primary text-sm disabled:opacity-50">
              {actionLoading ? "Calculating…" : "Calculate"}
            </button>
          )}
          {run.status === "calculated" && (
            <button onClick={handleApprove} disabled={actionLoading} className="btn-primary text-sm disabled:opacity-50">
              {actionLoading ? "Approving…" : "Approve"}
            </button>
          )}
          {run.status === "approved" && (
            <button onClick={handleMarkPaid} disabled={actionLoading} className="btn-primary text-sm disabled:opacity-50">
              {actionLoading ? "Processing…" : "Mark Paid"}
            </button>
          )}
          <button onClick={toggleExpand} className="btn-secondary text-sm">
            {showItems ? "Hide" : "View"} Items
          </button>
          {canExportFnb && (
            <button onClick={handleDownloadFnbCsv} disabled={downloadingFnb} className="btn-secondary text-sm disabled:opacity-50">
              {downloadingFnb ? "Downloading…" : "FNB CSV"}
            </button>
          )}
        </div>
      </div>

      {showItems && (
        <div className="mt-5 pt-5 border-t border-neutral-200">
          {previewError && (
            <p className="text-red-600 text-sm mb-3">{previewError}</p>
          )}
          {canExportFnb && items.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <button onClick={handleDownloadFnbCsv} disabled={downloadingFnb} className="btn-primary text-sm disabled:opacity-50">
                {downloadingFnb ? "Downloading…" : "Download FNB CSV for Bulk Payment"}
              </button>
              <span className="text-xs text-security-navy-500">Upload to FNB Online Banking for bulk salary payments</span>
            </div>
          )}
          {items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left py-2 text-security-navy-600 font-medium">Team Member</th>
                    <th className="text-right py-2 text-security-navy-600 font-medium">Net Pay</th>
                    <th className="text-right py-2 w-32 text-security-navy-600 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-t border-security-navy-100">
                      <td className="py-2.5">{item.employee.firstName} {item.employee.lastName}</td>
                      <td className="text-right py-2.5 font-medium">{item.netPay}</td>
                      <td className="text-right py-2.5">
                        <button
                          type="button"
                          onClick={() => handlePreviewPayslip(item)}
                          disabled={previewingId === item.id}
                          className="btn-secondary text-xs py-1.5 px-2 disabled:opacity-50"
                        >
                          {previewingId === item.id ? "Opening…" : "Preview Payslip"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-security-navy-500 text-sm">No items yet. Run Calculate.</p>
          )}
        </div>
      )}
    </div>
  );
}
