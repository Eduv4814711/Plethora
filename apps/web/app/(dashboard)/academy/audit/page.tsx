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
    <div className="module-shell">
      <div>
        <h1 className="page-title">Audit Logs</h1>
        <p className="mt-2 max-w-2xl text-sm text-black">Search and inspect Academy audit events by action and entity type.</p>
      </div>

      {error && <div className="rounded-security-lg border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      <div className="module-panel">
        <h2 className="section-title">Filters</h2>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <input className="input-modern w-full sm:max-w-xs" placeholder="Filter action" value={action} onChange={(e) => setAction(e.target.value)} />
          <input className="input-modern w-full sm:max-w-xs" placeholder="Filter entity type" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
          <button type="button" className="btn-secondary min-h-11 w-full sm:w-auto" onClick={load}>Apply</button>
        </div>
      </div>

      <div className="module-panel overflow-hidden p-0">
        <div className="border-b border-neutral-200 bg-neutral-50/80 px-4 py-3 sm:px-5 sm:py-4">
          <h2 className="section-title normal-case tracking-tight text-base font-semibold">Audit stream</h2>
        </div>
        <div className="table-scroll rounded-none border-0 shadow-none">
          <table className="table-module">
            <thead><tr className="text-[11px] uppercase tracking-wide text-sm text-black"><th>Time</th><th>Action</th><th>Entity</th><th>User</th></tr></thead>
            <tbody>{rows.map((r)=><tr key={r.id} className="text-sm"><td>{new Date(r.timestamp).toLocaleString()}</td><td className="font-medium text-security-navy-900">{r.action}</td><td>{r.entityType}</td><td>{r.user?.name ?? "—"}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
