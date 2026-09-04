"use client";

import { Fragment, useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { clsx } from "clsx";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { canAccessSensitiveData, hasCapability } from "@/lib/permissions";
import { PayPeriodSelect } from "@/components/pay-period-select";
import { attendanceExceptionCopy } from "@/lib/attendance-exception-copy";
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  SkeletonBlock,
  TableShell,
  useConfirmDialog,
} from "@/components/ui";

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
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(!open)}
        className="gap-2"
        aria-label="SARS exports"
      >
        SARS Exports
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </Button>
      {open && (
        <div className="absolute right-0 mt-1 w-72 p-3 bg-white border border-security-navy-100 rounded-security-lg shadow-security-elevated z-20">
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
                <Button type="button" size="sm" onClick={handleEmp201} loading={downloading === "emp201"}>
                  Download
                </Button>
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
                <Button type="button" size="sm" onClick={handleIrp5} loading={downloading === "irp5"}>
                  Download
                </Button>
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
  periodsUsed: number;
  dataSource?: "paid" | "projected";
}

const REPORTABLE_RUN_STATUSES = ["calculated", "approved", "paid"] as const;

function latestReportableRun(runs: PayrollRun[]): PayrollRun | undefined {
  return runs
    .filter((r) => REPORTABLE_RUN_STATUSES.includes(r.status as (typeof REPORTABLE_RUN_STATUSES)[number]))
    .sort((a, b) => new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime())[0];
}

function loadLatestRunSummary(token: string, runs: PayrollRun[]) {
  const latest = latestReportableRun(runs);
  if (!latest) {
    return Promise.resolve(null);
  }
  return authFetch(`/payroll/runs/${latest.id}/summary`, token)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}

const statusConfig: Record<string, { label: string; variant: "neutral" | "warning" | "success" }> = {
  draft: { label: "Draft", variant: "neutral" },
  calculated: { label: "Calculated", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  paid: { label: "Paid", variant: "success" },
};

const PAYROLL_WORKFLOW_STEPS = [
  { step: 1, title: "Attendance", caption: "Guard attendance (office staff use fixed salary)" },
  { step: 2, title: "Create run", caption: "Open a pay period" },
  { step: 3, title: "Calculate", caption: "Pay, tax & compliance — relievers with approved attendance are included", highlight: "amber" as const },
  { step: 4, title: "Approve", caption: "Review & sign off" },
  { step: 5, title: "Mark paid", caption: "Close the period", highlight: "emerald" as const },
] as const;

const INTELLIGENCE_TABS = [
  { id: "reserve" as const, label: "Reserve Summary" },
  { id: "contracts" as const, label: "Contract Labour Cost" },
  { id: "employees" as const, label: "Employee Cost Summary" },
];

function workflowStepClass(highlight?: "amber" | "emerald") {
  if (highlight === "amber") {
    return "border-security-amber-300 bg-security-amber-50 text-security-amber-800";
  }
  if (highlight === "emerald") {
    return "border-security-emerald-300 bg-security-emerald-50 text-security-emerald-800";
  }
  return "border-security-navy-100 bg-white text-security-navy";
}

export default function PayrollPage() {
  const { token, user } = useAuth();
  const canViewSensitivePayroll = user ? canAccessSensitiveData(user, "/payroll") : false;
  const canCreatePayroll = Boolean(user && hasCapability(user, "/payroll", "create"));
  const canEditPayroll = Boolean(user && hasCapability(user, "/payroll", "edit"));
  const canApprovePayroll = Boolean(user && hasCapability(user, "/payroll", "approve"));
  const canExportPayroll = Boolean(user && hasCapability(user, "/payroll", "export"));
  const canViewBilling = Boolean(user && hasCapability(user, "/payroll/billing", "view"));
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
        loadLatestRunSummary(token, newRuns).then((s) => {
          if (s) {
            setMetrics((m) => ({
              ...m,
              latestRunSummary: s,
              totalComplianceIssues: s.complianceIssueCount ?? 0,
            }));
          } else {
            setMetrics((m) => ({ ...m, latestRunSummary: null, totalComplianceIssues: 0 }));
          }
        });
      })
      .catch(console.error);
    setMetricsLoading(true);
    Promise.all([
      authFetch("/dashboard", token).then((r) => r.json()),
      authFetch("/payroll/reserve", token).then((r) => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([dashboard, reserve]) => {
        const pa =
          dashboard?.pendingPayrollRunApprovals ??
          dashboard?.alerts?.find(
            (a: { type: string }) =>
              a.type === "pending_payroll_run_approvals" || a.type === "pending_approvals"
          )?.count ??
          0;
        setMetrics((m) => ({
          ...m,
          pendingApprovals: typeof pa === "number" ? pa : pa?.count ?? 0,
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
        loadLatestRunSummary(token, newRuns).then((s) => {
          if (s) {
            setMetrics((m) => ({
              ...m,
              latestRunSummary: s,
              totalComplianceIssues: s.complianceIssueCount ?? 0,
            }));
          }
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    setMetricsLoading(true);
    Promise.all([
      authFetch("/dashboard", token).then((r) => r.json()),
      authFetch("/payroll/reserve", token).then((r) => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([dashboard, reserve]) => {
        const pa =
          dashboard?.pendingPayrollRunApprovals ??
          dashboard?.alerts?.find(
            (a: { type: string }) =>
              a.type === "pending_payroll_run_approvals" || a.type === "pending_approvals"
          )?.count ??
          0;
        setMetrics((m) => ({
          ...m,
          pendingApprovals: typeof pa === "number" ? pa : pa?.count ?? 0,
          reserve: reserve ?? null,
        }));
      })
      .catch(() => {})
      .finally(() => setMetricsLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="animate-fade-in max-w-7xl mx-auto space-y-6">
        <SkeletonBlock className="h-9 w-48" />
        <SkeletonBlock className="h-36 w-full" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <SkeletonBlock key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Payroll"
        description="Manage payroll runs, review financial metrics, and control the pay period workflow."
        actions={
          <>
            {canCreatePayroll && <Button type="button" variant={showForm ? "secondary" : "primary"} onClick={() => setShowForm(!showForm)}>
              {showForm ? "Cancel" : "New payroll run"}
            </Button>}
            {canExportPayroll && canViewSensitivePayroll && <SarsExportsDropdown token={token!} />}
            <Link href="/employees/leave" className="btn-secondary text-sm">
              Leave requests
            </Link>
            {canViewBilling && (
              <Link href="/payroll/billing" className="btn-secondary text-sm">
                Client billing
              </Link>
            )}
            <Link href="/payroll/configuration" className="btn-secondary text-sm">
              Configuration
            </Link>
          </>
        }
      />

      {/* Payroll workflow */}
      <section className="card-wireframe overflow-hidden" aria-label="Payroll workflow steps">
        <div className="border-b border-security-navy-100 px-5 py-4 sm:px-6">
          <p className="section-title mb-1">Process guide</p>
          <h2 className="text-base font-semibold text-security-navy-900">Payroll workflow</h2>
          <p className="mt-1 max-w-2xl text-sm text-security-navy-600">
            Follow these stages in order for every period: capture guard attendance, create the run, calculate pay and statutory amounts, approve, then mark as paid. Office staff are paid a fixed monthly salary and do not need attendance.
          </p>
        </div>

        <div className="px-5 py-5 sm:px-6">
          <div className="relative hidden md:block">
            <div className="absolute left-[10%] right-[10%] top-5 h-px bg-security-navy-100" aria-hidden />
            <ol className="relative grid grid-cols-5 gap-2">
              {PAYROLL_WORKFLOW_STEPS.map((s) => (
                <li key={s.step} className="flex flex-col items-center text-center">
                  <div
                    className={clsx(
                      "relative z-[1] flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums",
                      workflowStepClass("highlight" in s ? s.highlight : undefined)
                    )}
                  >
                    {s.step}
                  </div>
                  <p className="mt-3 text-xs font-semibold text-security-navy">{s.title}</p>
                  <p className="mt-1 max-w-[9rem] text-[11px] leading-snug text-security-navy-600">{s.caption}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="relative md:hidden">
            <div className="absolute left-[19px] top-3 bottom-3 w-px bg-security-navy-100" aria-hidden />
            <ol className="relative m-0 list-none space-y-0 p-0">
              {PAYROLL_WORKFLOW_STEPS.map((s) => (
                <li key={s.step} className="relative flex gap-4 pb-6 last:pb-0">
                  <div
                    className={clsx(
                      "relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums",
                      workflowStepClass("highlight" in s ? s.highlight : undefined)
                    )}
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

          <AlertBanner variant="info" className="mt-5">
            Always run <strong className="font-semibold">Calculate</strong> before <strong className="font-semibold">Approve</strong>, then{" "}
            <strong className="font-semibold">Mark paid</strong> when funds have cleared.
          </AlertBanner>
        </div>
      </section>

      {showForm && canCreatePayroll && (
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
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card-wireframe p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="section-title">Pending approvals</p>
              {metricsLoading ? (
                <SkeletonBlock className="mt-2 h-8 w-16" />
              ) : (
                <p className="mt-1 text-2xl font-bold text-security-navy-900">{metrics.pendingApprovals}</p>
              )}
              <p className="mt-0.5 text-xs text-security-navy-600">Runs awaiting approval</p>
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
              <p className="section-title">1-month reserve</p>
              {metricsLoading ? (
                <SkeletonBlock className="mt-2 h-8 w-24" />
              ) : metrics.reserve && metrics.reserve.periodsUsed > 0 ? (
                <p className="mt-1 font-mono text-xl font-bold text-security-navy-900">{formatCurrency(metrics.reserve.oneMonthReserve)}</p>
              ) : (
                <p className="mt-1 text-sm text-security-navy-600">—</p>
              )}
              <p className="mt-0.5 text-xs text-security-navy-600">Recommended reserve</p>
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
              <p className="section-title">Latest run</p>
              {metrics.latestRunSummary ? (
                <>
                  <p className="mt-1 font-mono text-xl font-bold text-security-navy-900">{formatCurrency(metrics.latestRunSummary.totalGrossPay)}</p>
                  <p className="mt-0.5 text-xs text-security-navy-600">{metrics.latestRunSummary.employeeCount} employees</p>
                </>
              ) : (
                <p className="mt-1 text-sm text-security-navy-600">No calculated run</p>
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
              <p className="section-title">Compliance</p>
              {metrics.latestRunSummary?.complianceIssueCount != null ? (
                <>
                  <p className={clsx(
                    "mt-1 text-xl font-bold",
                    metrics.latestRunSummary.criticalComplianceCount > 0
                      ? "text-red-600"
                      : metrics.latestRunSummary.warningComplianceCount > 0
                        ? "text-security-amber-600"
                        : "text-security-navy-900"
                  )}>
                    {metrics.latestRunSummary.complianceIssueCount} issues
                  </p>
                  <p className="mt-0.5 text-xs text-security-navy-600">
                    {metrics.latestRunSummary.criticalComplianceCount} critical
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-security-navy-600">No compliance checks yet</p>
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

      {runs.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="section-title">Payroll runs</h2>
            <p className="text-sm text-security-navy-600">{runs.length} run{runs.length === 1 ? "" : "s"}</p>
          </div>
          {runs.map((run) => (
            <PayrollRunCard
              key={run.id}
              run={run}
              token={token!}
              canEdit={canEditPayroll}
              canApprove={canApprovePayroll}
              canExport={canExportPayroll}
              onAction={refresh}
            />
          ))}
        </section>
      ) : (
        <EmptyState
          title="No payroll runs yet"
          description="Create a run to calculate wages, run compliance checks, and prepare bank and SARS exports."
          action={canCreatePayroll ? (
            <Button type="button" onClick={() => setShowForm(true)}>
              Create payroll run
            </Button>
          ) : null}
        />
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
    <div className="card-wireframe overflow-hidden">
      <div className="flex gap-1 overflow-x-auto border-b border-security-navy-100 px-2 pt-2">
        {INTELLIGENCE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "-mb-px rounded-t-sm px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border border-security-navy-100 border-b-transparent bg-white text-security-navy-900"
                : "text-security-navy-600 hover:text-security-navy-900"
            )}
          >
            {tab.label}
          </button>
        ))}
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
      <div className="space-y-4">
        <SkeletonBlock className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <SkeletonBlock key={i} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  if (!data || data.periodsUsed === 0) {
    return (
      <EmptyState
        title="No reserve data"
        description="Calculate a payroll run to see reserve estimates. Figures become more accurate once runs are marked as paid."
        action={
          <Button type="button" variant="secondary" onClick={fetchReserve}>
            Retry
          </Button>
        }
        className="max-w-none border-0 shadow-none"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-sm font-semibold text-security-navy-900">Payroll reserve summary</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            placeholder="Available cash (optional)"
            value={availableCash}
            onChange={(e) => setAvailableCash(e.target.value)}
            className="input-compact w-44"
          />
          <Button type="button" variant="secondary" size="sm" onClick={handleApplyCash}>
            Apply
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={fetchReserve}>
            Refresh
          </Button>
        </div>
      </div>
      {data.dataSource === "projected" && (
        <AlertBanner variant="info">
          Based on calculated payroll runs (not yet marked as paid). Reserve figures update automatically when runs are paid.
        </AlertBanner>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-security border border-security-navy-100 bg-security-navy-50 p-3">
          <p className="label-text">Monthly burden</p>
          <p className="mt-1 font-mono text-lg font-bold text-security-navy-900">{formatCurrency(data.monthlyPayrollBurden)}</p>
        </div>
        <div className="rounded-security border border-security-navy-100 bg-security-navy-50 p-3">
          <p className="label-text">1-month reserve</p>
          <p className="mt-1 font-mono text-lg font-bold text-security-navy-900">{formatCurrency(data.oneMonthReserve)}</p>
        </div>
        <div className="rounded-security border border-security-navy-100 bg-security-navy-50 p-3">
          <p className="label-text">3-month reserve</p>
          <p className="mt-1 font-mono text-lg font-bold text-security-navy-900">{formatCurrency(data.threeMonthReserve)}</p>
        </div>
        <div className="rounded-security border border-security-navy-100 bg-security-navy-50 p-3">
          <p className="label-text">Statutory reserve</p>
          <p className="mt-1 font-mono text-lg font-bold text-security-navy-900">{formatCurrency(data.statutoryReserve)}</p>
        </div>
      </div>
      {data.reserveGap != null && (
        <AlertBanner variant={data.reserveGap > 0 ? "error" : "success"}>
          <p className="font-semibold">Reserve gap: {formatCurrency(data.reserveGap)}</p>
          <p className="mt-0.5 text-xs">
            {data.reserveGap > 0 ? "Shortfall — reserve below target" : "Surplus — reserve above 1-month target"}
          </p>
        </AlertBanner>
      )}
    </div>
  );
}

function ContractLabourCostPanel({ token }: { token: string }) {
  const [periodKey, setPeriodKey] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [data, setData] = useState<ContractLabourResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleLoad = () => {
    setLoading(true);
    setLoaded(false);
    const qs = periodKey
      ? `periodKey=${encodeURIComponent(periodKey)}`
      : `periodStart=${periodStart}&periodEnd=${periodEnd}`;
    authFetch(`/payroll/contracts/labour-cost?${qs}`, token)
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
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem]">
          <label htmlFor="contract-labour-period" className="label-text block mb-1.5">
            Pay period
          </label>
          <PayPeriodSelect
            token={token}
            variant="pay"
            value={periodKey}
            onChange={(p) => {
              setPeriodKey(p.periodKey);
              setPeriodStart(p.periodStart);
              setPeriodEnd(p.periodEnd);
            }}
            className="input-modern text-sm w-full"
          />
        </div>
        <Button type="button" size="sm" onClick={handleLoad} disabled={loading || !periodKey} loading={loading}>
          Load
        </Button>
      </div>

      {loaded && data && (
        <>
          {data.contracts.length === 0 && data.unallocatedCost === 0 ? (
            <p className="text-sm text-security-navy-600">No contract labour data for this period. Ensure payroll runs exist and employees have shifts at sites.</p>
          ) : (
            <>
              <TableShell title="Contract labour by site">
                <thead className="bg-security-navy-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-security-navy-600">Site</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Employees</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Labour cost</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Overtime</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Revenue</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Labour %</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-security-navy-600">Health</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-security-navy-100">
                  {data.contracts.map((c) => (
                    <tr key={c.siteId}>
                      <td className="px-4 py-2.5 font-medium text-security-navy-900">{c.siteName}</td>
                      <td className="px-4 py-2.5 text-right">{c.employeeCount}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(c.totalLabourCost)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(c.overtimeCost)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{c.revenue != null ? formatCurrency(c.revenue) : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {c.labourRatio != null ? `${(c.labourRatio * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {c.healthIndicator && (
                          <Badge
                            variant={
                              c.healthIndicator === "healthy"
                                ? "success"
                                : c.healthIndicator === "warning"
                                  ? "warning"
                                  : "error"
                            }
                          >
                            {c.healthIndicator}
                          </Badge>
                        )}
                        {c.insufficientData && <span className="text-xs text-security-navy-500">No revenue</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
              {data.unallocatedCost > 0 && (
                <p className="text-sm text-security-navy-600">Unallocated cost: <span className="font-mono font-medium">{formatCurrency(data.unallocatedCost)}</span> (e.g. office staff)</p>
              )}
            </>
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
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="employee-cost-run" className="label-text block mb-1.5">
            Payroll run
          </label>
          <select
            id="employee-cost-run"
            value={selectedRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
            className="input-modern w-64 text-sm"
          >
            <option value="">Select a run</option>
            {runsWithItems.map((r) => (
              <option key={r.id} value={r.id}>
                {format(new Date(r.periodStart), "d MMM yyyy")} – {format(new Date(r.periodEnd), "d MMM yyyy")} ({r.status})
              </option>
            ))}
          </select>
        </div>
        <Button type="button" size="sm" onClick={handleLoad} disabled={loading || !selectedRunId} loading={loading}>
          Load
        </Button>
      </div>

      {loaded && data && (
        <>
          {data.employees.length === 0 ? (
            <p className="text-sm text-security-navy-600">No employee cost data for this run.</p>
          ) : (
            <>
              <TableShell title="Employee cost summary">
                <thead className="bg-security-navy-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-security-navy-600">Employee</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Base pay</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Overtime</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Allowances</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Deductions</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Gross</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Net</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Total cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-security-navy-100">
                  {data.employees.map((c) => (
                    <tr key={c.employeeId}>
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-security-navy-900">{c.employeeName ?? "—"}</span>
                        {c.employeeNumber && <span className="ml-1 font-mono text-xs text-security-navy-500">({c.employeeNumber})</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(c.basePay)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(c.overtimePay)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(c.allowances)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(c.deductions)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(c.grossPay)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(c.netPay)}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold">{formatCurrency(c.totalEmployerCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
              <p className="text-xs text-security-navy-500">Total cost includes gross pay + employer UIF + SDL</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function PayrollRunForm({ token, onSuccess }: { token: string; onSuccess: () => void }) {
  const [periodKey, setPeriodKey] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!periodStart || !periodEnd) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await authFetch("/payroll/runs", token, {
        method: "POST",
        body: JSON.stringify({
          periodStart: new Date(`${periodStart}T00:00:00.000Z`).toISOString(),
          periodEnd: new Date(`${periodEnd}T23:59:59.999Z`).toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          typeof err.message === "string" ? err.message : "Could not create the payroll run. Please try again."
        );
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the payroll run. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card-wireframe p-6">
      <h3 className="section-title mb-4">New payroll run</h3>
      {error && (
        <AlertBanner variant="error" className="mb-4">
          {error}
        </AlertBanner>
      )}
      <div className="max-w-md space-y-2">
        <label htmlFor="new-payroll-period" className="label-text block">
          Pay period
        </label>
        <PayPeriodSelect
          token={token}
          variant="pay"
          value={periodKey}
          onChange={(p) => {
            setPeriodKey(p.periodKey);
            setPeriodStart(p.periodStart);
            setPeriodEnd(p.periodEnd);
            setPeriodLabel(p.label);
          }}
        />
        {periodLabel && (
          <p className="text-xs text-security-navy-600">
            {periodLabel}: {periodStart} – {periodEnd}
          </p>
        )}
      </div>
      <Button type="submit" className="mt-4" disabled={!periodKey} loading={submitting}>
        Create payroll run
      </Button>
    </form>
  );
}

interface PayrollItem {
  id: string;
  employee: {
    firstName: string;
    lastName: string;
    group: { id: string; name: string; sortOrder: number } | null;
  };
  netPay: string;
}

interface PayrollItemGroup {
  key: string;
  name: string;
  sortOrder: number;
  items: PayrollItem[];
  totalNetPay: number;
}

function parsePayAmount(value: string | number): number {
  const amount = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(amount) ? amount : 0;
}

function groupPayrollItemsByTeam(items: PayrollItem[]): PayrollItemGroup[] {
  const groups = new Map<string, PayrollItemGroup>();

  for (const item of items) {
    const group = item.employee.group;
    const key = group?.id ?? "ungrouped";
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      existing.totalNetPay += parsePayAmount(item.netPay);
      continue;
    }
    groups.set(key, {
      key,
      name: group?.name ?? "Unassigned",
      sortOrder: group?.sortOrder ?? 9999,
      items: [item],
      totalNetPay: parsePayAmount(item.netPay),
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) =>
        a.employee.lastName.localeCompare(b.employee.lastName, undefined, { sensitivity: "base" })
      ),
    }))
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
}

interface PayrollValidationIssue {
  ruleId: string;
  ruleName: string;
  severity: "critical" | "warning";
  message: string;
  employeeName?: string;
  suggestedAction: string;
}

interface PayrollValidationResponse {
  canApprove: boolean;
  canExportBank: boolean;
  criticalCount: number;
  warningCount: number;
  issues: PayrollValidationIssue[];
  bankExport: {
    valid: boolean;
    totalNetPay: number;
    exportTotal: number;
    excludedEmployees: Array<{ employeeName: string; missingFields: string[]; netPay: number }>;
  };
  statutoryReconciliation: {
    matched: boolean;
    mismatches: string[];
    emp201Preview?: { period: string; payeLiability: number; uifLiability: number; sdlLiability: number; matchesRun: boolean };
  };
}

interface SkippedEmployee {
  name: string;
  employeeNumber: string | null;
  skipReason: string;
}


interface BlockingExceptionGroup {
  exceptionType: string;
  label: string;
  count: number;
  samples: Array<{
    id: string;
    employeeName: string | null;
    employeeNumber: string | null;
    siteName: string | null;
    date: string | null;
    description: string;
  }>;
}

interface BlockingExceptionBreakdown {
  total: number;
  groups: BlockingExceptionGroup[];
  periodStart: string;
  periodEnd: string;
}

interface CalculationSnapshotResponse {
  snapshot: {
    inputs: { employeesSkipped: number };
    employees: Array<{
      context: {
        firstName: string;
        lastName: string;
        employeeNumber: string | null;
      };
      output: {
        skipped?: boolean;
        skipReason?: string;
      };
    }>;
  };
}

function fnbCsvSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "group";
}

function skipReasonLabel(reason: string): string {
  switch (reason) {
    case "missing_monthly_salary":
      return "Set monthly salary on employee profile";
    case "no_timesheet_hours":
      return "Capture guard attendance or set monthly salary";
    case "missing_pay_rate":
      return "Set pay grade or hourly rate";
    default:
      return reason.replace(/_/g, " ");
  }
}

function PayrollRunCard({
  run,
  token,
  canEdit,
  canApprove,
  canExport,
  onAction,
}: {
  run: PayrollRun;
  token: string;
  canEdit: boolean;
  canApprove: boolean;
  canExport: boolean;
  onAction: () => void;
}) {
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [showItems, setShowItems] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [skippedEmployees, setSkippedEmployees] = useState<SkippedEmployee[]>([]);
  const [skippedExpanded, setSkippedExpanded] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloadingFnbGroup, setDownloadingFnbGroup] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sitesNeedingApproval, setSitesNeedingApproval] = useState<{ id: string; name: string }[]>([]);
  const [blockingExceptions, setBlockingExceptions] = useState<BlockingExceptionBreakdown | null>(null);
  const [expandedExceptionType, setExpandedExceptionType] = useState<string | null>(null);
  const [validation, setValidation] = useState<PayrollValidationResponse | null>(null);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [revertReason, setRevertReason] = useState("");
  const { confirm, confirmDialog } = useConfirmDialog();

  const fetchValidation = () => {
    if (run.status === "draft") {
      setValidation(null);
      return;
    }
    authFetch(`/payroll/runs/${run.id}/validation`, token)
      .then((r) => (r.ok ? r.json() : null))
      .then(setValidation)
      .catch(() => setValidation(null));
  };

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

  const fetchCalculationSnapshot = () => {
    authFetch(`/payroll/runs/${run.id}/calculation-snapshot`, token)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CalculationSnapshotResponse | null) => {
        if (!data?.snapshot) {
          setSkippedEmployees([]);
          return;
        }
        const skipped = data.snapshot.employees
          .filter((e) => e.output.skipped)
          .map((e) => ({
            name: `${e.context.firstName} ${e.context.lastName}`,
            employeeNumber: e.context.employeeNumber,
            skipReason: e.output.skipReason ?? "unknown",
          }));
        setSkippedEmployees(skipped);
      })
      .catch(() => setSkippedEmployees([]));
  };

  const loadRunDetails = () => {
    fetchItems();
    fetchSummary();
    fetchCalculationSnapshot();
    fetchValidation();
  };

  const handleCalculate = async () => {
    if (!canEdit) return;
    setActionLoading(true);
    setActionError(null);
    setSitesNeedingApproval([]);
    setBlockingExceptions(null);
    try {
      const res = await authFetch(`/payroll/runs/${run.id}/calculate`, token, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const sites = err?.details?.sitesNeedingApproval;
        if (Array.isArray(sites) && sites.length > 0) {
          setSitesNeedingApproval(sites);
        }
        const blocking = err?.payrollReadiness?.blockingExceptions;
        if (blocking?.groups?.length) {
          setBlockingExceptions(blocking);
        }
        throw new Error(
          typeof err.message === "string" ? err.message : "Payroll calculation failed"
        );
      }
      setShowItems(true);
      loadRunDetails();
      onAction();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Payroll calculation failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!canApprove) return;
    if (validation && validation.criticalCount > 0) {
      setActionError(
        `Cannot approve: ${validation.criticalCount} critical validation issue(s) must be resolved first.`
      );
      return;
    }

    const confirmed = await confirm({
      title: "Approve payroll run?",
      message: "This locks the run for payment. Verify bank details and IRP5 data are complete.",
      confirmLabel: "Approve",
      danger: false,
    });
    if (!confirmed) return;

    setActionLoading(true);
    setActionError(null);
    setBlockingExceptions(null);
    try {
      const res = await authFetch(`/payroll/runs/${run.id}/approve`, token, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const blocking = err?.payrollReadiness?.blockingExceptions;
        if (blocking?.groups?.length) {
          setBlockingExceptions(blocking);
        }
        const validationMsg =
          err.validation?.issues?.length > 0
            ? err.validation.issues
                .filter((i: PayrollValidationIssue) => i.severity === "critical")
                .map((i: PayrollValidationIssue) => i.message)
                .join(" ")
            : null;
        throw new Error(
          validationMsg ??
            (typeof err.message === "string" ? err.message : "Failed to approve payroll run")
        );
      }
      onAction();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to approve payroll run");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevertToDraft = async () => {
    if (!canEdit) return;
    if (revertReason.trim().length < 5) {
      setActionError("Please provide a revert reason (at least 5 characters).");
      return;
    }

    setActionLoading(true);
    setActionError(null);
    try {
      const res = await authFetch(`/payroll/runs/${run.id}/revert-to-draft`, token, {
        method: "POST",
        body: JSON.stringify({ reason: revertReason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          typeof err.message === "string" ? err.message : "Failed to revert payroll run"
        );
      }
      setShowRevertModal(false);
      setRevertReason("");
      onAction();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to revert payroll run");
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!canApprove) return;
    const confirmed = await confirm({
      title: "Mark this payroll run as paid?",
      message:
        "Only do this once the money has actually been paid out. A paid run is final and cannot be reverted to draft.",
      confirmLabel: "Mark as paid",
      danger: false,
    });
    if (!confirmed) return;

    setActionLoading(true);
    setActionError(null);
    try {
      const res = await authFetch(`/payroll/runs/${run.id}/mark-paid`, token, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          typeof err.message === "string" ? err.message : "Failed to mark payroll as paid"
        );
      }
      onAction();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to mark payroll as paid");
    } finally {
      setActionLoading(false);
    }
  };

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const handlePreviewPayslip = async (item: PayrollItem) => {
    if (!canExport) return;
    // Open the destination synchronously from the click event so browsers do
    // not treat the eventual PDF navigation as an unsolicited popup.
    const previewWindow = window.open("about:blank", "_blank");
    setPreviewingId(item.id);
    setPreviewError(null);
    try {
      const res = await authFetch(`/payroll/runs/${run.id}/items/${item.id}/payslip/pdf`, token);
      if (!res.ok) {
        // Try to extract a meaningful error message from the API response body
        const contentType = res.headers.get("content-type") ?? "";
        let apiMessage: string | null = null;
        if (contentType.includes("application/json")) {
          const body = await res.json().catch(() => ({}));
          apiMessage = body.message || body.error || null;
        }
        if (res.status === 403) {
          throw new Error(
            apiMessage ?? "You don't have permission to view payslips. Ask your administrator to grant 'view sensitive data' access on the Payroll module."
          );
        }
        if (res.status === 404) {
          throw new Error(apiMessage ?? "Payslip not found. The payroll item may have been removed or is not yet finalized.");
        }
        throw new Error(apiMessage ?? `Failed to load payslip (server error ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (previewWindow && !previewWindow.closed) {
        previewWindow.location.href = url;
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `payslip-${item.employee.firstName}-${item.employee.lastName}.pdf`;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      previewWindow?.close();
      setPreviewError(err instanceof Error ? err.message : "Failed to load payslip");
    } finally {
      setPreviewingId(null);
    }
  };

  const handleDownloadFnbCsv = async (groupKey: string, groupName: string) => {
    if (!canExport) return;
    setDownloadingFnbGroup(groupKey);
    try {
      const groupParam =
        groupKey === "ungrouped"
          ? "groupId=ungrouped"
          : `groupId=${encodeURIComponent(groupKey)}`;
      const res = await authFetch(`/payroll/runs/${run.id}/export/fnb?${groupParam}`, token);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail =
          err.validation?.excludedEmployees?.length > 0
            ? err.validation.excludedEmployees
                .map(
                  (e: { employeeName: string; missingFields: string[] }) =>
                    `${e.employeeName}: missing ${e.missingFields.join(", ")}`
                )
                .join("; ")
            : typeof err.message === "string"
              ? err.message
              : null;
        throw new Error(detail ?? "Failed to download FNB CSV");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll-fnb-${format(new Date(run.periodStart), "yyyy-MM")}-${fnbCsvSlug(groupName)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to download FNB CSV");
    } finally {
      setDownloadingFnbGroup(null);
    }
  };

  const canExportFnb = canExport && ["calculated", "approved", "paid"].includes(run.status);
  const status = statusConfig[run.status] ?? { label: run.status, variant: "neutral" as const };

  const toggleExpand = () => {
    if (!showItems) {
      loadRunDetails();
    }
    setShowItems(!showItems);
  };

  return (
    <div className="card-dashboard p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div>
            <span className="font-semibold text-security-navy-900">
              {format(new Date(run.periodStart), "d MMM yyyy")} – {format(new Date(run.periodEnd), "d MMM yyyy")}
            </span>
            <Badge variant={status.variant} className="ml-2">
              {status.label}
            </Badge>
          </div>
          {summary && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-security-navy-600">
              <span>Gross: <span className="font-mono font-medium text-security-navy-900">{formatCurrency(summary.totalGrossPay)}</span></span>
              <span>Net: <span className="font-mono font-medium text-security-navy-900">{formatCurrency(summary.totalNetPay)}</span></span>
              <span>{summary.employeeCount} employees</span>
              {summary.complianceIssueCount > 0 && (
                <span className={summary.criticalComplianceCount > 0 ? "font-medium text-red-600" : "font-medium text-security-amber-600"}>
                  {summary.complianceIssueCount} compliance issues
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && run.status === "draft" && (
            <Button type="button" size="sm" onClick={handleCalculate} loading={actionLoading}>
              Calculate
            </Button>
          )}
          {run.status === "calculated" && (
            <>
              {canApprove && (
              <Button type="button" size="sm" onClick={handleApprove} loading={actionLoading}>
                Approve
              </Button>
              )}
              {canEdit && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setActionError(null);
                  setShowRevertModal(true);
                }}
                disabled={actionLoading}
              >
                Revert to draft
              </Button>
              )}
            </>
          )}
          {run.status === "approved" && (
            <>
              {canApprove && (
              <Button type="button" size="sm" onClick={handleMarkPaid} loading={actionLoading}>
                Mark paid
              </Button>
              )}
              {canEdit && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setActionError(null);
                  setShowRevertModal(true);
                }}
                disabled={actionLoading}
              >
                Revert to draft
              </Button>
              )}
            </>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={toggleExpand}>
            {showItems ? "Hide items" : "View items"}
          </Button>
        </div>
      </div>

      {actionError && !showItems && (
        <AlertBanner variant="error" className="mt-4">
          <div className="space-y-2">
            <p>{actionError}</p>
            {sitesNeedingApproval.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {sitesNeedingApproval.map((s) => (
                  <Link
                    key={s.id}
                    href={`/attendance?siteId=${s.id}&start=${run.periodStart.slice(0, 10)}&end=${run.periodEnd.slice(0, 10)}`}
                    className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Approve {s.name} →
                  </Link>
                ))}
              </div>
            )}
            {blockingExceptions && blockingExceptions.groups.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-security-navy-600">
                  Here is what is blocking this run. Fix each group below, then click
                  Calculate again.
                </p>
                {blockingExceptions.groups.map((group) => {
                  const copy = attendanceExceptionCopy(group.exceptionType);
                  const isOpen = expandedExceptionType === group.exceptionType;
                  const exceptionsHref =
                    `/attendance/exceptions?status=OPEN&severity=CRITICAL` +
                    `&start=${blockingExceptions.periodStart.slice(0, 10)}` +
                    `&end=${blockingExceptions.periodEnd.slice(0, 10)}`;
                  return (
                    <div
                      key={group.exceptionType}
                      className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-security-navy-700"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-security-navy-900">{copy.title}</span>
                        <Badge variant="error">{group.count}</Badge>
                      </div>
                      <p className="mt-1 text-security-navy-500">{copy.description}</p>
                      <p className="mt-1.5 font-medium text-security-navy-700">
                        How to fix: <span className="font-normal">{copy.howToFix}</span>
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Link
                          href={exceptionsHref}
                          className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                        >
                          Review these issues →
                        </Link>
                        {group.samples.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedExceptionType(isOpen ? null : group.exceptionType)
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            {isOpen ? "Hide examples" : `Show ${group.samples.length} example(s)`}
                          </button>
                        )}
                      </div>
                      {isOpen && (
                        <ul className="mt-2 space-y-1 border-t border-red-100 pt-2">
                          {group.samples.map((sample) => (
                            <li key={sample.id} className="flex flex-wrap items-center gap-x-2">
                              <span className="font-medium text-security-navy-900">
                                {sample.employeeName ?? "Unknown employee"}
                              </span>
                              {sample.employeeNumber && (
                                <span className="text-security-navy-500">({sample.employeeNumber})</span>
                              )}
                              {sample.siteName && (
                                <span className="text-security-navy-500">· {sample.siteName}</span>
                              )}
                              {sample.date && (
                                <span className="text-security-navy-500">
                                  · {format(new Date(`${sample.date}T00:00:00`), "d MMM yyyy")}
                                </span>
                              )}
                            </li>
                          ))}
                          {group.count > group.samples.length && (
                            <li className="text-security-navy-400">
                              …and {group.count - group.samples.length} more
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </AlertBanner>
      )}

      {showItems && (
        <div className="mt-5 border-t border-security-navy-100 pt-5">
          {actionError && (
            <AlertBanner variant="error" className="mb-4">
              {actionError}
            </AlertBanner>
          )}
          {skippedEmployees.length > 0 && (
            <AlertBanner variant="warning" className="mb-4">
              <button
                type="button"
                onClick={() => setSkippedExpanded((open) => !open)}
                className="flex w-full items-center justify-between gap-3 text-left font-semibold"
                aria-expanded={skippedExpanded}
                aria-controls={`skipped-employees-${run.id}`}
              >
                <span>
                  {skippedEmployees.length} team member{skippedEmployees.length === 1 ? "" : "s"} excluded from this run
                </span>
                <svg
                  className={clsx("h-4 w-4 shrink-0 transition-transform", skippedExpanded && "rotate-180")}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {!skippedExpanded && (
                <p className="mt-1 text-xs text-security-amber-800/80">
                  Expand to see who was excluded and how to fix it.
                </p>
              )}
              {skippedExpanded && (
                <div id={`skipped-employees-${run.id}`}>
                  <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
                    {skippedEmployees.map((emp) => (
                      <li key={`${emp.employeeNumber ?? emp.name}-${emp.skipReason}`}>
                        <span className="font-medium">{emp.name}</span>
                        {emp.employeeNumber ? ` (${emp.employeeNumber})` : ""}
                        {": "}
                        {skipReasonLabel(emp.skipReason)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm">
                    Update employee profiles on the{" "}
                    <Link href="/employees" className="font-medium underline underline-offset-2">
                      Employees
                    </Link>{" "}
                    page, then recalculate.
                  </p>
                </div>
              )}
            </AlertBanner>
          )}
          {validation && validation.criticalCount > 0 && (
            <AlertBanner variant="error" className="mb-4">
              <p className="font-semibold">
                {validation.criticalCount} critical issue(s) block approval and bank export
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {validation.issues
                  .filter((issue) => issue.severity === "critical")
                  .slice(0, 8)
                  .map((issue) => (
                    <li key={`${issue.ruleId}-${issue.message}`}>{issue.message}</li>
                  ))}
              </ul>
            </AlertBanner>
          )}
          {validation?.statutoryReconciliation?.emp201Preview && (
            <AlertBanner variant="info" className="mb-4">
              EMP201 preview ({validation.statutoryReconciliation.emp201Preview.period}): PAYE{" "}
              {formatCurrency(validation.statutoryReconciliation.emp201Preview.payeLiability)}, UIF{" "}
              {formatCurrency(validation.statutoryReconciliation.emp201Preview.uifLiability)}, SDL{" "}
              {formatCurrency(validation.statutoryReconciliation.emp201Preview.sdlLiability)}
              {validation.statutoryReconciliation.matched ? " — reconciled" : " — mismatch detected"}
            </AlertBanner>
          )}
          {previewError && (
            <AlertBanner variant="error" className="mb-3">
              {previewError}
            </AlertBanner>
          )}
          {items.length > 0 ? (
            <TableShell title="Payroll run items">
              <thead className="bg-security-navy-50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-security-navy-600">Team member</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Net pay</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-security-navy-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100">
                {groupPayrollItemsByTeam(items).map((group) => {
                  const isCollapsed = collapsedGroups.has(group.key);
                  return (
                  <Fragment key={group.key}>
                    <tr className="bg-security-navy-50/80">
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.key)}
                          className="flex w-full items-center gap-2 text-left"
                          aria-expanded={!isCollapsed}
                        >
                          <svg
                            className={clsx(
                              "h-4 w-4 shrink-0 text-security-navy transition-transform",
                              !isCollapsed && "rotate-180"
                            )}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                          <span className="text-sm font-semibold text-security-navy">{group.name}</span>
                          <span className="text-xs font-normal text-security-navy-500">
                            {group.items.length} member{group.items.length === 1 ? "" : "s"}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold text-security-navy-700">
                        {formatCurrency(group.totalNetPay)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canExportFnb && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => handleDownloadFnbCsv(group.key, group.name)}
                            loading={downloadingFnbGroup === group.key}
                          >
                            FNB CSV
                          </Button>
                        )}
                      </td>
                    </tr>
                    {!isCollapsed &&
                      group.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-2.5 pl-8 text-security-navy-900">
                          {item.employee.firstName} {item.employee.lastName}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-medium">
                          {formatCurrency(parsePayAmount(item.netPay))}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => handlePreviewPayslip(item)}
                            loading={previewingId === item.id}
                          >
                            Preview payslip
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                  );
                })}
              </tbody>
            </TableShell>
          ) : (
            <p className="text-sm text-security-navy-500">No items yet. Run calculate to generate payroll lines.</p>
          )}
        </div>
      )}

      {showRevertModal && canEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-security-lg bg-white p-5 shadow-security-card">
            <h3 className="text-lg font-semibold text-security-navy-900">Revert to draft</h3>
            <p className="mt-2 text-sm text-security-navy-600">
              This clears calculated payroll items so you can fix inputs and recalculate. Paid runs cannot be reverted.
            </p>
            <label className="mt-4 block text-sm font-medium text-security-navy-700" htmlFor={`revert-reason-${run.id}`}>
              Reason for revert
            </label>
            <textarea
              id={`revert-reason-${run.id}`}
              className="mt-1 w-full rounded-md border border-security-navy-200 px-3 py-2 text-sm"
              rows={3}
              value={revertReason}
              onChange={(e) => setRevertReason(e.target.value)}
              placeholder="e.g. Correcting leave records for two guards"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setShowRevertModal(false);
                  setRevertReason("");
                }}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleRevertToDraft}
                loading={actionLoading}
              >
                Revert to draft
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
