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
        <div className="h-9 w-48 bg-neutral-300 rounded" />
        <div className="grid grid-cols-4 gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-64 bg-white border border-neutral-200 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const guardsByDay = data?.guardsOnDutyByDay ?? defaultGuardsByDay;
  const employeesTotal = (data?.employeesByStatus ?? []).reduce((s, e) => s + e.value, 0) || 0;
  const shiftsOverTimeData = data?.shiftsOverTime?.length ? data.shiftsOverTime : defaultShiftData;

  const DashboardCard = ({ title, children, className = "", icons }: { title?: string; children: React.ReactNode; className?: string; icons?: React.ReactNode }) => (
    <div className={`bg-white border border-neutral-200 rounded-xl p-5 flex flex-col relative shadow-security-card ${className}`}>
      {title && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm text-neutral-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-1 h-4 bg-security-navy-500 rounded-full" />
            {title}
          </h2>
          {icons}
        </div>
      )}
      <div className="flex-1 w-full h-full relative min-h-0">{children}</div>
    </div>
  );

  return (
    <div className="animate-fade-in max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Dashboard</h1>
          <p className="text-sm text-neutral-500 mt-0.5">Overview of your workforce operations</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canSites && (
            <div className="relative" ref={siteFilterRef}>
              <button
                type="button"
                onClick={() => setSiteFilterOpen((o) => !o)}
                className="flex items-center gap-2 min-w-[200px] px-4 py-2.5 rounded border border-neutral-300 bg-white text-left text-sm text-neutral-900 hover:border-neutral-400 hover:bg-neutral-50 transition-colors"
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
                <div className="absolute top-full left-0 mt-1 z-10 w-64 max-h-60 overflow-auto rounded border border-neutral-300 bg-white shadow-lg py-1">
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
                      className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-2 ${selectedSiteIds.includes(s.id) ? "bg-neutral-100 text-neutral-900 font-semibold" : "hover:bg-neutral-50 text-neutral-600"}`}
                    >
                      {selectedSiteIds.includes(s.id) && <span className="text-neutral-900">✓</span>}
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
          <div className="flex rounded border border-neutral-300 overflow-hidden">
            {DATE_RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setDateRange(r.value)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${dateRange === r.value ? "bg-security-navy-700 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-6">
        {/* Row 1 */}
        <DashboardCard title="Guards On Duty">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={guardsByDay} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d4d4d4" />
              <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, "auto"]} tick={{ fill: "#525252", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Bar dataKey="value" fill="#FF9800" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </DashboardCard>

        <DashboardCard title="Active Sites">
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="text-6xl font-bold text-neutral-900">{data?.activeSitesCount ?? 0}</span>
            {typeof data?.activeSitesDelta === "number" && (
              <p className="text-sm text-neutral-500">
                {data.activeSitesDelta >= 0 ? "+" : ""}{data.activeSitesDelta} since last month
              </p>
            )}
            {canSites && (
              <Link
                href="/sites"
                className="mt-2 px-4 py-2 rounded border-2 border-security-navy-700 bg-security-navy-700 text-white text-sm font-semibold hover:bg-security-navy-800 transition-colors"
              >
                Add Site +
              </Link>
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="Active Guards Rostered">
          <div className="flex flex-col h-full">
            <div className="flex-1 min-h-[120px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={shiftsOverTimeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF9800" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#FF9800" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d4d4d4" />
                  <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#525252", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Area type="monotone" dataKey="value" stroke="#FF9800" strokeWidth={2} fill="url(#areaFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {canRostering && (
              <Link
                href="/rostering"
                className="mt-4 w-full py-2.5 rounded border-2 border-neutral-300 bg-white text-center text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-700 hover:border-neutral-400 transition-colors shrink-0"
              >
                View Schedule -
              </Link>
            )}
          </div>
        </DashboardCard>

        <DashboardCard title="My Tasks">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-600">Overdue</span>
              <span className="font-semibold text-neutral-900">{data?.taskStats?.overdue ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-600">Due today</span>
              <span className="font-semibold text-neutral-900">{data?.taskStats?.dueToday ?? 0}</span>
            </div>
          </div>
          <Link
            href="/tasks"
            className="mt-4 flex items-center justify-center gap-1 w-full px-5 py-2.5 font-medium rounded border-2 border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50 text-sm transition-colors"
          >
            View Tasks
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </Link>
        </DashboardCard>

        {/* Row 2 */}
        <DashboardCard title="Team Member By Status">
          <div className="relative w-full h-full flex flex-col gap-3">
            <div className="relative flex-1 min-h-[180px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={(() => {
                      const raw = data?.employeesByStatus ?? [];
                      return raw.some((d) => d.value > 0) ? raw : defaultStatusData;
                    })()}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={70}
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
                <span className="text-2xl font-bold text-neutral-900">{employeesTotal || 0}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center border-t border-neutral-100 pt-3">
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

        <DashboardCard title="Shift Scheduled Over Time">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={shiftsOverTimeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barSize={40}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d4d4d4" />
              <XAxis dataKey="name" tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#525252", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Bar dataKey="value" fill="#FF9800" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </DashboardCard>

        <DashboardCard title="Payroll Status">
          <div className="flex flex-col gap-3">
            {canPayroll ? (
              <>
                <Link
                  href="/payroll"
                  className="flex items-center justify-between w-full bg-neutral-100 hover:bg-neutral-200 py-3 px-4 rounded border border-neutral-300 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full border-2 border-neutral-400 flex items-center justify-center" />
                    <span className="font-semibold text-sm text-neutral-900">Draft</span>
                  </span>
                  <span className="font-bold text-neutral-900">{data?.payrollStatus?.draft ?? 0}</span>
                </Link>
                <Link
                  href="/payroll"
                  className="flex items-center justify-between w-full bg-neutral-100 hover:bg-neutral-200 py-3 px-4 rounded border border-neutral-300 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full border-2 border-neutral-400 flex items-center justify-center" />
                    <span className="font-semibold text-sm text-neutral-900">Calc.</span>
                  </span>
                  <span className="font-bold text-neutral-900">{data?.payrollStatus?.calculated ?? 0}</span>
                </Link>
                <Link
                  href="/payroll"
                  className="flex items-center justify-between w-full bg-neutral-100 hover:bg-neutral-200 py-3 px-4 rounded border border-neutral-300 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full border-2 border-security-navy-700 bg-security-navy-700 flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="font-semibold text-sm text-neutral-900">Paid</span>
                  </span>
                  <span className="font-bold text-neutral-900">{data?.payrollStatus?.paid ?? 0}</span>
                </Link>
                <Link
                  href="/payroll"
                  className="w-full py-3 px-4 text-center font-semibold text-sm bg-security-navy-700 hover:bg-security-navy-800 text-white rounded transition-colors"
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
          <DashboardCard title="WhatsApp">
            <p className="text-xs text-neutral-500 mb-3">Message team members directly</p>
            <div className="space-y-2 flex-1 min-h-0 overflow-hidden">
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
                    className="flex items-center gap-2 py-2 border-b border-neutral-100 last:border-0 cursor-pointer transition-colors hover:bg-neutral-50 rounded px-1 -mx-1"
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
              <Link href="/whatsapp" className="text-sm text-security-navy-600 hover:text-security-navy-700 mt-2 block">
                View all ({whatsappContacts.length}) →
              </Link>
            )}
            <Link
              href="/whatsapp"
              className="mt-3 flex items-center justify-center gap-1 w-full px-5 py-2.5 font-medium rounded border-2 border-security-navy-500 bg-security-navy-500 text-white hover:bg-security-navy-600 text-sm transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              WhatsApp
            </Link>
          </DashboardCard>
        ) : (
          <DashboardCard title="WhatsApp">
            <p className="text-xs text-neutral-500 mb-3">Message team members directly</p>
            <p className="text-sm text-neutral-500 py-4">No access</p>
          </DashboardCard>
        )}
      </div>
    </div>
  );
}
