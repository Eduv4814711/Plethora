"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { AlertBanner, Button, PageHeader, TableEmptyRow, TableLoadingRow } from "@/components/ui";

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
  const [loading, setLoading] = useState(false);

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    academyApi
      .listAuditLogs(token, { limit: 100, action: action || undefined, entityType: entityType || undefined })
      .then((r) => setRows((r.logs as LogRow[]) ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load Academy audit events."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  return (
    <div className="w-full min-w-0 space-y-6">
      <PageHeader
        title="Audit Logs"
        description="Search and inspect Academy audit events by action and entity type."
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Filters</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label>
            <span className="label-text mb-1 block">Action</span>
            <input id="academy-audit-action" className="input-modern rounded-xl" value={action} onChange={(e) => setAction(e.target.value)} />
          </label>
          <label>
            <span className="label-text mb-1 block">Entity type</span>
            <input id="academy-audit-entity" className="input-modern rounded-xl" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
          </label>
          <Button onClick={load} loading={loading}>
            Apply filters
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200/80 px-5 py-4"><h2 className="text-base font-semibold text-security-navy-900">Audit stream</h2></div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-sm">
            <caption className="sr-only">Academy audit events</caption>
            <thead><tr className="text-[11px] uppercase tracking-wide text-neutral-500"><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">User</th></tr></thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={4} label="Loading audit events..." />
              ) : rows.length === 0 ? (
                <TableEmptyRow colSpan={4} message="No audit events match the selected filters." />
              ) : (
                rows.map((r)=><tr key={r.id} className="text-sm"><td>{new Date(r.timestamp).toLocaleString()}</td><td className="font-medium text-security-navy-900">{r.action}</td><td>{r.entityType}</td><td>{r.user?.name ?? "—"}</td></tr>)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
