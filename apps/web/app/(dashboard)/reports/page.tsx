"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
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

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    authFetch(`/reports?payPeriodCount=${payPeriodCount}`, token)
      .then((r) => r.json())
      .then(setData)
      .catch((err) => {
        console.error(err);
        setError("Unable to load reports. Check the connection and try again.");
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
