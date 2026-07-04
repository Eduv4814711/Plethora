"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  timestamp: string;
  user: { name: string; email: string } | null;
}

export default function AuditPage() {
  const { token } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    authFetch("/audit?limit=50", token)
      .then((r) => {
        if (!r.ok) throw new Error("Forbidden");
        return r.json();
      })
      .then((d) => setLogs(d.data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-neutral-200 dark:bg-neutral-700 rounded w-48 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-neutral-200 dark:bg-neutral-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-neutral-800 dark:text-white mb-6">
          Audit Logs
        </h1>
        <p className="text-red-600">Access denied. Admin role required.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="page-title">Audit Logs</h1>
        <p className="mt-1 text-sm text-neutral-600">
          A record of who changed what, and when. Showing the 50 most recent changes.
        </p>
      </div>

      <div className="card-wireframe overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-700">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Date & time</th>
                <th className="px-4 py-2.5 text-left font-semibold">User</th>
                <th className="px-4 py-2.5 text-left font-semibold">Action</th>
                <th className="px-4 py-2.5 text-left font-semibold">Record</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="border-t border-neutral-200 dark:border-neutral-700"
                >
                  <td className="px-4 py-2.5 whitespace-nowrap text-neutral-600 dark:text-neutral-400">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    {log.user?.name ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{log.action}</td>
                  <td className="px-4 py-2.5">
                    {log.entityType}
                    {log.entityId && (
                      <span className="font-mono text-xs text-neutral-500"> #{log.entityId.slice(0, 8)}</span>
                    )}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-neutral-600">
                    No changes recorded yet. Activity will appear here as people use the system.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
