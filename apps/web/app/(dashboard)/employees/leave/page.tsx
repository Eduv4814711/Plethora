"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { DateInput } from "@/components/date-input";

/** South African leave types per BCEA (Basic Conditions of Employment Act) */
const SA_LEAVE_TYPES = [
  { value: "annual", label: "Annual Leave", desc: "21 days per year (1 day per 17 days worked)" },
  { value: "sick", label: "Sick Leave", desc: "30 days per 3-year cycle (6 days paid in first 6 months)" },
  { value: "family_responsibility", label: "Family Responsibility", desc: "5 days per year (child birth/illness, family death)" },
  { value: "maternity", label: "Maternity Leave", desc: "4 consecutive months (unpaid, UIF may apply)" },
  { value: "parental", label: "Parental Leave", desc: "10 consecutive days for fathers" },
  { value: "unpaid", label: "Unpaid Leave", desc: "By agreement with employer" },
] as const;

const LEAVE_TYPE_MAP: Record<string, string> = Object.fromEntries(SA_LEAVE_TYPES.map((t) => [t.value, t.label]));

interface LeaveRequest {
  id: string;
  date: string;
  type: string;
  hours: string;
  status: string;
  reason: string | null;
  createdAt: string;
  employee: { id: string; firstName: string; lastName: string; employeeNumber: string };
}

interface LeaveRecord {
  id: string;
  date: string;
  type: string;
  hours: string;
  employee: { id: string; firstName: string; lastName: string; employeeNumber: string };
}

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200",
  approved: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200",
  rejected: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200",
};

export default function LeaveManagementPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<"requests" | "records" | "add">("requests");
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [records, setRecords] = useState<LeaveRecord[]>([]);
  const [employees, setEmployees] = useState<{ id: string; firstName: string; lastName: string; employeeNumber: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [actioning, setActioning] = useState<string | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [addForm, setAddForm] = useState({ employeeId: "", date: "", type: "annual" as string, hours: "8" });
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const loadRequests = useCallback(() => {
    if (!token) return;
    const params = statusFilter ? `?status=${statusFilter}` : "";
    authFetch(`/payroll/leave-requests${params}`, token)
      .then((r) => r.json())
      .then((d) => setRequests(d.data || []))
      .catch(console.error);
  }, [token, statusFilter]);

  const loadRecords = useCallback(() => {
    if (!token) return;
    const params = new URLSearchParams();
    if (employeeFilter) params.set("employeeId", employeeFilter);
    if (dateFrom) params.set("start", dateFrom);
    if (dateTo) params.set("end", dateTo);
    authFetch(`/payroll/leave-records?${params}`, token)
      .then((r) => r.json())
      .then((d) => setRecords(d.data || []))
      .catch(console.error);
  }, [token, employeeFilter, dateFrom, dateTo]);

  const loadEmployees = useCallback(() => {
    if (!token) return;
    authFetch("/employees?limit=500", token)
      .then((r) => r.json())
      .then((d) => {
        const list = (d.data || []).filter((e: { status: string }) => ["active", "training", "hired"].includes(e.status));
        setEmployees(list.map((e: { id: string; firstName: string; lastName: string; employeeNumber: string }) => ({
          id: e.id,
          firstName: e.firstName,
          lastName: e.lastName,
          employeeNumber: e.employeeNumber,
        })));
      })
      .catch(console.error);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    loadEmployees();
    loadRequests();
    loadRecords();
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (tab === "requests") loadRequests();
    else if (tab === "records") loadRecords();
  }, [tab, loadRequests, loadRecords]);

  const handleApprove = async (id: string) => {
    if (!token) return;
    setActioning(id);
    try {
      const res = await authFetch(`/payroll/leave-requests/${id}/approve`, token, { method: "POST" });
      if (res.ok) loadRequests();
    } catch (e) {
      console.error(e);
    } finally {
      setActioning(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!token) return;
    setActioning(id);
    try {
      const res = await authFetch(`/payroll/leave-requests/${id}/reject`, token, { method: "POST" });
      if (res.ok) loadRequests();
    } catch (e) {
      console.error(e);
    } finally {
      setActioning(null);
    }
  };

  const handleAddLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !addForm.employeeId || !addForm.date) return;
    setSaving(true);
    setAddError(null);
    try {
      const res = await authFetch("/payroll/leave-records", token, {
        method: "POST",
        body: JSON.stringify({
          employeeId: addForm.employeeId,
          date: new Date(addForm.date).toISOString().slice(0, 10),
          type: addForm.type,
          hours: parseFloat(addForm.hours) || 8,
        }),
      });
      if (res.ok) {
        setAddForm({ employeeId: "", date: "", type: "annual", hours: "8" });
        loadRecords();
      } else {
        const err = await res.json().catch(() => ({}));
        setAddError(err?.message || "Failed to add leave");
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add leave");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-neutral-200 dark:bg-neutral-700 rounded w-48 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-neutral-200 dark:bg-neutral-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/employees"
          className="p-2.5 rounded-lg border-2 border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all"
          aria-label="Back to team"
        >
          <svg className="w-5 h-5 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="page-title">Leave Management</h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-0.5 text-sm">
            Manage leave requests and records per South African BCEA
          </p>
        </div>
      </div>

      {/* SA Leave info */}
      <div className="card-wireframe p-4 mb-6">
        <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-3">South African Leave Types (BCEA)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
          {SA_LEAVE_TYPES.map((t) => (
            <div key={t.value} className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50">
              <span className="font-medium text-neutral-900 dark:text-neutral-100">{t.label}</span>
              <p className="text-neutral-600 dark:text-neutral-400 mt-0.5 text-xs">{t.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(["requests", "records", "add"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t
                ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            }`}
          >
            {t === "requests" ? "Pending Requests" : t === "records" ? "Leave Records" : "Add Leave"}
          </button>
        ))}
      </div>

      {tab === "requests" && (
        <>
          <div className="flex gap-2 mb-4">
            {(["pending", "approved", "rejected"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  statusFilter === s
                    ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                    : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <div className="card-wireframe overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-800/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Employee</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Hours</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Submitted</th>
                  {statusFilter === "pending" && (
                    <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr
                    key={req.id}
                    className="border-t border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/30"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/employees?q=${encodeURIComponent(req.employee.employeeNumber)}`} className="font-medium text-neutral-900 dark:text-white hover:underline">
                        {req.employee.firstName} {req.employee.lastName}
                      </Link>
                      <span className="text-neutral-500 dark:text-neutral-400 ml-1">({req.employee.employeeNumber})</span>
                    </td>
                    <td className="px-4 py-3">{format(new Date(req.date), "d MMM yyyy")}</td>
                    <td className="px-4 py-3">{LEAVE_TYPE_MAP[req.type] ?? req.type}</td>
                    <td className="px-4 py-3">{req.hours}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusColors[req.status] ?? "bg-neutral-100 dark:bg-neutral-700"}`}>
                        {req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{format(new Date(req.createdAt), "d MMM yyyy HH:mm")}</td>
                    {statusFilter === "pending" && (
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApprove(req.id)}
                            disabled={!!actioning}
                            className="px-2 py-1 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {actioning === req.id ? "..." : "Approve"}
                          </button>
                          <button
                            onClick={() => handleReject(req.id)}
                            disabled={!!actioning}
                            className="px-2 py-1 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {actioning === req.id ? "..." : "Reject"}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {requests.length === 0 && <p className="text-neutral-500 py-12 text-center">No {statusFilter} leave requests</p>}
        </>
      )}

      {tab === "records" && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <select
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
              className="input-modern w-48"
            >
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeNumber})</option>
              ))}
            </select>
            <DateInput value={dateFrom} onChange={setDateFrom} className="input-modern w-40" showToday />
            <DateInput value={dateTo} onChange={setDateTo} className="input-modern w-40" showToday />
            <button onClick={loadRecords} className="btn-secondary text-sm py-2">Apply filters</button>
          </div>
          <div className="card-wireframe overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-800/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Employee</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Hours</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                    <td className="px-4 py-3">
                      <Link href={`/employees?q=${encodeURIComponent(r.employee.employeeNumber)}`} className="font-medium text-neutral-900 dark:text-white hover:underline">
                        {r.employee.firstName} {r.employee.lastName}
                      </Link>
                      <span className="text-neutral-500 dark:text-neutral-400 ml-1">({r.employee.employeeNumber})</span>
                    </td>
                    <td className="px-4 py-3">{format(new Date(r.date), "d MMM yyyy")}</td>
                    <td className="px-4 py-3">{LEAVE_TYPE_MAP[r.type] ?? r.type}</td>
                    <td className="px-4 py-3">{r.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {records.length === 0 && <p className="text-neutral-500 py-12 text-center">No leave records for this filter</p>}
        </>
      )}

      {tab === "add" && (
        <div className="card-wireframe p-6 max-w-md">
          <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-4">Add Leave Record</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
            Record approved leave directly (e.g. after approving a request, or for manual entries).
          </p>
          {addError && (
            <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg">
              {addError}
            </div>
          )}
          <form onSubmit={handleAddLeave} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Employee</label>
              <select
                value={addForm.employeeId}
                onChange={(e) => setAddForm((f) => ({ ...f, employeeId: e.target.value }))}
                className="input-modern w-full"
                required
              >
                <option value="">Select employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeNumber})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Date</label>
              <DateInput value={addForm.date} onChange={(d) => setAddForm((f) => ({ ...f, date: d }))} className="input-modern w-full" showToday required />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Leave Type</label>
              <select
                value={addForm.type}
                onChange={(e) => setAddForm((f) => ({ ...f, type: e.target.value }))}
                className="input-modern w-full"
              >
                {SA_LEAVE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Hours</label>
              <input
                type="number"
                min="0"
                max="24"
                step="0.5"
                value={addForm.hours}
                onChange={(e) => setAddForm((f) => ({ ...f, hours: e.target.value }))}
                className="input-modern w-full"
              />
            </div>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Adding…" : "Add Leave"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
