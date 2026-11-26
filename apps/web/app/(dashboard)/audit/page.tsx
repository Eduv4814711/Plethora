"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { hasCapability } from "@/lib/permissions";
import {
  AlertBanner,
  Button,
  Field,
  Input,
  PageHeader,
  PageShell,
  SearchInput,
  Select,
  StatusBadge,
  TableEmptyRow,
  TableLoadingRow,
  TableShell,
  Toolbar,
} from "@/components/ui";

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
  success: "bg-security-emerald-50 text-security-emerald-700",
  denied: "bg-security-amber-50 text-security-amber-800",
  failure: "bg-red-50 text-red-800",
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
    <PageShell width="default" className="animate-fade-in">
      <PageHeader
        title="Audit Logs"
        description="Who did what, when, and from where — including sign-ins and refused access attempts."
        actions={
          canExport ? (
            <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          ) : undefined
        }
      />

      <Toolbar className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Actor">
          <Select
            density="compact"
            value={filters.userId}
            onChange={(event) => updateFilter({ userId: event.target.value })}
          >
            <option value="">Anyone</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Activity">
          <Select
            density="compact"
            value={filters.action}
            onChange={(event) => updateFilter({ action: event.target.value })}
          >
            <option value="">Everything</option>
            {families.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Outcome">
          <Select
            density="compact"
            value={filters.outcome}
            onChange={(event) => updateFilter({ outcome: event.target.value })}
          >
            <option value="">Any</option>
            <option value="success">Succeeded</option>
            <option value="denied">Denied</option>
            <option value="failure">Failed</option>
          </Select>
        </Field>
        <Field label="From">
          <Input
            density="compact"
            type="date"
            value={filters.from}
            onChange={(event) => updateFilter({ from: event.target.value })}
          />
        </Field>
        <Field label="To">
          <Input
            density="compact"
            type="date"
            value={filters.to}
            onChange={(event) => updateFilter({ to: event.target.value })}
          />
        </Field>
        <Field label="Search">
          <SearchInput
            density="compact"
            placeholder="Action, record or person"
            value={filters.search}
            onChange={(val) => updateFilter({ search: val })}
          />
        </Field>
      </Toolbar>

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      <TableShell title="Audit log entries">
        <thead>
          <tr>
            <th className="px-4 py-2.5 text-left">Date &amp; time</th>
            <th className="px-4 py-2.5 text-left">User</th>
            <th className="px-4 py-2.5 text-left">Action</th>
            <th className="px-4 py-2.5 text-left">Outcome</th>
            <th className="px-4 py-2.5 text-left">Record</th>
            <th className="px-4 py-2.5 text-left">From</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-security-navy-100">
          {loading ? (
            <TableLoadingRow colSpan={6} label="Loading audit logs..." />
          ) : logs.length === 0 ? (
            <TableEmptyRow colSpan={6} message="Nothing matches these filters." />
          ) : (
            logs.map((log) => (
              <Fragment key={log.id}>
                <tr
                  className="cursor-pointer"
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-security-navy-600">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-security-navy-900">
                    {log.user?.name ?? log.actorLabel ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-security-navy-900">{log.action}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={log.outcome} />
                  </td>
                  <td className="px-4 py-2.5 text-security-navy-700">
                    {log.entityType}
                    {log.entityId && (
                      <span className="font-mono text-xs text-security-navy-500">
                        {" "}
                        #{log.entityId.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-security-navy-500">
                    {log.ipAddress ?? "—"}
                  </td>
                </tr>
                {expanded === log.id && (
                  <tr>
                    <td colSpan={6} className="bg-security-navy-50 px-4 py-3">
                      <dl className="grid gap-2 text-xs sm:grid-cols-3">
                        <div>
                          <dt className="font-semibold text-security-navy-500">User agent</dt>
                          <dd className="break-all text-security-navy-700">
                            {log.userAgent ?? "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-security-navy-500">Request id</dt>
                          <dd className="font-mono text-security-navy-700">
                            {log.requestId ?? "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-security-navy-500">Record id</dt>
                          <dd className="font-mono break-all text-security-navy-700">
                            {log.entityId ?? "—"}
                          </dd>
                        </div>
                      </dl>
                      {log.metadata && (
                        <pre className="mt-3 max-h-64 overflow-auto rounded-security border border-security-navy-100 bg-white p-3 text-xs text-security-navy-700">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))
          )}
        </tbody>
      </TableShell>

      <div className="flex items-center justify-between text-sm text-security-navy-600">
        <span className="tabular-nums">
          {total === 0
            ? "No entries"
            : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset((current) => Math.max(current - PAGE_SIZE, 0))}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((current) => current + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
