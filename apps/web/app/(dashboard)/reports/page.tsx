"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import {
  downloadExtendedReport,
  listExtendedReportTypes,
  type ExtendedReportType,
} from "@/lib/msr-api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";

interface ReportsData {
  payrollByStatus: { name: string; value: number }[];
  employeesByStatus: { name: string; value: number }[];
  shiftsByStatus: { name: string; value: number }[];
  shiftsOverTime: { month: string; shifts: number }[];
  payrollOverTime: { month: string; gross: number; net: number }[];
  hoursBySite: { name: string; hours: number }[];
}

const COLORS = ["#F57C00", "#f59e0b", "#10b981", "#ef4444", "#64748b", "#92400e"];

export default function ReportsPage() {
  const { token } = useAuth();
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [payPeriodCount, setPayPeriodCount] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [reportTypes, setReportTypes] = useState<ExtendedReportType[]>([]);
  const [selectedReportType, setSelectedReportType] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportStart, setExportStart] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [exportEnd, setExportEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [exportSiteId, setExportSiteId] = useState("");
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [exportClientId, setExportClientId] = useState("");

  useEffect(() => {
    if (!token) return;
    Promise.all([
      authFetch("/sites?limit=200", token).then((r) => r.json()),
      import("@/lib/msr-api").then(({ listClients }) => listClients(token)),
    ])
      .then(([sitesRes, clientList]) => {
        setSites((sitesRes.data ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
        setClients(clientList.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {
        setSites([]);
        setClients([]);
      });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    listExtendedReportTypes(token)
      .then((r) => {
        setReportTypes(r.types);
        if (r.types[0]) setSelectedReportType(r.types[0].id);
      })
      .catch(() => setReportTypes([]));
  }, [token]);

  const handleExport = async (format: "csv" | "excel" | "pdf") => {
    if (!token || !selectedReportType) return;
    setExporting(format);
    setExportError(null);
    try {
      await downloadExtendedReport(token, selectedReportType, format, {
        startDate: exportStart,
        endDate: exportEnd,
        ...(exportSiteId ? { siteId: exportSiteId } : {}),
        ...(exportClientId ? { clientId: exportClientId } : {}),
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    authFetch(`/reports?payPeriodCount=${payPeriodCount}`, token)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(
            (body as { message?: string; error?: string }).message ||
              (body as { error?: string }).error ||
              "Unable to load reports"
          );
        }
        return r.json();
      })
      .then(setData)
      .catch((err) => {
        console.error(err);
        setError(err instanceof Error ? err.message : "Unable to load reports. Check the connection and try again.");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [token, payPeriodCount]);

  if (loading) {
    return (
      <div className="animate-fade-in">
        <h1 className="page-title mb-6">Reports</h1>
        <div className="animate-pulse grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-80 bg-neutral-200 dark:bg-neutral-700 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="text-neutral-600 dark:text-neutral-400 mt-0.5 text-sm">
            Charts showing your team, shifts, attendance, and payroll over time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="reports-period" className="text-sm text-neutral-600 dark:text-neutral-400">Show:</label>
          <select
            id="reports-period"
            value={payPeriodCount}
            onChange={(e) => setPayPeriodCount(Number(e.target.value))}
            className="input-compact w-auto"
          >
            <option value={3}>Last 3 periods</option>
            <option value={6}>Last 6 periods</option>
            <option value={12}>Last 12 periods</option>
            <option value={24}>Last 24 periods</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-security border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="card-dashboard mb-8 p-5">
        <h2 className="section-title text-neutral-900 mb-1">Export operational reports</h2>
        <p className="text-sm text-neutral-600 mb-4">
          Download attendance, incidents, and performance reports for sharing or records.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="label-text block mb-1">From</label>
            <input type="date" className="input-modern w-full" value={exportStart} onChange={(e) => setExportStart(e.target.value)} />
          </div>
          <div>
            <label className="label-text block mb-1">To</label>
            <input type="date" className="input-modern w-full" value={exportEnd} onChange={(e) => setExportEnd(e.target.value)} />
          </div>
          <div>
            <label className="label-text block mb-1">Site</label>
            <select className="input-modern w-full" value={exportSiteId} onChange={(e) => setExportSiteId(e.target.value)}>
              <option value="">All sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-text block mb-1">Client</label>
            <select className="input-modern w-full" value={exportClientId} onChange={(e) => setExportClientId(e.target.value)}>
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 min-w-0">
            <label htmlFor="extended-report-type" className="label-text block mb-1">Report type</label>
            <select
              id="extended-report-type"
              value={selectedReportType}
              onChange={(e) => setSelectedReportType(e.target.value)}
              className="input-modern w-full max-w-md"
            >
              {reportTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-sm py-2"
              disabled={!selectedReportType || exporting !== null}
              onClick={() => handleExport("csv")}
            >
              {exporting === "csv" ? "Exporting…" : "Export CSV"}
            </button>
            <button
              type="button"
              className="btn-secondary text-sm py-2"
              disabled={!selectedReportType || exporting !== null}
              onClick={() => handleExport("excel")}
            >
              {exporting === "excel" ? "Exporting…" : "Export Excel"}
            </button>
            <button
              type="button"
              className="btn-primary text-sm py-2"
              disabled={!selectedReportType || exporting !== null}
              onClick={() => handleExport("pdf")}
            >
              {exporting === "pdf" ? "Exporting…" : "Export PDF"}
            </button>
          </div>
        </div>
        {exportError && (
          <p className="mt-3 text-sm text-red-600" role="alert">{exportError}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payroll by status - Pie */}
        <div className="card-elevated p-6">
          <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-4">Payroll Runs by Status</h2>
          {data?.payrollByStatus?.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.payrollByStatus}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, percent }: { name: string; percent?: number }) =>
                      `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {data.payrollByStatus.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [v ?? 0, "Runs"]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-neutral-500 dark:text-neutral-400 py-12 text-center">No payroll runs have been calculated for this period.</p>
          )}
        </div>

        {/* Employees by status - Pie */}
        <div className="card-elevated p-6">
          <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-4">Team Members by Status</h2>
          {data?.employeesByStatus?.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.employeesByStatus}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, percent }: { name: string; percent?: number }) =>
                      `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {data.employeesByStatus.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [v ?? 0, "Employees"]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-neutral-500 dark:text-neutral-400 py-12 text-center">No team status data is available for this period.</p>
          )}
        </div>

        {/* Shifts over time - Bar */}
        <div className="card-elevated p-6 lg:col-span-2">
          <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-4">Shifts Scheduled Over Time</h2>
          {data?.shiftsOverTime?.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.shiftsOverTime} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-neutral-200 dark:stroke-neutral-700" />
                  <XAxis dataKey="month" className="text-xs" stroke="currentColor" />
                  <YAxis className="text-xs" stroke="currentColor" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--card-border)",
                      borderRadius: "4px",
                    }}
                  />
                  <Bar dataKey="shifts" fill="#F57C00" name="Shifts" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-neutral-500 dark:text-neutral-400 py-12 text-center">No shifts were scheduled during this period.</p>
          )}
        </div>

        {/* Payroll over time - Line */}
        <div className="card-elevated p-6 lg:col-span-2">
          <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-4">Payroll Totals Over Time</h2>
          {data?.payrollOverTime?.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.payrollOverTime} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-neutral-200 dark:stroke-neutral-700" />
                  <XAxis dataKey="month" className="text-xs" stroke="currentColor" />
                  <YAxis className="text-xs" stroke="currentColor" tickFormatter={(v) => `R${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v) => [`R${Number(v ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`, ""]}
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--card-border)",
                      borderRadius: "4px",
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="gross" stroke="#F57C00" name="Gross Pay" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="net" stroke="#22c55e" name="Net Pay" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-neutral-500 dark:text-neutral-400 py-12 text-center">No payroll totals are available for this period.</p>
          )}
        </div>

        {/* Shifts by status - Bar */}
        <div className="card-elevated p-6">
          <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-4">Shifts by Status</h2>
          {data?.shiftsByStatus?.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.shiftsByStatus} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-neutral-200 dark:stroke-neutral-700" />
                  <XAxis type="number" className="text-xs" stroke="currentColor" />
                  <YAxis type="category" dataKey="name" width={70} className="text-xs" stroke="currentColor" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--card-border)",
                      borderRadius: "4px",
                    }}
                  />
                  <Bar dataKey="value" fill="#F57C00" name="Shifts" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-neutral-500 dark:text-neutral-400 py-12 text-center">No site hour totals are available for this period.</p>
          )}
        </div>

        {/* Hours by site - Bar */}
        <div className="card-elevated p-6">
          <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-4">Hours Worked by Site (Top 10)</h2>
          {data?.hoursBySite?.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.hoursBySite} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-neutral-200 dark:stroke-neutral-700" />
                  <XAxis type="number" className="text-xs" stroke="currentColor" />
                  <YAxis type="category" dataKey="name" width={70} className="text-xs" stroke="currentColor" tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(v) => [`${Number(v ?? 0).toFixed(1)} hrs`, "Hours"]}
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--card-border)",
                      borderRadius: "4px",
                    }}
                  />
                  <Bar dataKey="hours" fill="#22c55e" name="Hours" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-neutral-500 dark:text-neutral-400 py-12 text-center">No attendance trend data is available for this period.</p>
          )}
        </div>
      </div>
    </div>
  );
}
