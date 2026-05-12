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

const defaultRosteredData = [{ name: "No data", value: 1 }];

const defaultStatusData = [{ name: "No data", value: 1 }];

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
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
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
      <div className="animate-pulse space-y-8 max-w-[1600px] mx-auto">
        <div className="space-y-3">
          <div className="h-4 w-24 bg-security-navy-200/80 rounded-full" />
          <div className="h-10 w-64 bg-neutral-200 rounded-xl" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={`kpi-${i}`} className="h-24 bg-white border border-neutral-200/80 rounded-2xl shadow-sm" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-72 bg-white border border-neutral-200/80 rounded-2xl shadow-sm" />
          ))}
        </div>
      </div>
    );
  }

  const guardsByDay = data?.guardsOnDutyByDay ?? defaultGuardsByDay;
  const employeesTotal = (data?.employeesByStatus ?? []).reduce((s, e) => s + e.value, 0) || 0;
  const shiftsOverTimeData = data?.shiftsOverTime?.length ? data.shiftsOverTime : defaultShiftData;
  const peakGuardsThisWeek = Math.max(...guardsByDay.map((d) => d.value), 0);
  const taskUrgentCount = (data?.taskStats?.overdue ?? 0) + (data?.taskStats?.dueToday ?? 0);
  const alertTally = (data?.alerts ?? []).reduce((sum, a) => sum + (typeof a.count === "number" ? a.count : 1), 0);

  const DashboardCard = ({ title, children, className = "", icons }: { title?: string; children: React.ReactNode; className?: string; icons?: React.ReactNode }) => (
    <div
      className={`group flex flex-col relative rounded-2xl border border-neutral-200/70 bg-white p-3 md:p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-8px_rgba(245,124,0,0.07)] transition-shadow duration-300 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_40px_-12px_rgba(245,124,0,0.12)] ${className}`}
    >
      {title && (
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <h2 className="font-semibold text-[0.875rem] text-neutral-900 tracking-tight leading-snug flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-gradient-to-b from-security-navy-400 to-security-navy-700 shrink-0 shadow-sm" />
            {title}
          </h2>
          {icons}
        </div>
      )}
      <div className="flex-1 w-full min-h-0 flex flex-col">{children}</div>
    </div>
  );

  const KpiTile = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
    <div className="rounded-2xl border border-neutral-200/60 bg-white/90 px-3 py-2.5 shadow-sm backdrop-blur-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-600">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-neutral-900 tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-neutral-600">{hint}</p> : null}
    </div>
  );

  return (
    <div className="animate-fade-in max-w-[1600px] mx-auto w-full h-full min-h-0 overflow-hidden flex flex-col">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between pb-4 border-b border-neutral-200/80 shrink-0">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-security-navy-700">
            {format(new Date(), "EEEE, MMMM d, yyyy")}
          </p>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight md:text-[1.75rem]">Dashboard</h1>
          <p className="text-xs md:text-sm text-neutral-600 max-w-xl">
            Live snapshot of guards, sites, shifts, and tasks—filtered by your selection below.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canSites && (
            <div className="relative" ref={siteFilterRef}>
              <button
                type="button"
                onClick={() => setSiteFilterOpen((o) => !o)}
                className="flex w-full min-w-0 items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-neutral-900 shadow-sm hover:border-security-navy-300 hover:shadow-md transition-all sm:min-w-[220px] sm:w-auto rounded-xl border border-neutral-200 bg-white"
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
            className="inline-flex rounded-full border border-neutral-200/90 bg-neutral-100/80 p-1 shadow-inner"
            role="group"
            aria-label="Date range"
          >
            {DATE_RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setDateRange(r.value)}
                className={`px-3.5 sm:px-5 py-2 text-sm font-semibold rounded-full transition-all ${dateRange === r.value ? "bg-security-navy-700 text-white shadow-md" : "text-neutral-700 hover:text-neutral-900 hover:bg-white/80"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-3 py-3 md:py-4 shrink-0" aria-label="Key metrics">
        <KpiTile label="Peak on duty (week)" value={peakGuardsThisWeek} hint="From roster trend" />
        <KpiTile label="Active sites" value={data?.activeSitesCount ?? 0} />
        <KpiTile label="Tasks needing attention" value={taskUrgentCount} hint="Overdue + due today" />
        <KpiTile label="Open alerts" value={alertTally} />
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4 pb-1 flex-1 min-h-0 auto-rows-fr overflow-hidden">
        {/* Row 1 */}
        <DashboardCard title="Guards On Duty" className="h-full min-h-0">
          <div className="flex-1 min-h-[120px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={guardsByDay} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, "auto"]} tick={{ fill: "#525252", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Bar dataKey="value" fill="#FF9800" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </DashboardCard>

        <DashboardCard title="Active Sites" className="h-full min-h-0">
          <div className="flex flex-col items-center justify-center flex-1 gap-2 py-1">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-security-navy-50 to-white border border-security-navy-100 shadow-inner">
              <span className="text-3xl font-bold tabular-nums text-neutral-900 tracking-tight">{data?.activeSitesCount ?? 0}</span>
            </div>
            {typeof data?.activeSitesDelta === "number" && (
              <p className="text-sm text-neutral-600 text-center">
                <span className={`font-semibold ${data.activeSitesDelta >= 0 ? "text-security-navy-800" : "text-red-700"}`}>
                  {data.activeSitesDelta >= 0 ? "+" : ""}{data.activeSitesDelta}
                </span>
                {" "}since last month
              </p>
            )}
            {canSites && (
              <Link
                href="/sites"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-security-navy-700 text-white text-sm font-semibold hover:bg-security-navy-800 transition-colors shadow-sm hover:shadow-md"
              >
                Add site
                <span className="text-lg leading-none">+</span>
              </Link>
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="Active Guards Rostered" className="h-full min-h-0">
          <div className="flex flex-col h-full gap-2">
            <div className="flex-1 min-h-[100px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={shiftsOverTimeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF9800" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#FF9800" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#525252", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Area type="monotone" dataKey="value" stroke="#FF9800" strokeWidth={2} fill="url(#areaFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {canRostering && (
              <Link
                href="/rostering"
                className="w-full py-2 rounded-xl border border-neutral-200 bg-neutral-50/80 text-center text-sm font-semibold text-neutral-900 hover:bg-white hover:border-security-navy-200 hover:text-security-navy-900 transition-all shrink-0"
              >
                View schedule
              </Link>
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="My Tasks" className="h-full min-h-0">
          <div className="space-y-2 text-sm flex-1">
            <div className="flex justify-between items-center rounded-xl bg-red-50/80 border border-red-100 px-3 py-2">
              <span className="font-medium text-neutral-900">Overdue</span>
              <span className="font-bold tabular-nums text-neutral-900">{data?.taskStats?.overdue ?? 0}</span>
            </div>
            <div className="flex justify-between items-center rounded-xl bg-security-navy-50/80 border border-security-navy-100 px-3 py-2">
              <span className="font-medium text-neutral-900">Due today</span>
              <span className="font-bold tabular-nums text-neutral-900">{data?.taskStats?.dueToday ?? 0}</span>
            </div>
          </div>
          <Link
            href="/tasks"
            className="mt-auto pt-2 flex items-center justify-center gap-2 w-full px-4 py-2 font-semibold rounded-xl border border-neutral-200 bg-white text-neutral-900 hover:border-security-navy-300 hover:bg-security-navy-50/50 text-sm transition-all shadow-sm"
          >
            View Tasks
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </Link>
        </DashboardCard>

        {/* Row 2 */}
        <DashboardCard title="Team Member By Status" className="h-full min-h-0">
          <div className="relative w-full flex-1 flex flex-col gap-2">
            <div className="relative flex-1 min-h-[120px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={(() => {
                      const raw = data?.employeesByStatus ?? [];
                      return raw.some((d) => d.value > 0) ? raw : defaultStatusData;
                    })()}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={56}
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
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-xl font-bold text-neutral-900">{employeesTotal || 0}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center border-t border-neutral-100/90 pt-2">
              {(() => {
                const raw = data?.employeesByStatus ?? [];
                const chartData = raw.some((d) => d.value > 0) ? raw : defaultStatusData;
                return chartData.map((item, index) => (
                  <div key={item.name} className="flex items-center gap-1.5 text-xs">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                    />
                    <span className="text-neutral-600">{item.name}</span>
                    <span className="text-neutral-400">({item.value})</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </DashboardCard>

        <DashboardCard title="Shift Scheduled Over Time" className="h-full min-h-0">
          <div className="flex-1 min-h-[120px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={shiftsOverTimeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barSize={40}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Bar dataKey="value" fill="#F57C00" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </DashboardCard>

        <DashboardCard title="Payroll Status" className="h-full min-h-0">
          <div className="flex flex-col gap-2 flex-1">
            {canPayroll ? (
              <>
                <Link
                  href="/payroll"
                  className="flex items-center justify-between w-full bg-neutral-50 hover:bg-white py-2.5 px-3 rounded-xl border border-neutral-200/90 transition-all hover:border-security-navy-200 shadow-sm hover:shadow-md"
                >
                  <span className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full border-2 border-neutral-400 flex items-center justify-center bg-white" />
                    <span className="font-semibold text-sm text-neutral-900">Draft</span>
                  </span>
                  <span className="font-bold tabular-nums text-neutral-900">{data?.payrollStatus?.draft ?? 0}</span>
                </Link>
                <Link
                  href="/payroll"
                  className="flex items-center justify-between w-full bg-neutral-50 hover:bg-white py-2.5 px-3 rounded-xl border border-neutral-200/90 transition-all hover:border-security-navy-200 shadow-sm hover:shadow-md"
                >
                  <span className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full border-2 border-neutral-400 flex items-center justify-center bg-white" />
                    <span className="font-semibold text-sm text-neutral-900">Calc.</span>
                  </span>
                  <span className="font-bold tabular-nums text-neutral-900">{data?.payrollStatus?.calculated ?? 0}</span>
                </Link>
                <Link
                  href="/payroll"
                  className="flex items-center justify-between w-full bg-security-navy-50/60 hover:bg-security-navy-50 py-2.5 px-3 rounded-xl border border-security-navy-100 transition-all shadow-sm hover:shadow-md"
                >
                  <span className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full border-2 border-security-navy-700 bg-security-navy-700 flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="font-semibold text-sm text-neutral-900">Paid</span>
                  </span>
                  <span className="font-bold tabular-nums text-neutral-900">{data?.payrollStatus?.paid ?? 0}</span>
                </Link>
                <Link
                  href="/payroll"
                  className="mt-1 w-full py-2 px-3 text-center font-semibold text-sm bg-security-navy-700 hover:bg-security-navy-800 text-white rounded-xl transition-all shadow-md hover:shadow-lg"
                >
                  Generate Payrun
                </Link>
              </>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-neutral-600">Draft</span>
                  <span className="font-bold text-neutral-900">{data?.payrollStatus?.draft ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">Calc.</span>
                  <span className="font-bold text-neutral-900">{data?.payrollStatus?.calculated ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">Paid</span>
                  <span className="font-bold text-neutral-900">{data?.payrollStatus?.paid ?? 0}</span>
                </div>
              </div>
            )}
          </div>
        </DashboardCard>

        {canWhatsApp ? (
          <DashboardCard title="WhatsApp" className="h-full min-h-0">
            <p className="text-xs text-neutral-600 mb-2 leading-relaxed">Message team members directly</p>
            <div className="space-y-1 flex-1 min-h-0 overflow-hidden">
              {whatsappContacts.length > 0 ? (
                whatsappContacts.slice(0, 3).map((contact) => (
                  <div
                    key={contact.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/whatsapp?contact=${contact.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/whatsapp?contact=${contact.id}`);
                      }
                    }}
                    className="flex items-center gap-2 py-2 border-b border-neutral-100 last:border-0 cursor-pointer transition-colors hover:bg-security-navy-50/60 rounded-xl px-2 -mx-1"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-neutral-900 truncate">
                        {contact.firstName?.charAt(0)}{contact.lastName?.charAt(0)} {contact.firstName}...
                      </p>
                      <p className="text-xs text-neutral-500 truncate">
                        {contact.phone
                          ? (() => {
                              const digits = contact.phone!.replace(/\D/g, "");
                              const national = digits.startsWith("27") ? "0" + digits.slice(2) : digits;
                              return `${national.slice(0, 10)}${national.length > 10 ? "..." : ""}`;
                            })()
                          : "-"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button className="p-1.5 rounded text-neutral-500 hover:bg-neutral-100" title="More">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-neutral-500 py-4">No contacts</p>
              )}
            </div>
            {whatsappContacts.length > 3 && (
              <Link href="/whatsapp" className="text-sm font-semibold text-security-navy-800 hover:text-security-navy-900 mt-2 inline-flex items-center gap-1">
                View all ({whatsappContacts.length})
                <span aria-hidden>→</span>
              </Link>
            )}
            <Link
              href="/whatsapp"
              className="mt-auto pt-2 flex items-center justify-center gap-2 w-full px-4 py-2 font-semibold rounded-xl border border-security-navy-500 bg-security-navy-500 text-white hover:bg-security-navy-600 text-sm transition-all shadow-md hover:shadow-lg"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              WhatsApp
            </Link>
          </DashboardCard>
        ) : (
          <DashboardCard title="WhatsApp" className="h-full min-h-0">
            <p className="text-xs text-neutral-600 mb-3">Message team members directly</p>
            <p className="text-sm text-neutral-600 py-6 text-center rounded-xl bg-neutral-50 border border-dashed border-neutral-200">No access</p>
          </DashboardCard>
        )}
      </div>
    </div>
  );
}
