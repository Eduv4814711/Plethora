"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { format, differenceInCalendarDays, parseISO } from "date-fns";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { DateInput } from "@/components/date-input";
import { useConfirmDialog } from "@/components/ui";

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

interface LeaveRecordRange {
  id: string;
  employee: LeaveRecord["employee"];
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  hours: string;
}

function groupLeaveRecordsIntoRanges(records: LeaveRecord[]): LeaveRecordRange[] {
  if (records.length === 0) return [];

  const sorted = [...records].sort((a, b) => {
    const byEmployee = a.employee.id.localeCompare(b.employee.id);
    if (byEmployee !== 0) return byEmployee;
    const byType = a.type.localeCompare(b.type);
    if (byType !== 0) return byType;
    return a.date.localeCompare(b.date);
  });

  const ranges: LeaveRecordRange[] = [];
  let current: LeaveRecordRange | null = null;

  for (const record of sorted) {
    const dateKey = record.date.slice(0, 10);

    if (
      current &&
      current.employee.id === record.employee.id &&
      current.type === record.type &&
      differenceInCalendarDays(parseISO(dateKey), parseISO(current.endDate)) === 1
    ) {
      current.endDate = dateKey;
      current.days += 1;
    } else {
      if (current) ranges.push(current);
      current = {
        id: `${record.employee.id}-${record.type}-${dateKey}`,
        employee: record.employee,
        type: record.type,
        startDate: dateKey,
        endDate: dateKey,
        days: 1,
        hours: record.hours,
      };
    }
  }
  if (current) ranges.push(current);

  return ranges.sort((a, b) => b.startDate.localeCompare(a.startDate));
}

function formatLeavePeriod(startDate: string, endDate: string): string {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  if (startDate === endDate) return format(start, "d MMM yyyy");
  if (format(start, "MMM yyyy") === format(end, "MMM yyyy")) {
    return `${format(start, "d")} – ${format(end, "d MMM yyyy")}`;
  }
  if (format(start, "yyyy") === format(end, "yyyy")) {
    return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
  }
  return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
}

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200",
  approved: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200",
  rejected: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200",
};

export default function LeaveManagementPage() {
  const { token } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
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
  const [addForm, setAddForm] = useState({ employeeId: "", startDate: "", endDate: "", type: "annual" as string, hours: "8" });
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingRange, setEditingRange] = useState<LeaveRecordRange | null>(null);
  const [editForm, setEditForm] = useState({ startDate: "", endDate: "", type: "annual" as string, hours: "8" });
  const [editError, setEditError] = useState<string | null>(null);
  const [recordActionId, setRecordActionId] = useState<string | null>(null);
  const [recordsActionError, setRecordsActionError] = useState<string | null>(null);

  const groupedRecords = useMemo(() => groupLeaveRecordsIntoRanges(records), [records]);

  const editDayCount =
    editForm.startDate && editForm.endDate
      ? differenceInCalendarDays(parseISO(editForm.endDate), parseISO(editForm.startDate)) + 1
      : editForm.startDate
        ? 1
        : 0;

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
        const list = (d.data || []).filter((e: { status: string }) =>
          ["active", "training", "hired", "reliever"].includes(e.status)
        );
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

  const leaveDayCount =
    addForm.startDate && addForm.endDate
      ? differenceInCalendarDays(parseISO(addForm.endDate), parseISO(addForm.startDate)) + 1
      : addForm.startDate
        ? 1
        : 0;

  const handleAddLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !addForm.employeeId || !addForm.startDate) return;
    const endDate = addForm.endDate || addForm.startDate;
    if (parseISO(endDate) < parseISO(addForm.startDate)) {
      setAddError("End date must be on or after start date");
      return;
    }
    setSaving(true);
    setAddError(null);
    try {
      const res = await authFetch("/payroll/leave-records", token, {
        method: "POST",
        body: JSON.stringify({
          employeeId: addForm.employeeId,
          date: addForm.startDate,
          endDate: endDate !== addForm.startDate ? endDate : undefined,
          type: addForm.type,
          hours: parseFloat(addForm.hours) || 8,
        }),
      });
      if (res.ok) {
        setAddForm({ employeeId: "", startDate: "", endDate: "", type: "annual", hours: "8" });
        loadRecords();
        setTab("records");
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

  const openEditRange = (range: LeaveRecordRange) => {
    setEditingRange(range);
    setEditForm({
      startDate: range.startDate,
      endDate: range.endDate,
      type: range.type,
      hours: range.hours,
    });
    setEditError(null);
  };

  const closeEditRange = () => {
    setEditingRange(null);
    setEditError(null);
  };

  const handleUpdateLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editingRange || !editForm.startDate) return;
    const endDate = editForm.endDate || editForm.startDate;
    if (parseISO(endDate) < parseISO(editForm.startDate)) {
      setEditError("End date must be on or after start date");
      return;
    }
    setRecordActionId(editingRange.id);
    setEditError(null);
    try {
      const res = await authFetch("/payroll/leave-records/range", token, {
        method: "PUT",
        body: JSON.stringify({
          employeeId: editingRange.employee.id,
          type: editingRange.type,
          startDate: editingRange.startDate,
          endDate: editingRange.endDate,
          newStartDate: editForm.startDate,
          newEndDate: endDate !== editForm.startDate ? endDate : undefined,
          newType: editForm.type,
          hours: parseFloat(editForm.hours) || 8,
        }),
      });
      if (res.ok) {
        closeEditRange();
        loadRecords();
      } else {
        const err = await res.json().catch(() => ({}));
        setEditError(err?.message || "Failed to update leave");
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update leave");
    } finally {
      setRecordActionId(null);
    }
  };

  const handleDeleteRange = async (range: LeaveRecordRange) => {
    const confirmed = await confirm({
      title: "Delete leave record",
      message: `Remove ${range.employee.firstName} ${range.employee.lastName}'s ${LEAVE_TYPE_MAP[range.type] ?? range.type} for ${formatLeavePeriod(range.startDate, range.endDate)}?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed || !token) return;

    setRecordActionId(range.id);
    setRecordsActionError(null);
    try {
      const res = await authFetch("/payroll/leave-records/range", token, {
        method: "DELETE",
        body: JSON.stringify({
          employeeId: range.employee.id,
          type: range.type,
          startDate: range.startDate,
          endDate: range.endDate,
        }),
      });
      const err = await res.json().catch(() => ({}));
      if (res.ok) {
        loadRecords();
      } else {
        setRecordsActionError(
          typeof err?.message === "string"
            ? err.message
            : typeof err?.error === "string"
              ? err.error
              : "Failed to delete leave"
        );
      }
    } catch (err) {
      setRecordsActionError(err instanceof Error ? err.message : "Failed to delete leave");
    } finally {
      setRecordActionId(null);
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
      {confirmDialog}
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
          <h1 className="page-title">Leave</h1>
          <p className="text-neutral-600 dark:text-neutral-400 mt-0.5 text-sm">
            Record and approve leave for your team, in line with South African labour law (BCEA).
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
          {recordsActionError && (
            <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg">
              {recordsActionError}
            </div>
          )}
          <div className="card-wireframe overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-800/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Employee</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Leave type</th>
                  <th className="px-4 py-3 text-left font-medium text-neutral-700 dark:text-neutral-300">Period</th>
                  <th className="px-4 py-3 text-right font-medium text-neutral-700 dark:text-neutral-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groupedRecords.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                    <td className="px-4 py-3">
                      <Link href={`/employees?q=${encodeURIComponent(r.employee.employeeNumber)}`} className="font-medium text-neutral-900 dark:text-white hover:underline">
                        {r.employee.firstName} {r.employee.lastName}
                      </Link>
                      <span className="text-neutral-500 dark:text-neutral-400 ml-1">({r.employee.employeeNumber})</span>
                    </td>
                    <td className="px-4 py-3">{LEAVE_TYPE_MAP[r.type] ?? r.type}</td>
                    <td className="px-4 py-3">
                      {formatLeavePeriod(r.startDate, r.endDate)}
                      {r.days > 1 && (
                        <span className="text-neutral-500 dark:text-neutral-400 ml-1.5">({r.days} days)</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditRange(r)}
                          disabled={recordActionId === r.id}
                          className="px-2 py-1 text-xs font-medium rounded border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRange(r)}
                          disabled={recordActionId === r.id}
                          className="px-2 py-1 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {recordActionId === r.id ? "..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {groupedRecords.length === 0 && <p className="text-neutral-500 py-12 text-center">No leave records for this filter</p>}

          {editingRange && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <div className="card-wireframe p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
                <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-1">Edit leave</h2>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
                  {editingRange.employee.firstName} {editingRange.employee.lastName} ({editingRange.employee.employeeNumber})
                </p>
                {editError && (
                  <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    {editError}
                  </div>
                )}
                <form onSubmit={handleUpdateLeave} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Start date</label>
                      <DateInput
                        value={editForm.startDate}
                        onChange={(d) =>
                          setEditForm((f) => ({
                            ...f,
                            startDate: d,
                            endDate: f.endDate && d && parseISO(f.endDate) < parseISO(d) ? d : f.endDate,
                          }))
                        }
                        className="input-modern w-full"
                        ariaLabel="Leave start date"
                        showToday
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">End date</label>
                      <DateInput
                        value={editForm.endDate}
                        onChange={(d) => setEditForm((f) => ({ ...f, endDate: d }))}
                        className="input-modern w-full"
                        ariaLabel="Leave end date"
                        showToday
                        placeholder="Same as start if single day"
                      />
                    </div>
                  </div>
                  {editDayCount > 0 && (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 -mt-2">
                      {editDayCount} calendar day{editDayCount === 1 ? "" : "s"}
                    </p>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Leave type</label>
                    <select
                      value={editForm.type}
                      onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}
                      className="input-modern w-full"
                    >
                      {SA_LEAVE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Hours per day</label>
                    <input
                      type="number"
                      min="0"
                      max="24"
                      step="0.5"
                      value={editForm.hours}
                      onChange={(e) => setEditForm((f) => ({ ...f, hours: e.target.value }))}
                      className="input-modern w-full"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button type="submit" disabled={!!recordActionId || !editForm.startDate} className="btn-primary">
                      {recordActionId ? "Saving…" : "Save changes"}
                    </button>
                    <button type="button" onClick={closeEditRange} className="btn-secondary">
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "add" && (
        <div className="card-wireframe p-6 max-w-md">
          <h2 className="section-title text-neutral-900 dark:text-neutral-100 mb-4">Add Leave Record</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
            Record approved leave directly (e.g. after approving a request, or for manual entries). Choose a date range — the employee will be marked unavailable for rostering on each day.
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">Start date</label>
                <DateInput
                  value={addForm.startDate}
                  onChange={(d) =>
                    setAddForm((f) => ({
                      ...f,
                      startDate: d,
                      endDate: f.endDate && d && parseISO(f.endDate) < parseISO(d) ? d : f.endDate,
                    }))
                  }
                  className="input-modern w-full"
                  ariaLabel="Leave start date"
                  showToday
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5">End date</label>
                <DateInput
                  value={addForm.endDate}
                  onChange={(d) => setAddForm((f) => ({ ...f, endDate: d }))}
                  className="input-modern w-full"
                  ariaLabel="Leave end date"
                  showToday
                  placeholder="Same as start if single day"
                />
              </div>
            </div>
            {leaveDayCount > 0 && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400 -mt-2">
                {leaveDayCount} calendar day{leaveDayCount === 1 ? "" : "s"} — guard will show as on leave (L/SL) in rostering.
              </p>
            )}
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
            <button type="submit" disabled={saving || !addForm.startDate} className="btn-primary">
              {saving ? "Adding…" : leaveDayCount > 1 ? `Add ${leaveDayCount} days leave` : "Add Leave"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
