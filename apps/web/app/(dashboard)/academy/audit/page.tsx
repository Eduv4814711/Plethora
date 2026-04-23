"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

interface LogRow {
  id: string;
  action: string;
  entityType: string;
  timestamp: string;
  user?: { name?: string | null } | null;
}

export default function AcademyAuditPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    academyApi
      .listAuditLogs(token, { limit: 100, action: action || undefined, entityType: entityType || undefined })
      .then((r) => setRows((r.logs as LogRow[]) ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  };

  useEffect(load, [token]);

  return (
    <div className="w-full min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-security-navy-900">Audit Logs</h1>
        <p className="mt-1 text-sm text-base-content/70">Search and inspect Academy audit events by action and entity type.</p>
      </div>

      {error && <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>}

      <div className="rounded-2xl border border-base-200 bg-base-100 p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-base-content/60">Filters</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="input input-bordered rounded-xl" placeholder="Filter action" value={action} onChange={(e) => setAction(e.target.value)} />
          <input className="input input-bordered rounded-xl" placeholder="Filter entity type" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
          <button className="btn rounded-xl" onClick={load}>Apply</button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-base-200 bg-base-100 shadow-sm">
        <div className="border-b border-base-200/80 px-5 py-4"><h2 className="text-base font-semibold text-security-navy-900">Audit stream</h2></div>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-base-content/60"><th>Time</th><th>Action</th><th>Entity</th><th>User</th></tr></thead>
            <tbody>{rows.map((r)=><tr key={r.id} className="text-sm"><td>{new Date(r.timestamp).toLocaleString()}</td><td className="font-medium text-security-navy-900">{r.action}</td><td>{r.entityType}</td><td>{r.user?.name ?? "—"}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
