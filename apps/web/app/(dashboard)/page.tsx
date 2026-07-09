"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch, getWhatsAppContacts, sendWhatsAppMessage } from "@/lib/api";
import { canAccessRoute } from "@/lib/permissions";
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
} from "recharts";

interface Site {
  id: string;
  name: string;
}

interface TopTask {
  id: string;
  title: string;
  dueDate: string | null;
  priority: string;
}

interface DashboardData {
  guardsOnDuty: number;
  guardsOnDutyByDay?: { name: string; value: number }[];
  activeSitesCount: number;
  activeSitesDelta?: number;
  payrollStatus: Record<string, number>;
  alerts: { type: string; message: string; count?: number }[];
  taskStats?: { overdue: number; dueToday: number };
  topPriorityTasks?: TopTask[];
  shiftsOverTime?: { name: string; value: number }[];
  employeesByStatus?: { name: string; value: number }[];
  shiftsByStatus?: { name: string; value: number }[];
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

const defaultRosteredData = [{ name: "No rostered shifts", value: 1 }];

const defaultStatusData = [{ name: "No attendance records", value: 1 }];

const defaultShiftData = [
  { name: "Dec", value: 0 },
  { name: "Jan", value: 0 },
  { name: "Feb", value: 0 },
  { name: "Mar", value: 0 },
];

const PIE_COLORS = ["#FF9800", "#FFB74D", "#FFCC80", "#F57C00", "#FFA726"];

const DATE_RANGES = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

export default function DashboardPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<string>("month");
  const [siteFilterOpen, setSiteFilterOpen] = useState(false);
  const [whatsappContacts, setWhatsappContacts] = useState<{ id: string; firstName: string; lastName: string; phone: string | null; whatsappUrl: string | null }[]>([]);

  const canSites = user ? canAccessRoute("/sites", user.role, user.moduleAccess) : false;
  const canWhatsApp = user ? canAccessRoute("/whatsapp", user.role, user.moduleAccess) : false;
  const canPayroll = user ? canAccessRoute("/payroll", user.role, user.moduleAccess) : false;
  const canRostering = user ? canAccessRoute("/rostering", user.role, user.moduleAccess) : false;

  const fetchDashboard = useCallback(() => {
    if (!token) return;
    const params = new URLSearchParams();
    if (dateRange) params.set("dateRange", dateRange);
    if (selectedSiteIds.length) params.set("siteIds", selectedSiteIds.join(","));
    authFetch(`/dashboard?${params.toString()}`, token)
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
      .then(setData)
      .catch((err) => {
        console.error(err);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [token, dateRange, selectedSiteIds]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetchDashboard();
  }, [token, fetchDashboard]);

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

  const handleSendWhatsApp = async (employeeId: string, message: string) => {
    if (!token) return { success: false, error: "Not authenticated" };
    return sendWhatsAppMessage(token, employeeId, message);
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
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] animate-pulse flex-col overflow-hidden">
        <div className="flex shrink-0 flex-col gap-3 border-b border-neutral-200/80 pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="h-3 w-32 rounded-full bg-security-navy-200/80" />
            <div className="h-8 w-44 rounded-xl bg-neutral-200" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-36 rounded-xl bg-neutral-200" />
            <div className="h-9 w-48 rounded-full bg-neutral-200" />
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 py-2 sm:grid-cols-3 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={`kpi-${i}`} className="h-[4.25rem] rounded-security-lg border border-neutral-200/80 bg-white shadow-sm" />
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-4 xl:grid-rows-2 xl:gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="min-h-0 rounded-security-lg border border-neutral-200/80 bg-white shadow-sm" />
          ))}
        </div>
      </div>
    );
  }

  const guardsByDay = data?.guardsOnDutyByDay ?? defaultGuardsByDay;
  const employeesTotal = (data?.employeesByStatus ?? []).reduce((s, e) => s + e.value, 0) || 0;
  const shiftsOverTimeData = data?.shiftsOverTime?.length ? data.shiftsOverTime : defaultShiftData;
  const taskUrgentCount = (data?.taskStats?.overdue ?? 0) + (data?.taskStats?.dueToday ?? 0);
  const alertTally = (data?.alerts ?? []).reduce((sum, a) => sum + (typeof a.count === "number" ? a.count : 1), 0);
  const pendingPayrollCount = (data?.payrollStatus?.draft ?? 0) + (data?.payrollStatus?.calculated ?? 0);
  const alertsList = data?.alerts ?? [];

  const DashboardCard = ({ title, children, className = "", action }: { title: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) => (
    <article className={`card-dashboard flex h-full min-h-0 flex-col overflow-hidden p-3 lg:p-3.5 ${className}`}>
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-800">{title}</h2>
        {action}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </article>
  );

  const KpiTile = ({ label, value, hint, accent }: { label: string; value: string | number; hint?: string; accent?: "default" | "alert" }) => (
    <div className={`card-dashboard min-w-0 px-3 py-2.5 lg:py-2 ${accent === "alert" && Number(value) > 0 ? "border-security-navy-200 bg-security-navy-50/40" : ""}`}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums tracking-tight text-neutral-900 lg:text-lg">{value}</p>
      {hint ? <p className="mt-0.5 truncate text-[10px] text-neutral-500">{hint}</p> : null}
    </div>
  );

  const ChartWrap = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <div className={`relative min-h-[5rem] w-full flex-1 ${className}`}>{children}</div>
  );

  return (
    <div className="animate-fade-in mx-auto flex h-full min-h-0 w-full min-w-0 max-w-[1600px] flex-col overflow-hidden max-lg:overflow-y-auto max-lg:pb-6">
      <header className="flex shrink-0 flex-col gap-3 border-b border-neutral-200/80 pb-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:pb-2.5">
        <div className="min-w-0 shrink-0 lg:flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-security-navy-700 lg:text-xs">
            {format(new Date(), "EEEE, MMMM d, yyyy")}
          </p>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900 lg:text-2xl">Dashboard</h1>
          <p className="mt-1 hidden text-sm text-neutral-600 max-lg:block">
            Live snapshot of guards, sites, shifts, and tasks.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {canSites && (
            <div className="relative w-full min-w-0 sm:w-auto" ref={siteFilterRef}>
              <button
                type="button"
                onClick={() => setSiteFilterOpen((o) => !o)}
                className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-left text-sm font-medium text-neutral-900 shadow-sm transition-all hover:border-security-navy-300 hover:shadow-md sm:min-w-[200px] sm:w-auto"
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
                <div className="absolute top-full left-0 mt-2 z-20 w-72 max-h-64 overflow-auto rounded-xl border border-neutral-200/80 bg-white shadow-security-elevated py-1.5">
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
                      className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-2 rounded-lg mx-1 w-[calc(100%-0.5rem)] ${selectedSiteIds.includes(s.id) ? "bg-security-navy-50 text-neutral-900 font-semibold" : "hover:bg-neutral-50 text-neutral-700"}`}
                    >
                      {selectedSiteIds.includes(s.id) && <span className="text-security-navy-700">✓</span>}
                      {s.name}
                    </button>
                  ))}
                  {sites.length === 0 && (
                    <p className="px-4 py-3 text-sm text-neutral-600">No sites</p>
                  )}
                </div>
              )}
            </div>
          )}
          <div
            className="flex w-full min-w-0 rounded-full border border-neutral-200/90 bg-neutral-100/80 p-1 shadow-inner sm:inline-flex sm:w-auto"
            role="group"
            aria-label="Date range"
          >
            {DATE_RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setDateRange(r.value)}
                className={`min-w-0 flex-1 px-3 py-1.5 text-sm font-semibold rounded-full transition-all sm:flex-none sm:px-4 ${dateRange === r.value ? "bg-security-navy-700 text-white shadow-md" : "text-neutral-700 hover:text-neutral-900 hover:bg-white/80"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="grid shrink-0 grid-cols-2 gap-2 py-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-2.5 lg:py-2.5" aria-label="Key metrics">
        <KpiTile label="Total employees" value={employeesTotal} hint="All statuses" />
        <KpiTile label="Guards on duty" value={data?.guardsOnDuty ?? 0} hint="Right now" />
        <KpiTile label="Active sites" value={data?.activeSitesCount ?? 0} />
        <KpiTile label="Pending payroll" value={pendingPayrollCount} hint="Runs not yet paid" accent={pendingPayrollCount > 0 ? "alert" : "default"} />
        <KpiTile label="Needs attention" value={alertTally + taskUrgentCount} hint="Alerts + urgent tasks" accent={alertTally + taskUrgentCount > 0 ? "alert" : "default"} />
      </section>

      {alertsList.length > 0 && (
        <section
          className="mb-2 shrink-0 rounded-security-lg border border-security-amber-200 bg-security-amber-50/70 px-3 py-2"
          aria-label="Items needing attention"
        >
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-800 lg:text-sm">
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
              <li className="text-neutral-600">+{alertsList.length - 4} more</li>
            )}
          </ul>
        </section>
      )}

      <section
        className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden max-lg:auto-rows-auto md:grid-cols-2 md:gap-3 xl:grid-cols-4 xl:grid-rows-2 xl:gap-3"
        aria-label="Dashboard widgets"
      >
        <DashboardCard title="Guards on duty">
          <ChartWrap>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={guardsByDay} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, "auto"]} tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Bar dataKey="value" fill="#FF9800" radius={[6, 6, 0, 0]} />
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
              <p className="text-3xl font-bold tabular-nums tracking-tight text-neutral-900 lg:text-2xl">{data?.activeSitesCount ?? 0}</p>
              <p className="mt-0.5 text-xs text-neutral-600 lg:text-sm">Sites active</p>
              {typeof data?.activeSitesDelta === "number" && (
                <p className="mt-1 text-xs text-neutral-600">
                  <span className={`font-semibold ${data.activeSitesDelta >= 0 ? "text-security-navy-800" : "text-red-700"}`}>
                    {data.activeSitesDelta >= 0 ? "+" : ""}{data.activeSitesDelta}
                  </span>
                  {" "}since last month
                </p>
              )}
            </div>
            {canSites && (
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
                <AreaChart data={shiftsOverTimeData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF9800" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#FF9800" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Area type="monotone" dataKey="value" stroke="#FF9800" strokeWidth={2} fill="url(#areaFill)" />
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

        <DashboardCard
          title="My tasks"
          action={
            <Link href="/tasks" className="text-xs font-semibold text-security-navy-800 hover:text-security-navy-900">
              View all →
            </Link>
          }
        >
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-center justify-between rounded-security border border-red-100 bg-red-50/80 px-3 py-2">
              <span className="text-xs font-medium text-neutral-900 lg:text-sm">Overdue</span>
              <span className="text-base font-bold tabular-nums text-neutral-900">{data?.taskStats?.overdue ?? 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-security border border-security-navy-100 bg-security-navy-50/80 px-3 py-2">
              <span className="text-xs font-medium text-neutral-900 lg:text-sm">Due today</span>
              <span className="text-base font-bold tabular-nums text-neutral-900">{data?.taskStats?.dueToday ?? 0}</span>
            </div>
          </div>
          <Link href="/tasks" className="btn-secondary mt-auto w-full shrink-0 py-1.5 text-center text-xs lg:text-sm">
            Open tasks
          </Link>
        </DashboardCard>

        <DashboardCard title="Team by status">
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <ChartWrap>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
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
                <span className="text-lg font-bold text-neutral-900">{employeesTotal || 0}</span>
              </div>
            </ChartWrap>
            <div className="grid shrink-0 grid-cols-2 gap-x-2 gap-y-1 border-t border-neutral-100 pt-1.5 text-[10px] lg:text-xs">
              {(() => {
                const raw = data?.employeesByStatus ?? [];
                const chartData = raw.some((d) => d.value > 0) ? raw : defaultStatusData;
                return chartData.map((item, index) => (
                  <div key={item.name} className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                    />
                    <span className="truncate text-neutral-600">{item.name}</span>
                    <span className="ml-auto shrink-0 font-medium tabular-nums text-neutral-900">{item.value}</span>
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
              <Bar dataKey="value" fill="#F57C00" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </ChartWrap>
        </DashboardCard>

        <DashboardCard
          title="Payroll status"
          action={
            canPayroll ? (
              <Link href="/payroll" className="text-xs font-semibold text-security-navy-800 hover:text-security-navy-900">
                Open →
              </Link>
            ) : undefined
          }
        >
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            {canPayroll ? (
              <>
                {[
                  { key: "draft", label: "Draft", href: "/payroll" },
                  { key: "calculated", label: "Calculated", href: "/payroll" },
                  { key: "paid", label: "Paid", href: "/payroll", highlight: true },
                ].map((row) => (
                  <Link
                    key={row.key}
                    href={row.href}
                    className={`flex shrink-0 items-center justify-between rounded-security border px-3 py-1.5 transition-colors hover:shadow-sm lg:py-2 ${
                      row.highlight
                        ? "border-security-navy-100 bg-security-navy-50/60 hover:bg-security-navy-50"
                        : "border-neutral-200 bg-neutral-50 hover:bg-white"
                    }`}
                  >
                    <span className="text-xs font-medium text-neutral-900 lg:text-sm">{row.label}</span>
                    <span className="text-base font-bold tabular-nums text-neutral-900">{data?.payrollStatus?.[row.key as keyof typeof data.payrollStatus] ?? 0}</span>
                  </Link>
                ))}
                <Link href="/payroll" className="btn-primary mt-auto w-full shrink-0 py-1.5 text-center text-xs lg:text-sm">
                  Run payroll
                </Link>
              </>
            ) : (
              <div className="space-y-2 text-sm">
                {(["draft", "calculated", "paid"] as const).map((key) => (
                  <div key={key} className="flex justify-between border-b border-neutral-100 py-2 last:border-0">
                    <span className="capitalize text-neutral-600">{key}</span>
                    <span className="font-bold tabular-nums text-neutral-900">{data?.payrollStatus?.[key] ?? 0}</span>
                  </div>
                ))}
              </div>
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
            <p className="mb-1.5 shrink-0 text-[10px] text-neutral-600 lg:text-xs">Message team directly</p>
            <div className="min-h-0 flex-1 overflow-hidden">
              {whatsappContacts.length > 0 ? (
                whatsappContacts.slice(0, 2).map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => router.push(`/whatsapp?contact=${contact.id}`)}
                    className="flex w-full items-center gap-2 rounded-security border border-transparent px-1 py-1 text-left transition-colors hover:bg-neutral-50 lg:gap-2.5 lg:py-1.5"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-security-navy-100 text-[10px] font-semibold text-security-navy-900 lg:h-8 lg:w-8">
                      {contact.firstName?.charAt(0)}
                      {contact.lastName?.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-neutral-900">
                        {contact.firstName} {contact.lastName}
                      </span>
                      <span className="block truncate text-[10px] text-neutral-500">
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
                <p className="py-3 text-center text-xs text-neutral-500">No contacts yet</p>
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
            <p className="rounded-security border border-dashed border-neutral-200 bg-neutral-50 py-6 text-center text-xs text-neutral-600 lg:text-sm">
              No WhatsApp access
            </p>
          </DashboardCard>
        )}
      </section>
    </div>
  );
}
