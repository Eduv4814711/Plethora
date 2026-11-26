"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { hasCapability } from "@/lib/permissions";
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
import { CHART_PRIMARY, CHART_SERIES } from "@/lib/chart-theme";
import {
  AlertBanner,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  PageShell,
  Section,
  Select,
  SkeletonBlock,
} from "@/components/ui";

interface ReportsData {
  exportByStatus: { name: string; value: number }[];
  employeesByStatus: { name: string; value: number }[];
  shiftsByStatus: { name: string; value: number }[];
  shiftsOverTime: { month: string; shifts: number }[];
  exportsOverTime: { month: string; workedHours: number; overtimeHours: number; leaveHours: number }[];
  hoursBySite: { name: string; hours: number }[];
}

const COLORS = CHART_SERIES;

export default function ReportsPage() {
  const { token, user } = useAuth();
  const canExport = Boolean(user && hasCapability(user, "/reports", "export"));
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
    if (!token || !canExport) return;
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
  }, [token, canExport]);

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
      <PageShell width="wide" className="animate-fade-in">
        <PageHeader title="Reports" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonBlock key={i} className="h-80 w-full" />
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell width="wide" className="animate-fade-in pb-12">
      <PageHeader
        title="Reports"
        description="Operational metrics across team members, shifts, attendance, and Sage payroll exports."
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="reports-period" className="text-xs font-medium text-security-navy-600">
              Show
            </label>
            <Select
              id="reports-period"
              density="compact"
              value={payPeriodCount}
              onChange={(e) => setPayPeriodCount(Number(e.target.value))}
              className="w-auto"
            >
              <option value={3}>Last 3 periods</option>
              <option value={6}>Last 6 periods</option>
              <option value={12}>Last 12 periods</option>
              <option value={24}>Last 24 periods</option>
            </Select>
          </div>
        }
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {canExport && (
        <Card className="p-5">
          <Section
            title="Export operational reports"
            description="Download attendance, incidents, and performance reports for sharing or records."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="From">
                <Input type="date" density="compact" value={exportStart} onChange={(e) => setExportStart(e.target.value)} />
              </Field>
              <Field label="To">
                <Input type="date" density="compact" value={exportEnd} onChange={(e) => setExportEnd(e.target.value)} />
              </Field>
              <Field label="Site">
                <Select density="compact" value={exportSiteId} onChange={(e) => setExportSiteId(e.target.value)}>
                  <option value="">All sites</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Client">
                <Select density="compact" value={exportClientId} onChange={(e) => setExportClientId(e.target.value)}>
                  <option value="">All clients</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-end">
              <Field label="Report type" id="extended-report-type" className="min-w-0 flex-1 max-w-md">
                <Select
                  value={selectedReportType}
                  onChange={(e) => setSelectedReportType(e.target.value)}
                >
                  {reportTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={exporting === "csv"}
                  disabled={!selectedReportType || exporting !== null}
                  onClick={() => handleExport("csv")}
                >
                  Export CSV
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={exporting === "excel"}
                  disabled={!selectedReportType || exporting !== null}
                  onClick={() => handleExport("excel")}
                >
                  Export Excel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={exporting === "pdf"}
                  disabled={!selectedReportType || exporting !== null}
                  onClick={() => handleExport("pdf")}
                >
                  Export PDF
                </Button>
              </div>
            </div>
            {exportError && <AlertBanner variant="error">{exportError}</AlertBanner>}
          </Section>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card variant="dashboard" className="p-5">
          <h2 className="mb-4 font-display text-sm font-semibold text-security-navy-900">
            Payroll export batches by status
          </h2>
          {data?.exportByStatus?.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.exportByStatus}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, percent }: { name?: string; percent?: number }) =>
                      `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {data.exportByStatus.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [v ?? 0, "Batches"]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-security-navy-500">
              No payroll export batches have been created for this period.
            </p>
          )}
        </Card>

        <Card variant="dashboard" className="p-5">
          <h2 className="mb-4 font-display text-sm font-semibold text-security-navy-900">
            Team members by status
          </h2>
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
                    label={({ name, percent }: { name?: string; percent?: number }) =>
                      `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
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
            <p className="py-12 text-center text-sm text-security-navy-500">
              No team status data is available for this period.
            </p>
          )}
        </Card>

        <Card variant="dashboard" className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-display text-sm font-semibold text-security-navy-900">
            Shifts scheduled over time
          </h2>
          {data?.shiftsOverTime?.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.shiftsOverTime} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                  <XAxis dataKey="month" className="text-xs" stroke="currentColor" />
                  <YAxis className="text-xs" stroke="currentColor" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      border: "1px solid #e8eaee",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="shifts" fill={CHART_PRIMARY} name="Shifts" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-security-navy-500">
              No shifts were scheduled during this period.
            </p>
          )}
        </Card>

        <Card variant="dashboard" className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-display text-sm font-semibold text-security-navy-900">
            Exported hours over time
          </h2>
          {data?.exportsOverTime?.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.exportsOverTime} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                  <XAxis dataKey="month" className="text-xs" stroke="currentColor" />
                  <YAxis className="text-xs" stroke="currentColor" tickFormatter={(v) => `${v}h`} />
                  <Tooltip
                    formatter={(v) => [`${Number(v ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })} hrs`, ""]}
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      border: "1px solid #e8eaee",
                      borderRadius: "8px",
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="workedHours" stroke={CHART_PRIMARY} name="Worked Hours" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="overtimeHours" stroke="#f59e0b" name="Overtime Hours" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="leaveHours" stroke="#22c55e" name="Paid Leave Hours" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-security-navy-500">
              No locked or exported payroll batches are available for this period.
            </p>
          )}
        </Card>

        <Card variant="dashboard" className="p-5">
          <h2 className="mb-4 font-display text-sm font-semibold text-security-navy-900">
            Shifts by status
          </h2>
          {data?.shiftsByStatus?.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.shiftsByStatus} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                  <XAxis type="number" className="text-xs" stroke="currentColor" />
                  <YAxis type="category" dataKey="name" width={70} className="text-xs" stroke="currentColor" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      border: "1px solid #e8eaee",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="value" fill={CHART_PRIMARY} name="Shifts" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-security-navy-500">
              No site hour totals are available for this period.
            </p>
          )}
        </Card>

        <Card variant="dashboard" className="p-5">
          <h2 className="mb-4 font-display text-sm font-semibold text-security-navy-900">
            Hours worked by site (Top 10)
          </h2>
          {data?.hoursBySite?.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.hoursBySite} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                  <XAxis type="number" className="text-xs" stroke="currentColor" />
                  <YAxis type="category" dataKey="name" width={70} className="text-xs" stroke="currentColor" tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(v) => [`${Number(v ?? 0).toFixed(1)} hrs`, "Hours"]}
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      border: "1px solid #e8eaee",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="hours" fill="#22c55e" name="Hours" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-security-navy-500">
              No attendance trend data is available for this period.
            </p>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
