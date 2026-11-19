"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch, getWhatsAppContacts } from "@/lib/api";
import {
  acknowledgeAlert,
  resolveAlert,
  dismissAlert,
  type AlertCounts,
  type OperationalAlert,
} from "@/lib/msr-api";
import { alertFixTarget } from "@/lib/alert-links";
import { canAccessRoute, hasCapability } from "@/lib/permissions";
import { format } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  Tooltip,
} from "recharts";
import { CHART_PRIMARY, CHART_SECONDARY, CHART_SERIES } from "@/lib/chart-theme";
import { ComplianceSummaryWidget } from "@/components/dashboard/ComplianceSummaryWidget";
import { useOperationalEvents } from "@/lib/use-operational-events";

interface Site {
  id: string;
  name: string;
}

interface DashboardData {
  guardsOnDuty: number;
  guardsOnDutyByDay?: { name: string; value: number }[];
  activeSitesCount: number;
  activeSitesDelta?: number;
  exportBatchByStatus?: Record<string, number>;
  alerts: { type: string; message: string; count?: number; priority?: string; id?: string }[];
  alertCounts?: AlertCounts;
  operationalAlerts?: OperationalAlert[];
  exportReadiness?: {
    status: string;
    openExceptions: number;
    openCritical?: number;
    periodKey?: string;
    periodStart?: string;
    periodEnd?: string;
    latestBatch?: {
      id: string;
      status: string;
      periodKey: string;
      exportedAt?: string | null;
    } | null;
  } | null;
  pendingApprovalsInbox?: number;
  pendingSiteTimesheetRows?: number;
  openCriticalIncidents?: number;
  shiftsOverTime?: { name: string; value: number }[];
  rosteredGuardsOverTime?: { name: string; value: number }[];
  employeesByStatus?: { name: string; value: number }[];
  shiftsByStatus?: { name: string; value: number }[];
  /** True when the alert list was capped server-side and more remain. */
  operationalAlertsTruncated?: boolean;
}

const defaultGuardsByDay = [
  { name: "Mon", value: 0 },
  { name: "Tue", value: 0 },
  { name: "Wed", value: 0 },
  { name: "Thu", value: 0 },
  { name: "Fri", value: 0 },
  { name: "Sat", value: 0 },
  { name: "Sun", value: 0 },
];

const defaultRosteredData = [{ name: "No rostered shifts", value: 0 }];

const defaultStatusData = [{ name: "No employees", value: 1 }];

const PIE_COLORS = CHART_SERIES;

const DATE_RANGES = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

const PRIORITY_TABS = [
  { value: "CRITICAL", label: "Critical" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
  { value: "all", label: "All" },
] as const;

type PriorityTab = (typeof PRIORITY_TABS)[number]["value"];

// Alert -> "where do I fix this" lives in lib/alert-links.ts so the notification
// links built server-side stay in step with the panel.

export default function DashboardPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<string>("month");
  const [siteFilterOpen, setSiteFilterOpen] = useState(false);
  const [whatsappContacts, setWhatsappContacts] = useState<{ id: string; firstName: string; lastName: string; phone: string | null; whatsappUrl: string | null }[]>([]);
  const [priorityTab, setPriorityTab] = useState<PriorityTab>("all");
  const [alertActionId, setAlertActionId] = useState<string | null>(null);
  const [alertsSectionOpen, setAlertsSectionOpen] = useState(true);
  const [liveEscalation, setLiveEscalation] = useState<{
    guardName?: string;
    guardPhone?: string;
    siteName?: string;
    reason?: string;
    refCode?: string;
    timestamp?: string;
  } | null>(null);
  const [liveIncidentNotice, setLiveIncidentNotice] = useState<string | null>(null);

  const canSites = user ? canAccessRoute("/sites", user) : false;
  const canCreateSites = Boolean(user && hasCapability(user, "/sites", "create"));
  const canWhatsApp = user ? canAccessRoute("/whatsapp", user) : false;
  const canPayrollExport = user ? canAccessRoute("/payroll-exports", user) : false;
  const canRostering = user ? canAccessRoute("/rostering", user) : false;
  const canEmployees = user ? canAccessRoute("/employees", user) : false;
  const canAttendance = user ? canAccessRoute("/attendance", user) : false;
  const canEditAlerts = Boolean(
    user &&
      ["/attendance", "/sites", "/payroll-exports"].some((path) =>
        hasCapability(user, path, "edit")
      )
  );

  // Returns an abort handle so callers can cancel a request that a newer
  // filter selection has superseded — otherwise a slow earlier response can
  // land last and overwrite fresher data.
  const fetchDashboard = useCallback(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (dateRange) params.set("dateRange", dateRange);
    if (selectedSiteIds.length) params.set("siteIds", selectedSiteIds.join(","));
    authFetch(`/dashboard?${params.toString()}`, token, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(
            (body as { message?: string; error?: string }).message ||
              (body as { error?: string }).error ||
              "Unable to load dashboard"
          );
        }
        return r.json();
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => {
        // A cancelled request is not a failure — a newer one is already in flight.
        if (controller.signal.aborted || (err as Error)?.name === "AbortError") return;
        console.error(err);
        setError((err as Error)?.message || "Unable to load dashboard");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return controller;
  }, [token, dateRange, selectedSiteIds]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const controller = fetchDashboard();
    return () => controller?.abort();
  }, [token, fetchDashboard]);

  useEffect(() => {
    if (!token) return;
    let inFlight: AbortController | undefined;
    const interval = setInterval(() => {
      inFlight = fetchDashboard();
    }, 60_000);
    return () => {
      clearInterval(interval);
      inFlight?.abort();
    };
  }, [token, fetchDashboard]);

  useOperationalEvents({
    token,
    onIncidentCreated: (event) => {
      const p = event.payload as { incidentNumber?: string; siteName?: string; severity?: string };
      if (p.severity === "CRITICAL" || p.severity === "HIGH") {
        setLiveIncidentNotice(`🚨 Urgent Incident Logged: ${p.incidentNumber || ""} at ${p.siteName || "Site"}`);
      }
      fetchDashboard();
    },
    onSupervisorEscalation: (event) => {
      const p = event.payload as {
        guardName?: string;
        guardPhone?: string;
        siteName?: string;
        reason?: string;
        refCode?: string;
        timestamp?: string;
      };
      setLiveEscalation(p);
      fetchDashboard();
    },
    onAttendanceVerified: () => {
      fetchDashboard();
    },
    onRollCallDispatched: () => {
      fetchDashboard();
    },
  });

  useEffect(() => {
    if (!token || !canSites) return;
    authFetch("/sites?limit=100", token)
      .then((r) => r.json())
      .then((d) => setSites(d.data ?? []))
      .catch(() => setSites([]));
  }, [token, canSites]);

  useEffect(() => {
    if (!token || !canWhatsApp) return;
    getWhatsAppContacts(token, { limit: 10 })
      .then((r) => setWhatsappContacts(r.data))
      .catch(() => setWhatsappContacts([]));
  }, [token, canWhatsApp]);

  const toggleSite = (id: string) => {
    setSelectedSiteIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const clearSiteFilter = () => {
    setSelectedSiteIds([]);
    setSiteFilterOpen(false);
  };

  const siteFilterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (siteFilterRef.current && !siteFilterRef.current.contains(e.target as Node)) {
        setSiteFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (loading) {
    return (
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] animate-pulse flex-col">
        <div className="flex shrink-0 flex-col gap-3 border-b border-security-navy-100/80 pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="h-3 w-32 rounded-full bg-security-navy-200/80" />
            <div className="h-8 w-44 rounded-security-lg bg-security-navy-100" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-36 rounded-security-lg bg-security-navy-100" />
            <div className="h-9 w-48 rounded-full bg-security-navy-100" />
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 py-2 sm:grid-cols-3 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={`kpi-${i}`} className="h-[4.25rem] rounded-security-lg border border-security-navy-100/80 bg-white shadow-security-card" />
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4 xl:grid-rows-2 xl:gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="min-h-0 rounded-security-lg border border-security-navy-100/80 bg-white shadow-security-card" />
          ))}
        </div>
      </div>
    );
  }

  const guardsByDay = data?.guardsOnDutyByDay ?? defaultGuardsByDay;
  const employeesTotal = (data?.employeesByStatus ?? []).reduce((s, e) => s + e.value, 0) || 0;
  const shiftsOverTimeData = data?.shiftsOverTime ?? [];
  const rosteredGuardsData = data?.rosteredGuardsOverTime?.length
    ? data.rosteredGuardsOverTime
    : defaultRosteredData;
  const alertsList = data?.alerts ?? [];
  const alertCounts = data?.alertCounts;
  const operationalAlerts = data?.operationalAlerts ?? [];
  // `alerts` now carries only derived alerts; persisted ones are counted once
  // via alertCounts.allOpen. Summing both used to triple-count them.
  const derivedAlertTally = alertsList.reduce(
    (sum, a) => sum + (typeof a.count === "number" ? a.count : 1),
    0
  );
  const needsAttentionCount = derivedAlertTally + (alertCounts?.allOpen ?? 0);
  const openExportExceptions = data?.exportReadiness?.openExceptions ?? 0;
  const siteFilterActive = selectedSiteIds.length > 0;
  const companyWideHint = siteFilterActive ? " · company-wide" : "";
  const filteredOperationalAlerts =
    priorityTab === "all"
      ? operationalAlerts
      : operationalAlerts.filter((a) => a.priority === priorityTab);

  const handleAlertAction = async (id: string, action: "acknowledge" | "resolve" | "dismiss") => {
    if (!token || !canEditAlerts) return;
    setAlertActionId(id);
    try {
      if (action === "acknowledge") await acknowledgeAlert(token, id);
      else if (action === "resolve") await resolveAlert(token, id);
      else await dismissAlert(token, id);
      fetchDashboard();
    } catch (err) {
      console.error(err);
    } finally {
      setAlertActionId(null);
    }
  };

  const exportReadinessLabel = (() => {
    const er = data?.exportReadiness;
    if (!er?.status) return null;
    if (er.status === "READY") return { text: "Export ready (26th–25th)", variant: "success" as const };
    return { text: "Attendance review needed", variant: "warning" as const };
  })();

  const DashboardCard = ({ title, children, className = "", action }: { title: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) => (
    <article className={`card-dashboard flex h-full min-h-0 flex-col overflow-hidden p-3 lg:p-3.5 ${className}`}>
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <h2 className="section-title truncate">{title}</h2>
        {action}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </article>
  );

  const KpiTile = ({
    label,
    value,
    hint,
    accent,
    href,
    onClick,
  }: {
    label: string;
    value: string | number;
    hint?: string;
    accent?: "default" | "alert";
    href?: string;
    onClick?: () => void;
  }) => {
    const baseClasses = `card-dashboard spine group relative min-w-0 py-2.5 pl-4 pr-3 text-left transition-all lg:py-2 ${
      accent === "alert" && Number(value) > 0 ? "spine-live" : "spine-idle before:bg-transparent"
    }`;
    const interactiveClasses =
      "hover:-translate-y-0.5 hover:border-security-navy-300 hover:shadow-security-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-security-amber-500";

    const content = (
      <>
        <div className="flex items-center justify-between gap-1">
          <p className="truncate font-mono text-[0.625rem] font-medium uppercase tracking-[0.12em] text-security-navy-500">
            {label}
          </p>
          {(href || onClick) && (
            <span
              className="text-xs font-semibold text-security-navy-400 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:text-security-navy-800 group-hover:opacity-100"
              aria-hidden="true"
            >
              →
            </span>
          )}
        </div>
        <p className="mt-1 font-display text-xl font-semibold tabular-nums tracking-[-0.02em] text-security-navy-900 lg:text-lg">
          {value}
        </p>
        {hint ? <p className="mt-0.5 truncate text-[10px] text-security-navy-500">{hint}</p> : null}
      </>
    );

    if (href) {
      return (
        <Link href={href} className={`${baseClasses} ${interactiveClasses} no-underline`}>
          {content}
        </Link>
      );
    }
    if (onClick) {
      return (
        <button type="button" onClick={onClick} className={`${baseClasses} ${interactiveClasses} w-full`}>
          {content}
        </button>
      );
    }
    return <div className={baseClasses}>{content}</div>;
  };

  const ChartWrap = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <div className={`relative min-h-[5rem] w-full flex-1 ${className}`}>{children}</div>
  );

  return (
    <div className="animate-fade-in mx-auto flex min-h-0 w-full min-w-0 max-w-[1600px] flex-col pb-6">
      <header className="flex shrink-0 flex-col gap-3 border-b border-security-navy-100/80 pb-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:pb-2.5">
        <div className="min-w-0 shrink-0 lg:flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1 rounded border border-security-navy-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-security-navy-700 shadow-sm transition hover:border-security-amber-400 hover:bg-security-amber-50/40 hover:text-security-navy-900"
            >
              <span aria-hidden="true">←</span>
              <span>Command Center</span>
            </Link>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-security-navy-700 lg:text-xs">
              {format(new Date(), "EEEE, MMMM d, yyyy")}
            </p>
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-security-navy-900 lg:text-2xl">
            Operations Overview &amp; Analytics
          </h1>
          <p className="mt-1 hidden text-sm text-security-navy-600 max-lg:block">
            Live snapshot of guards, sites, shifts, and compliance alerts.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={() => fetchDashboard()}
            className="inline-flex items-center justify-center gap-1.5 rounded-security-lg border border-security-navy-100 bg-white px-3 py-2 text-xs font-semibold text-security-navy-800 shadow-security-card transition hover:border-security-navy-300 hover:bg-security-navy-50"
            title="Refresh dashboard metrics"
          >
            <svg className="h-3.5 w-3.5 text-security-navy-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Refresh</span>
          </button>
          {canSites && (
            <div className="relative w-full min-w-0 sm:w-auto" ref={siteFilterRef}>
              <button
                type="button"
                onClick={() => setSiteFilterOpen((o) => !o)}
                className="flex w-full min-w-0 items-center gap-2 rounded-security-lg border border-security-navy-100 bg-white px-3 py-2 text-left text-sm font-medium text-security-navy-900 shadow-security-card transition-all hover:border-security-navy-300 hover:shadow-md sm:min-w-[200px] sm:w-auto"
              >
                <span className="truncate">
                  {selectedSiteIds.length === 0
                    ? "All sites"
                    : selectedSiteIds.length === 1
                      ? sites.find((s) => s.id === selectedSiteIds[0])?.name ?? "1 site"
                      : `${selectedSiteIds.length} sites`}
                </span>
                <svg className="w-4 h-4 shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {siteFilterOpen && (
                <div className="absolute top-full left-0 mt-2 z-20 w-72 max-h-64 overflow-auto rounded-security-lg border border-security-navy-100/80 bg-white shadow-security-elevated py-1.5">
                  {selectedSiteIds.length > 0 && (
                    <button
                      type="button"
                      onClick={clearSiteFilter}
                      className="w-full px-4 py-2.5 text-left text-sm text-security-navy-800 hover:bg-security-navy-50 font-semibold"
                    >
                      Clear filter
                    </button>
                  )}
                  {sites.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleSite(s.id)}
                      className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-2 rounded-lg mx-1 w-[calc(100%-0.5rem)] ${selectedSiteIds.includes(s.id) ? "bg-security-navy-50 text-security-navy-900 font-semibold" : "hover:bg-security-navy-50 text-security-navy-700"}`}
                    >
                      {selectedSiteIds.includes(s.id) && <span className="text-security-navy-700">✓</span>}
                      {s.name}
                    </button>
                  ))}
                  {sites.length === 0 && (
                    <p className="px-4 py-3 text-sm text-security-navy-600">No sites</p>
                  )}
                </div>
              )}
            </div>
          )}
          <div
            className="flex w-full min-w-0 rounded-full border border-security-navy-100/90 bg-security-navy-50/80 p-1 shadow-inner sm:inline-flex sm:w-auto"
            role="group"
            aria-label="Date range"
          >
            {DATE_RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setDateRange(r.value)}
                className={`min-w-0 flex-1 px-3 py-1.5 text-sm font-semibold rounded-full transition-all sm:flex-none sm:px-4 ${dateRange === r.value ? "bg-security-navy-700 text-white shadow-md" : "text-security-navy-700 hover:text-security-navy-900 hover:bg-white/80"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {liveEscalation && (
        <div
          role="alert"
          className="mb-3 mt-3 flex flex-col gap-2 rounded-security-lg border-2 border-red-500 bg-red-50 p-3 shadow-md sm:flex-row sm:items-center sm:justify-between animate-fade-in"
        >
          <div className="flex items-start gap-2.5">
            <span className="flex h-3 w-3 relative mt-1">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600" />
            </span>
            <div>
              <p className="font-bold text-red-900 text-sm">
                🚨 Supervisor Escalation Dispatched: {liveEscalation.guardName} ({liveEscalation.guardPhone || "Guard"})
              </p>
              <p className="text-xs text-red-800">
                Site: <span className="font-semibold">{liveEscalation.siteName || "Field Post"}</span> · Ref:{" "}
                <span className="font-mono font-bold">{liveEscalation.refCode || "SUP"}</span> · Context:{" "}
                {liveEscalation.reason || "Urgent assistance requested"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/incidents" className="btn-primary text-xs py-1 px-3 bg-red-700 hover:bg-red-800">
              View Control Feed
            </Link>
            <button
              type="button"
              onClick={() => setLiveEscalation(null)}
              className="text-xs font-semibold text-red-700 hover:text-red-900 px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {liveIncidentNotice && (
        <div
          role="status"
          className="mb-2 mt-2 flex items-center justify-between gap-3 rounded-security-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-sm animate-fade-in"
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-600 animate-ping" />
            <p className="font-medium">{liveIncidentNotice}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/incidents" className="text-xs font-semibold text-amber-800 hover:text-amber-950 underline">
              View Log
            </Link>
            <button
              type="button"
              onClick={() => setLiveIncidentNotice(null)}
              className="text-xs font-semibold text-amber-700 hover:text-amber-900"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-2 mt-2 flex shrink-0 flex-col gap-2 rounded-security-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-semibold text-red-900">Couldn&apos;t load the dashboard</p>
            <p className="truncate text-xs text-red-800">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchDashboard();
            }}
            className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {error && !data ? null : (
      <>
      <section className="grid shrink-0 grid-cols-2 gap-2 py-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-2.5 lg:py-2.5" aria-label="Key metrics">
        <KpiTile
          label="Total employees"
          value={employeesTotal}
          hint={`All statuses${companyWideHint}`}
          href={canEmployees ? "/employees" : undefined}
        />
        <KpiTile
          label="Guards on duty"
          value={data?.guardsOnDuty ?? 0}
          hint="Right now"
          href={canAttendance ? "/attendance" : undefined}
        />
        <KpiTile
          label="Active sites"
          value={data?.activeSitesCount ?? 0}
          hint="Operational"
          href={canSites ? "/sites" : undefined}
        />
        <KpiTile
          label="Export blockers"
          value={openExportExceptions}
          hint={
            data?.exportReadiness?.latestBatch
              ? `Batch: ${data.exportReadiness.latestBatch.status}${companyWideHint}`
              : `26th–25th Sage cycle${companyWideHint}`
          }
          accent={openExportExceptions > 0 ? "alert" : "default"}
          href={
            openExportExceptions > 0
              ? "/attendance/exceptions"
              : canPayrollExport
                ? "/payroll-exports"
                : undefined
          }
        />
        <KpiTile
          label="Needs attention"
          value={needsAttentionCount}
          hint="Open operational alerts"
          accent={needsAttentionCount > 0 ? "alert" : "default"}
          onClick={() => {
            setAlertsSectionOpen(true);
            setTimeout(() => {
              document
                .getElementById("dashboard-operational-alerts")
                ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }, 50);
          }}
        />
      </section>

      {exportReadinessLabel && (
        <div className="mb-2 shrink-0">
          <Link
            href={canPayrollExport ? "/payroll-exports" : "/attendance/exceptions"}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              exportReadinessLabel.variant === "success"
                ? "bg-security-emerald-100 text-security-emerald-700"
                : "bg-security-amber-100 text-security-amber-800"
            }`}
          >
            {exportReadinessLabel.text}
            {typeof data?.exportReadiness?.openExceptions === "number" && data.exportReadiness.openExceptions > 0
              ? ` · ${data.exportReadiness.openExceptions} open exception${data.exportReadiness.openExceptions === 1 ? "" : "s"}`
              : ""}
          </Link>
        </div>
      )}

      <div className="mb-3 shrink-0">
        <ComplianceSummaryWidget />
      </div>

      <section className="mb-2 grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Action items">
        {(data?.pendingApprovalsInbox ?? 0) > 0 && (
          <Link
            href="/approvals"
            className="flex items-center justify-between rounded-security-lg border border-security-amber-200 bg-security-amber-50 px-3 py-2 text-sm hover:bg-security-amber-100"
          >
            <span className="font-medium text-security-navy-900">Pending approvals</span>
            <span className="font-bold tabular-nums text-security-amber-800">{data?.pendingApprovalsInbox}</span>
          </Link>
        )}
        {(data?.openCriticalIncidents ?? 0) > 0 && (
          <Link
            href="/incidents?severity=CRITICAL"
            className="flex items-center justify-between rounded-security-lg border border-red-200 bg-red-50 px-3 py-2 text-sm hover:bg-red-100"
          >
            <span className="font-medium text-security-navy-900">Critical incidents</span>
            <span className="font-bold tabular-nums text-red-800">{data?.openCriticalIncidents}</span>
          </Link>
        )}
      </section>

      {(operationalAlerts.length > 0 || alertCounts) && (
        <section className="mb-2 shrink-0 rounded-security-lg border border-security-navy-100 bg-white px-3 py-3 shadow-security-card" aria-label="Operational alerts">
          <button
            type="button"
            onClick={() => setAlertsSectionOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={alertsSectionOpen}
            aria-controls="dashboard-operational-alerts"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-security-navy-900">Operational alerts</h2>
              {!alertsSectionOpen && (
                <span className="text-xs text-security-navy-600">
                  {alertCounts?.allOpen ?? operationalAlerts.length} open
                </span>
              )}
            </div>
            <svg
              className={`h-4 w-4 shrink-0 text-security-navy-600 transition-transform ${alertsSectionOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {alertsSectionOpen && (
            <div id="dashboard-operational-alerts" className="mt-2">
              <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Alert priority">
                {PRIORITY_TABS.map((tab) => {
                  const count =
                    tab.value === "all"
                      ? alertCounts?.allOpen ?? operationalAlerts.length
                      : alertCounts?.[tab.value.toLowerCase() as keyof AlertCounts] ?? 0;
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setPriorityTab(tab.value)}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                        priorityTab === tab.value
                          ? "bg-security-navy-700 text-white"
                          : "bg-security-navy-50 text-security-navy-700 hover:bg-security-navy-100"
                      }`}
                    >
                      {tab.label} ({count})
                    </button>
                  );
                })}
              </div>
              <ul className="max-h-72 space-y-2 overflow-y-auto overscroll-y-contain pr-1">
                {filteredOperationalAlerts.map((alert) => {
                  const fixTarget = alertFixTarget(alert);
                  const isCritical = alert.priority === "CRITICAL";
                  return (
                    <li
                      key={alert.id}
                      className={`flex flex-col gap-2 rounded-security border px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${
                        isCritical ? "border-red-200 bg-red-50/60" : "border-security-navy-100 bg-security-navy-50/80"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-security-navy-900">{alert.title}</p>
                        <p className="truncate text-xs text-security-navy-600">{alert.message}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {/* Primary action is fixing the underlying problem — marking an
                            alert resolved without fixing it just lets it reappear. */}
                        {fixTarget && (
                          <Link href={fixTarget.href} className="btn-primary px-2 py-1 text-xs">
                            {fixTarget.label}
                          </Link>
                        )}
                        {canEditAlerts && alert.status === "OPEN" && (
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            disabled={alertActionId === alert.id}
                            onClick={() => handleAlertAction(alert.id, "acknowledge")}
                          >
                            Acknowledge
                          </button>
                        )}
                        {canEditAlerts && <button
                          type="button"
                          className={`px-2 py-1 text-xs ${fixTarget ? "btn-secondary" : "btn-primary"}`}
                          disabled={alertActionId === alert.id}
                          onClick={() => handleAlertAction(alert.id, "resolve")}
                        >
                          Resolve
                        </button>}
                        {canEditAlerts && <button
                          type="button"
                          className="btn-secondary px-2 py-1 text-xs"
                          disabled={alertActionId === alert.id}
                          onClick={() => handleAlertAction(alert.id, "dismiss")}
                        >
                          Dismiss
                        </button>}
                      </div>
                    </li>
                  );
                })}
                {filteredOperationalAlerts.length === 0 && (
                  <li className="py-2 text-sm text-security-navy-600">No alerts at this priority level.</li>
                )}
              </ul>
              {data?.operationalAlertsTruncated && (
                <p className="mt-2 text-xs text-security-navy-600">
                  Showing the {operationalAlerts.length} most recent of{" "}
                  {alertCounts?.allOpen ?? operationalAlerts.length} open alerts — resolve
                  some, or narrow by site, to see the rest.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {alertsList.length > 0 && (
        <section
          className="mb-2 shrink-0 rounded-security-lg border border-security-amber-200 bg-security-amber-50/70 px-3 py-2"
          aria-label="Items needing attention"
        >
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-security-navy-900 lg:text-sm">
            {alertsList.slice(0, 4).map((alert, i) => (
              <li key={`${alert.type}-${i}`} className="flex min-w-0 items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-security-amber-500" aria-hidden />
                <span className="truncate">
                  {alert.message}
                  {typeof alert.count === "number" ? ` (${alert.count})` : ""}
                </span>
              </li>
            ))}
            {alertsList.length > 4 && (
              <li className="text-security-navy-600">+{alertsList.length - 4} more</li>
            )}
          </ul>
        </section>
      )}

      <section
        className="grid min-h-[28rem] shrink-0 grid-cols-1 gap-2.5 max-lg:auto-rows-auto md:grid-cols-2 md:gap-3 lg:min-h-[32rem] xl:grid-cols-4 xl:grid-rows-2 xl:gap-3"
        aria-label="Dashboard widgets"
      >
        <DashboardCard title="Guards on duty — this week">
          <ChartWrap>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={guardsByDay} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, "auto"]} tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontSize: "12px", borderRadius: "8px", borderColor: "#e2e8f0" }}
                formatter={(val: unknown) => [String(val ?? 0), "Guards"]}
              />
              <Bar dataKey="value" fill={CHART_PRIMARY} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </ChartWrap>
        </DashboardCard>

        <DashboardCard
          title="Active sites"
          action={
            canSites ? (
              <Link href="/sites" className="text-xs font-semibold text-security-navy-800 hover:text-security-navy-900">
                View sites →
              </Link>
            ) : undefined
          }
        >
          <div className="flex flex-1 flex-col justify-between gap-2">
            <div>
              <p className="text-3xl font-bold tabular-nums tracking-tight text-security-navy-900 lg:text-2xl">{data?.activeSitesCount ?? 0}</p>
              <p className="mt-0.5 text-xs text-security-navy-600 lg:text-sm">Sites active</p>
              {typeof data?.activeSitesDelta === "number" && (
                <p className="mt-1 text-xs text-security-navy-600">
                  <span className={`font-semibold ${data.activeSitesDelta >= 0 ? "text-security-navy-800" : "text-red-700"}`}>
                    {data.activeSitesDelta >= 0 ? "+" : ""}{data.activeSitesDelta}
                  </span>
                  {" "}added this month
                </p>
              )}
            </div>
            {canCreateSites && (
              <Link href="/sites" className="btn-primary inline-flex w-full items-center justify-center gap-1 py-2 text-xs lg:text-sm">
                Add site
                <span className="text-base leading-none" aria-hidden>+</span>
              </Link>
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="Active guards rostered">
          <div className="flex flex-1 flex-col">
          <ChartWrap>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rosteredGuardsData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_PRIMARY} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={CHART_PRIMARY} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ fontSize: "12px", borderRadius: "8px", borderColor: "#e2e8f0" }}
                    formatter={(val: unknown) => [String(val ?? 0), "Rostered guards"]}
                  />
                  <Area type="monotone" dataKey="value" stroke={CHART_PRIMARY} strokeWidth={2} fill="url(#areaFill)" />
                </AreaChart>
              </ResponsiveContainer>
          </ChartWrap>
            {canRostering && (
              <Link href="/rostering" className="btn-secondary mt-1.5 w-full shrink-0 py-1.5 text-center text-xs lg:text-sm">
                View schedule
              </Link>
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="Team by status">
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <ChartWrap>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    contentStyle={{ fontSize: "12px", borderRadius: "8px", borderColor: "#e2e8f0" }}
                  />
                  <Pie
                    data={(() => {
                      const raw = data?.employeesByStatus ?? [];
                      return raw.some((d) => d.value > 0) ? raw : defaultStatusData;
                    })()}
                    cx="50%"
                    cy="50%"
                    innerRadius="55%"
                    outerRadius="78%"
                    fill="#8884d8"
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {(() => {
                      const raw = data?.employeesByStatus ?? [];
                      const chartData = raw.some((d) => d.value > 0) ? raw : defaultStatusData;
                      return chartData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ));
                    })()}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-security-navy-900">{employeesTotal || 0}</span>
              </div>
            </ChartWrap>
            <div className="grid shrink-0 grid-cols-2 gap-x-2 gap-y-1 border-t border-security-navy-100 pt-1.5 text-[10px] lg:text-xs">
              {(() => {
                const raw = data?.employeesByStatus ?? [];
                const chartData = raw.some((d) => d.value > 0) ? raw : defaultStatusData;
                return chartData.map((item, index) => (
                  <div key={item.name} className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                    />
                    <span className="truncate text-security-navy-600">{item.name}</span>
                    <span className="ml-auto shrink-0 font-medium tabular-nums text-security-navy-900">{item.value}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </DashboardCard>

        <DashboardCard title="Shifts over time">
          <ChartWrap>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={shiftsOverTimeData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontSize: "12px", borderRadius: "8px", borderColor: "#e2e8f0" }}
                formatter={(val: unknown) => [String(val ?? 0), "Shifts"]}
              />
              <Bar dataKey="value" fill={CHART_SECONDARY} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </ChartWrap>
        </DashboardCard>

        <DashboardCard
          title="Payroll export readiness (26th–25th)"
          action={
            canPayrollExport ? (
              <Link href="/payroll-exports" className="text-xs font-semibold text-security-navy-800 hover:text-security-navy-900">
                Open →
              </Link>
            ) : undefined
          }
        >
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <Link
              href="/attendance/exceptions"
              className="flex shrink-0 items-center justify-between rounded-security border border-security-navy-100 bg-security-navy-50 px-3 py-1.5 transition-colors hover:bg-white lg:py-2"
            >
              <span className="text-xs font-medium text-security-navy-900 lg:text-sm">Open exceptions</span>
              <span className="text-base font-bold tabular-nums text-security-navy-900">
                {data?.exportReadiness?.openExceptions ?? 0}
              </span>
            </Link>
            <Link
              href="/attendance"
              className="flex shrink-0 items-center justify-between rounded-security border border-security-navy-100 bg-security-navy-50 px-3 py-1.5 transition-colors hover:bg-white lg:py-2"
            >
              <span className="text-xs font-medium text-security-navy-900 lg:text-sm">Pending timesheet rows</span>
              <span className="text-base font-bold tabular-nums text-security-navy-900">
                {data?.pendingSiteTimesheetRows ?? 0}
              </span>
            </Link>
            <div className="flex shrink-0 items-center justify-between rounded-security border border-security-navy-100 bg-security-navy-50/60 px-3 py-1.5 lg:py-2">
              <span className="text-xs font-medium text-security-navy-900 lg:text-sm">Latest cycle batch</span>
              <span className="text-xs font-bold uppercase tracking-wider text-security-navy-900">
                {data?.exportReadiness?.latestBatch?.status ?? "NOT CREATED"}
              </span>
            </div>
            {canPayrollExport && (
              <Link href="/payroll-exports" className="btn-primary mt-auto w-full shrink-0 py-1.5 text-center text-xs lg:text-sm">
                Prepare Sage export
              </Link>
            )}
          </div>
        </DashboardCard>

        {canWhatsApp ? (
          <DashboardCard
            title="WhatsApp"
            action={
              whatsappContacts.length > 0 ? (
                <Link href="/whatsapp" className="text-xs font-semibold text-security-navy-800 hover:text-security-navy-900">
                  View all ({whatsappContacts.length}) →
                </Link>
              ) : undefined
            }
          >
            <p className="mb-1.5 shrink-0 text-[10px] text-security-navy-600 lg:text-xs">Message team directly</p>
            <div className="min-h-0 flex-1 overflow-hidden">
              {whatsappContacts.length > 0 ? (
                whatsappContacts.slice(0, 2).map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => router.push(`/whatsapp?contact=${contact.id}`)}
                    className="flex w-full items-center gap-2 rounded-security border border-transparent px-1 py-1 text-left transition-colors hover:bg-security-navy-50 lg:gap-2.5 lg:py-1.5"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-security-navy-100 text-[10px] font-semibold text-security-navy-900 lg:h-8 lg:w-8">
                      {contact.firstName?.charAt(0)}
                      {contact.lastName?.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-security-navy-900">
                        {contact.firstName} {contact.lastName}
                      </span>
                      <span className="block truncate text-[10px] text-security-navy-500">
                        {contact.phone
                          ? (() => {
                              const digits = contact.phone!.replace(/\D/g, "");
                              const national = digits.startsWith("27") ? "0" + digits.slice(2) : digits;
                              return national;
                            })()
                          : "No phone"}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <p className="py-3 text-center text-xs text-security-navy-500">No contacts yet</p>
              )}
            </div>
            <Link href="/whatsapp" className="btn-primary mt-auto flex w-full shrink-0 items-center justify-center gap-1.5 py-1.5 text-xs lg:text-sm">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Open WhatsApp
            </Link>
          </DashboardCard>
        ) : (
          <DashboardCard title="WhatsApp">
            <p className="rounded-security border border-dashed border-security-navy-100 bg-security-navy-50 py-6 text-center text-xs text-security-navy-600 lg:text-sm">
              No WhatsApp access
            </p>
          </DashboardCard>
        )}
      </section>
      </>
      )}
    </div>
  );
}
