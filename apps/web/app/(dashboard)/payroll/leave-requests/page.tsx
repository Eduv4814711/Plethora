"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";

interface LeaveRequest {
  id: string;
  date: string;
  type: string;
  hours: string;
  status: string;
  reason: string | null;
  createdAt: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeNumber: string;
  };
}

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200",
  approved: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200",
  rejected: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200",
};

export default function LeaveRequestsPage() {
  const { token } = useAuth();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    const params = statusFilter ? `?status=${statusFilter}` : "";
    authFetch(`/payroll/leave-requests${params}`, token)
      .then((r) => r.json())
      .then((d) => setRequests(d.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, statusFilter]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    load();
  }, [token, load]);

  const handleApprove = async (id: string) => {
    if (!token) return;
    setActioning(id);
    try {
      const res = await authFetch(`/payroll/leave-requests/${id}/approve`, token, {
        method: "POST",
      });
      if (res.ok) load();
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
      const res = await authFetch(`/payroll/leave-requests/${id}/reject`, token, {
        method: "POST",
      });
      if (res.ok) load();
    } catch (e) {
      console.error(e);
    } finally {
      setActioning(null);
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
      <div className="flex justify-between items-center mb-8">
        <div>
          <Link href="/payroll" className="text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-400 mb-1 block">
            ← Payroll
          </Link>
          <h1 className="page-title">Leave Requests</h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1 text-sm">
            Approve or reject leave requests submitted by employees (e.g. via WhatsApp)
          </p>
        </div>
        <div className="flex gap-2">
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
                  <Link
                    href="/employees"
                    className="font-medium text-neutral-900 dark:text-white hover:underline"
                  >
                    {req.employee.firstName} {req.employee.lastName}
                  </Link>
                  <span className="text-neutral-500 dark:text-neutral-400 ml-1">
                    ({req.employee.employeeNumber})
                  </span>
                </td>
                <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                  {format(new Date(req.date), "d MMM yyyy")}
                </td>
                <td className="px-4 py-3 capitalize">{req.type}</td>
                <td className="px-4 py-3">{req.hours}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      statusColors[req.status] ?? "bg-neutral-100 dark:bg-neutral-700"
                    }`}
                  >
                    {req.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                  {format(new Date(req.createdAt), "d MMM yyyy HH:mm")}
                </td>
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

      {requests.length === 0 && (
        <p className="text-neutral-500 py-12 text-center">
          No {statusFilter} leave requests
        </p>
      )}
    </div>
  );
}
