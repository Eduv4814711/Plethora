"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { authFetch, getWhatsAppContacts, sendWhatsAppMessage } from "@/lib/api";
import { WhatsAppWidget } from "@/components/whatsapp/whatsapp-widget";
import { canAccessRoute } from "@/lib/permissions";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
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
  { name: "Jan", value: 0 },
  { name: "Feb", value: 0 },
  { name: "Mar", value: 0 },
  { name: "Apr", value: 0 },
];

const PIE_COLORS = ["#000000", "#404040", "#737373", "#a3a3a3"]; // Black and white grayscale

const DATE_RANGES = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

export default function DashboardPage() {
  const { token, user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<string>("month");
  const [siteFilterOpen, setSiteFilterOpen] = useState(false);
  const [whatsappContacts, setWhatsappContacts] = useState<{ id: string; firstName: string; lastName: string; phone: string | null; whatsappUrl: string | null }[]>([]);

  const canSites = user ? canAccessRoute("/sites", user.role) : false;
  const canWhatsApp = user ? canAccessRoute("/whatsapp", user.role) : false;
  const canPayroll = user ? canAccessRoute("/payroll", user.role) : false;
  const canRostering = user ? canAccessRoute("/rostering", user.role) : false;

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
      <div className="animate-pulse space-y-6">
        <div className="h-9 w-48 bg-neutral-300 rounded-security-lg" />
        <div className="grid grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 bg-white border border-neutral-200 rounded-security-lg shadow-security-card" />
          ))}
        </div>
      </div>
    );
  }

  const DashboardCard = ({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) => (
    <div className={`card-dashboard flex flex-col p-5 relative border-neutral-200 ${className}`}>
      {title && (
        <h2 className="font-semibold text-sm text-black uppercase tracking-wider mb-4 flex items-center gap-2">
          <span className="w-1 h-4 bg-black rounded-full" />
          {title}
        </h2>
      )}
      <div className="flex-1 w-full h-full relative">{children}</div>
    </div>
  );

  return (
    <div className="animate-fade-in max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight">Dashboard</h1>
          <p className="text-sm text-neutral-500 mt-0.5">Overview of your workforce operations</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canSites && (
            <div className="relative" ref={siteFilterRef}>
              <button
                type="button"
                onClick={() => setSiteFilterOpen((o) => !o)}
                className="flex items-center gap-2 min-w-[200px] px-4 py-2.5 rounded-security border-2 border-neutral-300 bg-white text-left text-sm text-black hover:border-neutral-400 hover:bg-neutral-50 transition-colors"
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
                <div className="absolute top-full left-0 mt-1 z-10 w-64 max-h-60 overflow-auto rounded-security-lg border border-neutral-300 bg-white shadow-security-elevated py-1">
                  {selectedSiteIds.length > 0 && (
                    <button
                      type="button"
                      onClick={clearSiteFilter}
                      className="w-full px-4 py-2 text-left text-sm text-neutral-600 hover:bg-neutral-50 font-medium"
                    >
                      Clear filter
                    </button>
                  )}
                  {sites.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleSite(s.id)}
                      className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-2 ${selectedSiteIds.includes(s.id) ? "bg-neutral-100 text-black font-semibold" : "hover:bg-neutral-50 text-neutral-600"}`}
                    >
                      {selectedSiteIds.includes(s.id) && (
                        <span className="text-black">✓</span>
                      )}
                      {s.name}
                    </button>
                  ))}
                  {sites.length === 0 && (
                    <p className="px-4 py-2 text-sm text-neutral-500">No sites</p>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="flex rounded-security border-2 border-neutral-300 overflow-hidden">
            {DATE_RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setDateRange(r.value)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${dateRange === r.value ? "bg-black text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col gap-6">
          {/* Top Row */}
          <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-6 h-64">
            <DashboardCard title="Guards On Duty">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.guardsOnDutyByDay ?? defaultGuardsByDay} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d4d4d4" />
                  <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#525252", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Line type="monotone" dataKey="value" stroke="#000000" strokeWidth={2} dot={{ fill: "#000000", stroke: "#fafafa", strokeWidth: 2, r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </DashboardCard>

            <DashboardCard title="Active Sites">
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <div className="flex items-center gap-2">
                  <svg className="w-8 h-8 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-6xl font-bold text-black">{data?.activeSitesCount ?? 0}</span>
                </div>
                {typeof data?.activeSitesDelta === "number" && data.activeSitesDelta !== 0 && (
                  <p className="text-sm text-neutral-500">
                    {data.activeSitesDelta > 0 ? "+" : ""}{data.activeSitesDelta} since last month
                  </p>
                )}
                {canSites && (
                  <Link
                    href="/sites"
                    className="mt-2 px-4 py-2 rounded-security border-2 border-black bg-black text-white text-sm font-semibold hover:bg-neutral-800 transition-colors"
                  >
                    Add Site +
                  </Link>
                )}
              </div>
            </DashboardCard>

            <DashboardCard title="Active Guards Rostered" className="flex flex-col">
              <div className="flex-1 min-h-[120px] w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={(() => {
                        const raw = data?.shiftsByStatus ?? [];
                        return raw.some((d) => d.value > 0) ? raw : defaultRosteredData;
                      })()}
                      cx="50%"
                      cy="50%"
                      innerRadius={0}
                      outerRadius={70}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ name, value }) => `${name} ${value}`}
                    >
                      {(() => {
                        const raw = data?.shiftsByStatus ?? [];
                        const chartData = raw.some((d) => d.value > 0) ? raw : defaultRosteredData;
                        return chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ));
                      })()}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {canRostering && (
                <Link
                  href="/rostering"
                  className="mt-4 w-full py-2.5 rounded-security border-2 border-neutral-300 bg-white text-center text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-black hover:border-neutral-400 transition-colors shrink-0"
                >
                  View Schedule →
                </Link>
              )}
            </DashboardCard>
          </div>

          {/* Bottom Row */}
          <div className="grid grid-cols-[1fr_1.5fr_1fr] gap-6 h-64">
            <DashboardCard title="TEAM MEMBER BY STATUS">
              <div className="absolute inset-0 flex items-center justify-center pt-8">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={(() => {
                        const raw = data?.employeesByStatus ?? [];
                        return raw.some((d) => d.value > 0) ? raw : defaultStatusData;
                      })()}
                      cx="50%"
                      cy="50%"
                      innerRadius={0}
                      outerRadius={70}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ name, value }) => `${name} ${value}`}
                    >
                      {(() => {
                        const raw = data?.employeesByStatus ?? [];
                        const chartData = raw.some((d) => d.value > 0) ? raw : defaultStatusData;
                        return chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ));
                      })()}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </DashboardCard>

            <DashboardCard title="SHIFT SCHEDULED OVER TIME">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data?.shiftsOverTime?.length ? data.shiftsOverTime : defaultShiftData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  barSize={40}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d4d4d4" />
                  <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Bar dataKey="value" fill="#000000" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </DashboardCard>

            <DashboardCard title="Payroll Status" className="flex flex-col gap-3 justify-center">
              <div className="flex flex-col gap-3">
                {canPayroll ? (
                  <>
                    <Link
                      href="/payroll"
                      className="flex items-center justify-between w-full bg-neutral-100 hover:bg-neutral-200 py-3 px-4 rounded-security border border-neutral-300 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-neutral-300 flex items-center justify-center text-black">
                          <span className="text-xs font-bold">!</span>
                        </span>
                        <span className="font-semibold text-sm text-black">Draft</span>
                      </span>
                      <span className="font-bold text-black">{data?.payrollStatus?.draft ?? 0}</span>
                    </Link>
                    <Link
                      href="/payroll"
                      className="flex items-center justify-between w-full bg-neutral-100 hover:bg-neutral-200 py-3 px-4 rounded-security border border-neutral-300 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-neutral-500" fill="none" viewBox="0 0 24 24" aria-hidden>
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span className="font-semibold text-sm text-black">Calc.</span>
                      </span>
                      <span className="font-bold text-black">{data?.payrollStatus?.calculated ?? 0}</span>
                    </Link>
                    <Link
                      href="/payroll"
                      className="flex items-center justify-between w-full bg-neutral-100 hover:bg-neutral-200 py-3 px-4 rounded-security border border-neutral-300 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-neutral-400 flex items-center justify-center text-white">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                        <span className="font-semibold text-sm text-black">Paid</span>
                      </span>
                      <span className="font-bold text-black">{data?.payrollStatus?.paid ?? 0}</span>
                    </Link>
                    <Link
                      href="/payroll"
                      className="w-full py-3 px-4 text-center font-semibold text-sm bg-black hover:bg-neutral-800 text-white rounded-security transition-colors"
                    >
                      Generate Payrun
                    </Link>
                  </>
                ) : (
                  <div className="flex flex-col gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-neutral-600">Draft</span>
                      <span className="font-bold text-black">{data?.payrollStatus?.draft ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-600">Calc.</span>
                      <span className="font-bold text-black">{data?.payrollStatus?.calculated ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-600">Paid</span>
                      <span className="font-bold text-black">{data?.payrollStatus?.paid ?? 0}</span>
                    </div>
                  </div>
                )}
              </div>
            </DashboardCard>
          </div>
        </div>

        {/* Right Sidebar - Tasks & WhatsApp (height matches top + bottom grid rows: h-64 + gap-6 + h-64) */}
        <div className="w-64 flex-shrink-0 flex flex-col gap-6 h-[536px]">
          <div className="card-dashboard w-full p-5 flex flex-col border-neutral-200">
            <h2 className="font-semibold text-sm text-black uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-1 h-4 bg-black rounded-full" />
              My Tasks
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-600">Overdue</span>
                <span className="font-semibold text-black">
                  {data?.taskStats?.overdue ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600">Due today</span>
                <span className="font-semibold text-black">
                  {data?.taskStats?.dueToday ?? 0}
                </span>
              </div>
            </div>
            <Link
              href="/tasks"
              className="mt-3 flex items-center justify-center gap-1 w-full px-5 py-2.5 font-medium rounded-security border-2 border-neutral-300 bg-white text-black hover:bg-neutral-50 text-sm transition-colors"
            >
              View Tasks
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </Link>
            {(data?.topPriorityTasks?.length ?? 0) > 0 && (
              <div className="mt-4 pt-4 border-t border-neutral-200">
                <h3 className="font-semibold text-xs text-neutral-500 uppercase tracking-wider mb-2">Top 3 Priority Tasks</h3>
                <ul className="space-y-2">
                  {data!.topPriorityTasks!.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/tasks/${t.id}`}
                        className="block text-sm text-black hover:text-neutral-600 transition-colors truncate"
                        title={t.title}
                      >
                        {t.title.length > 28 ? `${t.title.slice(0, 28)}...` : t.title}
                      </Link>
                      <span className="text-xs text-neutral-500">
                        Due {t.dueDate ? format(new Date(t.dueDate), "MMM d, yyyy") : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* WhatsApp - Team member contacts */}
          {canWhatsApp && (
            <WhatsAppWidget
              contacts={whatsappContacts}
              onSend={handleSendWhatsApp}
              compact
            />
          )}
        </div>
      </div>
    </div>
  );
}
