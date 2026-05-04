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
      <div className="animate-pulse space-y-6 max-w-[1600px] mx-auto">
        <div className="space-y-3">
          <div className="h-4 w-32 bg-security-navy-100 rounded-full" />
          <div className="h-10 w-64 bg-[var(--bg-nav-hover)] rounded-security-lg" />
          <div className="h-4 w-72 bg-[var(--bg-nav-hover)] rounded-full" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={`kpi-${i}`} className="h-24 bg-white border border-[var(--hairline)] rounded-security-lg shadow-security-card" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-72 bg-white border border-[var(--hairline)] rounded-security-lg shadow-security-card" />
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
    <div className={`group flex flex-col relative card-dashboard p-3 sm:p-4 transition-shadow duration-300 ${className}`}>
      {title && (
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <h2 className="section-title normal-case tracking-tight text-base font-semibold flex items-center gap-2 leading-snug">
            <span className="w-1 h-4 rounded-full bg-gradient-to-b from-security-navy-500 to-security-navy-700 shrink-0 shadow-sm" aria-hidden />
            {title}
          </h2>
          {icons}
        </div>
      )}
      <div className="flex-1 w-full min-h-0 flex flex-col">{children}</div>
    </div>
  );

  const KpiTile = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
    <div className="kpi-tile">
      <p className="kpi-label">{label}</p>
      <p className="kpi-value mt-1">{value}</p>
      {hint ? <p className="mt-1 caption font-medium">{hint}</p> : null}
    </div>
  );

  return (
    <div className="animate-fade-in max-w-[1600px] mx-auto w-full h-full min-h-0 flex flex-col lg:overflow-hidden">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between pb-4 border-b border-[var(--hairline)] shrink-0">
        <div className="space-y-1 max-w-full">
          <p className="label-text">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Live snapshot of guards, sites, shifts, and tasks—filtered by your selection below.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 w-full lg:w-auto">
          {canSites && (
            <div className="relative" ref={siteFilterRef}>
              <button
                type="button"
                onClick={() => setSiteFilterOpen((o) => !o)}
                aria-expanded={siteFilterOpen}
                aria-haspopup="listbox"
                className="btn-secondary w-full sm:min-w-[220px] sm:w-auto justify-between text-left"
              >
                <span className="truncate">
                  {selectedSiteIds.length === 0
                    ? "All sites"
                    : selectedSiteIds.length === 1
                      ? sites.find((s) => s.id === selectedSiteIds[0])?.name ?? "1 site"
                      : `${selectedSiteIds.length} sites`}
                </span>
                <svg className={`w-4 h-4 shrink-0 ml-2 transition-transform ${siteFilterOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {siteFilterOpen && (
                <div className="absolute top-full left-0 mt-2 z-20 w-72 max-h-64 overflow-auto rounded-security-lg border border-[var(--hairline)] bg-white shadow-security-elevated py-1.5 animate-fade-in" role="listbox">
                  {selectedSiteIds.length > 0 && (
                    <button
                      type="button"
                      onClick={clearSiteFilter}
                      className="w-full px-4 py-2.5 text-left text-sm text-black hover:bg-security-navy-50 font-semibold border-b border-[var(--hairline)] mb-1"
                    >
                      Clear filter
                    </button>
                  )}
                  {sites.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleSite(s.id)}
                      role="option"
                      aria-selected={selectedSiteIds.includes(s.id)}
                      className={`w-[calc(100%-0.5rem)] px-3 py-2.5 text-left text-sm flex items-center gap-2 rounded-security mx-1 ${selectedSiteIds.includes(s.id) ? "bg-security-navy-50 text-black font-semibold border border-security-navy-200" : "hover:bg-[var(--bg-nav-hover)] text-black border border-transparent"}`}
                    >
                      <span className={`w-4 h-4 rounded border ${selectedSiteIds.includes(s.id) ? "bg-security-navy-500 border-security-navy-700" : "border-[var(--hairline-strong)] bg-white"} flex items-center justify-center shrink-0`}>
                        {selectedSiteIds.includes(s.id) && (
                          <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24" aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      {s.name}
                    </button>
                  ))}
                  {sites.length === 0 && (
                    <p className="px-4 py-3 text-sm text-black">No sites</p>
                  )}
                </div>
              )}
            </div>
          )}
          <div
            className="segmented"
            role="group"
            aria-label="Date range"
          >
            {DATE_RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setDateRange(r.value)}
                className={`segmented-option ${dateRange === r.value ? "segmented-option-active" : ""}`}
                aria-pressed={dateRange === r.value}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 py-3 md:py-4 shrink-0" aria-label="Key metrics">
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
              <XAxis dataKey="name" tick={{ fill: "#000000", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, "auto"]} tick={{ fill: "#000000", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Bar dataKey="value" fill="#FF9800" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </DashboardCard>

        <DashboardCard title="Active Sites" className="h-full min-h-0">
          <div className="flex flex-col items-center justify-center flex-1 gap-2 py-1">
            <div className="flex h-20 w-20 items-center justify-center rounded-security-lg bg-gradient-to-br from-security-navy-100 to-security-navy-50 border border-security-navy-300 shadow-inner">
              <span className="text-3xl font-bold tabular-nums text-black tracking-tight">{data?.activeSitesCount ?? 0}</span>
            </div>
            {typeof data?.activeSitesDelta === "number" && (
              <p className="text-sm text-black text-center">
                <span className={`font-semibold ${data.activeSitesDelta >= 0 ? "text-black" : "text-red-700"}`}>
                  {data.activeSitesDelta >= 0 ? "+" : ""}{data.activeSitesDelta}
                </span>
                {" "}since last month
              </p>
            )}
            {canSites && (
              <Link
                href="/sites"
                className="btn-primary"
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
                  <XAxis dataKey="name" tick={{ fill: "#000000", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#000000", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Area type="monotone" dataKey="value" stroke="#FF9800" strokeWidth={2} fill="url(#areaFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {canRostering && (
              <Link
                href="/rostering"
                className="btn-secondary w-full justify-center text-sm"
              >
                View schedule
              </Link>
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="My Tasks" className="h-full min-h-0">
          <div className="space-y-2 text-sm flex-1">
            <div className="flex justify-between items-center rounded-security bg-red-50 border border-red-200 px-3 py-2.5">
              <span className="font-semibold text-black">Overdue</span>
              <span className="font-bold tabular-nums text-black">{data?.taskStats?.overdue ?? 0}</span>
            </div>
            <div className="flex justify-between items-center rounded-security bg-security-navy-50 border border-security-navy-200 px-3 py-2.5">
              <span className="font-semibold text-black">Due today</span>
              <span className="font-bold tabular-nums text-black">{data?.taskStats?.dueToday ?? 0}</span>
            </div>
          </div>
          <Link
            href="/tasks"
            className="btn-secondary mt-auto w-full justify-center text-sm"
          >
            View Tasks
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
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
                    fill="#FFB74D"
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
                <span className="text-xl font-bold text-black">{employeesTotal || 0}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center border-t border-[var(--hairline)] pt-2">
              {(() => {
                const raw = data?.employeesByStatus ?? [];
                const chartData = raw.some((d) => d.value > 0) ? raw : defaultStatusData;
                return chartData.map((item, index) => (
                  <div key={item.name} className="flex items-center gap-1.5 text-xs">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                      aria-hidden
                    />
                    <span className="text-black font-medium">{item.name}</span>
                    <span className="text-black/70">({item.value})</span>
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
              <XAxis dataKey="name" tick={{ fill: "#000000", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#000000", fontSize: 10 }} axisLine={false} tickLine={false} />
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
                  className="flex items-center justify-between w-full bg-white py-2.5 px-3 rounded-security border border-[var(--hairline)] transition-all hover:border-security-navy-300 hover:bg-security-navy-50/60 shadow-security-card focus-ring"
                >
                  <span className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full border-2 border-[var(--hairline-strong)] flex items-center justify-center bg-white" aria-hidden />
                    <span className="font-semibold text-sm text-black">Draft</span>
                  </span>
                  <span className="font-bold tabular-nums text-black">{data?.payrollStatus?.draft ?? 0}</span>
                </Link>
                <Link
                  href="/payroll"
                  className="flex items-center justify-between w-full bg-white py-2.5 px-3 rounded-security border border-[var(--hairline)] transition-all hover:border-security-navy-300 hover:bg-security-navy-50/60 shadow-security-card focus-ring"
                >
                  <span className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full border-2 border-[var(--hairline-strong)] flex items-center justify-center bg-white" aria-hidden />
                    <span className="font-semibold text-sm text-black">Calc.</span>
                  </span>
                  <span className="font-bold tabular-nums text-black">{data?.payrollStatus?.calculated ?? 0}</span>
                </Link>
                <Link
                  href="/payroll"
                  className="flex items-center justify-between w-full bg-security-navy-50 py-2.5 px-3 rounded-security border border-security-navy-300 transition-all hover:bg-security-navy-100 hover:border-security-navy-400 shadow-security-card focus-ring"
                >
                  <span className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full border-2 border-security-navy-600 bg-security-navy-500 flex items-center justify-center" aria-hidden>
                      <svg className="w-3 h-3 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="font-semibold text-sm text-black">Paid</span>
                  </span>
                  <span className="font-bold tabular-nums text-black">{data?.payrollStatus?.paid ?? 0}</span>
                </Link>
                <Link
                  href="/payroll"
                  className="btn-primary mt-1 w-full justify-center"
                >
                  Generate Payrun
                </Link>
              </>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between"><span className="text-black">Draft</span><span className="font-bold text-black tabular-nums">{data?.payrollStatus?.draft ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-black">Calc.</span><span className="font-bold text-black tabular-nums">{data?.payrollStatus?.calculated ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-black">Paid</span><span className="font-bold text-black tabular-nums">{data?.payrollStatus?.paid ?? 0}</span></div>
              </div>
            )}
          </div>
        </DashboardCard>

        {canWhatsApp ? (
          <DashboardCard title="WhatsApp" className="h-full min-h-0">
            <p className="text-xs text-black mb-2 leading-relaxed">Message team members directly</p>
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
                    className="flex items-center gap-2 py-2 border-b border-[var(--hairline)] last:border-0 cursor-pointer transition-colors hover:bg-security-navy-50/60 rounded-security px-2 -mx-1 focus-ring"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-black truncate">
                        {contact.firstName?.charAt(0)}{contact.lastName?.charAt(0)} {contact.firstName}...
                      </p>
                      <p className="text-xs text-black truncate">
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
                      <button className="p-1.5 rounded text-black hover:bg-[var(--bg-nav-hover)] focus-ring" title="More" aria-label="More">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-black py-4">No contacts</p>
              )}
            </div>
            {whatsappContacts.length > 3 && (
              <Link href="/whatsapp" className="text-sm font-semibold text-black mt-2 inline-flex items-center gap-1 link-inline">
                View all ({whatsappContacts.length})
                <span aria-hidden>→</span>
              </Link>
            )}
            <Link
              href="/whatsapp"
              className="btn-primary mt-auto w-full justify-center"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              WhatsApp
            </Link>
          </DashboardCard>
        ) : (
          <DashboardCard title="WhatsApp" className="h-full min-h-0">
            <p className="text-xs text-black mb-3">Message team members directly</p>
            <div className="empty-state mt-2">
              <p className="empty-state-body">No access</p>
            </div>
          </DashboardCard>
        )}
      </div>
    </div>
  );
}
