"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { hasCapability } from "@/lib/permissions";

interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  outcome: string;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  actorLabel: string | null;
  timestamp: string;
  user: { id: string; name: string; email: string } | null;
}

interface Filters {
  action: string;
  userId: string;
  outcome: string;
  from: string;
  to: string;
  search: string;
}

const EMPTY_FILTERS: Filters = { action: "", userId: "", outcome: "", from: "", to: "", search: "" };
const PAGE_SIZE = 50;

const OUTCOME_STYLES: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  denied: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  failure: "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
};

/** Groups the long tail of dotted action names into pickable families. */
function actionFamily(action: string): string {
  return action.split(".")[0];
}

function buildQuery(filters: Filters, offset: number): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (filters.action) params.set("action", filters.action);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.search) params.set("search", filters.search);
  // Dates arrive as yyyy-mm-dd; widen "to" to the end of that day.
  if (filters.from) params.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) params.set("to", new Date(`${filters.to}T23:59:59.999`).toISOString());
  return params.toString();
}

export default function AuditPage() {
  const { token, user } = useAuth();
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [actors, setActors] = useState<{ id: string; name: string; email: string }[]>([]);
  const [actions, setActions] = useState<{ action: string; count: number }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canExport = Boolean(user && hasCapability(user, "/audit", "export"));

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/audit?${buildQuery(filters, offset)}`, token);
      if (!res.ok) throw new Error("Access denied. Audit viewing access is required.");
      const body = await res.json();
      setLogs(body.data ?? []);
      setTotal(body.total ?? 0);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load the audit log");
    } finally {
      setLoading(false);
    }
  }, [token, filters, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token) return;
    authFetch("/audit/filters", token)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body) return;
        setActors(body.actors ?? []);
        setActions(body.actions ?? []);
      })
      .catch(() => {
        // Filter options are a convenience; the table still works without them.
      });
  }, [token]);

  const updateFilter = (patch: Partial<Filters>) => {
    setOffset(0);
    setFilters((current) => ({ ...current, ...patch }));
  };

  const exportCsv = async () => {
    if (!token) return;
    setExporting(true);
    try {
      const res = await authFetch(`/audit/export.csv?${buildQuery(filters, 0)}`, token);
      if (!res.ok) throw new Error("Failed to export the audit log");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Failed to export the audit log");
    } finally {
      setExporting(false);
    }
  };

  const families = [...new Set(actions.map((entry) => actionFamily(entry.action)))].sort();

  if (error && !logs.length) {
    return (
      <div>
        <h1 className="page-title">Audit Logs</h1>
        <p className="mt-4 text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Audit Logs</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Who did what, when, and from where — including sign-ins and refused access attempts.
          </p>
        </div>
        {canExport && (
          <button type="button" className="btn-secondary" disabled={exporting} onClick={() => void exportCsv()}>
            {exporting ? "Preparing…" : "Export CSV"}
          </button>
        )}
      </div>

      <div className="card-wireframe mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          Actor
          <select
            className="input-modern mt-1 w-full"
            value={filters.userId}
            onChange={(event) => updateFilter({ userId: event.target.value })}
          >
            <option value="">Anyone</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          Activity
          <select
            className="input-modern mt-1 w-full"
            value={filters.action}
            onChange={(event) => updateFilter({ action: event.target.value })}
          >
            <option value="">Everything</option>
            {families.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          Outcome
          <select
            className="input-modern mt-1 w-full"
            value={filters.outcome}
            onChange={(event) => updateFilter({ outcome: event.target.value })}
          >
            <option value="">Any</option>
            <option value="success">Succeeded</option>
            <option value="denied">Denied</option>
            <option value="failure">Failed</option>
          </select>
        </label>
        <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          From
          <input
            type="date"
            className="input-modern mt-1 w-full"
            value={filters.from}
            onChange={(event) => updateFilter({ from: event.target.value })}
          />
        </label>
        <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          To
          <input
            type="date"
            className="input-modern mt-1 w-full"
            value={filters.to}
            onChange={(event) => updateFilter({ to: event.target.value })}
          />
        </label>
        <label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          Search
          <input
            className="input-modern mt-1 w-full"
            placeholder="Action, record or person"
            value={filters.search}
            onChange={(event) => updateFilter({ search: event.target.value })}
          />
        </label>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card-wireframe overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-700">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Date &amp; time</th>
                <th className="px-4 py-2.5 text-left font-semibold">User</th>
                <th className="px-4 py-2.5 text-left font-semibold">Action</th>
                <th className="px-4 py-2.5 text-left font-semibold">Outcome</th>
                <th className="px-4 py-2.5 text-left font-semibold">Record</th>
                <th className="px-4 py-2.5 text-left font-semibold">From</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                [1, 2, 3, 4, 5].map((row) => (
                  <tr key={row} className="border-t border-neutral-200 dark:border-neutral-700">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                    </td>
                  </tr>
                ))}
              {!loading &&
                logs.map((log) => (
                  <Fragment key={log.id}>
                    <tr
                      className="cursor-pointer border-t border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                      onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 text-neutral-600 dark:text-neutral-400">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">{log.user?.name ?? log.actorLabel ?? "—"}</td>
                      <td className="px-4 py-2.5 font-medium">{log.action}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                            OUTCOME_STYLES[log.outcome] ?? OUTCOME_STYLES.success
                          }`}
                        >
                          {log.outcome}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {log.entityType}
                        {log.entityId && (
                          <span className="font-mono text-xs text-neutral-500"> #{log.entityId.slice(0, 8)}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-neutral-500">
                        {log.ipAddress ?? "—"}
                      </td>
                    </tr>
                    {expanded === log.id && (
                      <tr className="border-t border-neutral-200 dark:border-neutral-700">
                        <td colSpan={6} className="bg-neutral-50 px-4 py-3 dark:bg-neutral-800/60">
                          <dl className="grid gap-2 text-xs sm:grid-cols-3">
                            <div>
                              <dt className="font-semibold text-neutral-500">User agent</dt>
                              <dd className="break-all text-neutral-700 dark:text-neutral-300">
                                {log.userAgent ?? "—"}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-neutral-500">Request id</dt>
                              <dd className="font-mono text-neutral-700 dark:text-neutral-300">
                                {log.requestId ?? "—"}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-neutral-500">Record id</dt>
                              <dd className="font-mono break-all text-neutral-700 dark:text-neutral-300">
                                {log.entityId ?? "—"}
                              </dd>
                            </div>
                          </dl>
                          {log.metadata && (
                            <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-white p-3 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-600">
                    Nothing matches these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-neutral-600">
        <span>
          {total === 0
            ? "No entries"
            : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={offset === 0}
            onClick={() => setOffset((current) => Math.max(current - PAGE_SIZE, 0))}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((current) => current + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
