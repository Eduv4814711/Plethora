"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { can, PERMISSIONS } from "@/lib/capabilities";

interface AuditEvent {
  id: string;
  action: string;
  actionLabel: string;
  entityType: string;
  entityId: string | null;
  timestamp: string;
  result: string;
  riskLevel: string;
  reason: string | null;
  requestId: string | null;
  integrityProtected: boolean;
  metadata: unknown;
  beforeState: unknown;
  afterState: unknown;
  user: { name: string; email: string } | null;
}

interface DataQualityIssue {
  id: string;
  ruleKey: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  affectedRecords: unknown;
  proposedResolution: unknown;
}

const PAGE_SIZE = 50;

function badgeClass(value: string) {
  if (["CRITICAL", "denied", "failed"].includes(value)) return "bg-red-100 text-red-800";
  if (["HIGH", "pending"].includes(value)) return "bg-amber-100 text-amber-800";
  if (["success", "RESOLVED"].includes(value)) return "bg-emerald-100 text-emerald-800";
  return "bg-neutral-100 text-neutral-700";
}

export default function AuditPage() {
  const { token, user } = useAuth();
  const searchParams = useSearchParams();
  const [view, setView] = useState<"events" | "quality">(searchParams.get("view") === "data-quality" ? "quality" : "events");
  const [logs, setLogs] = useState<AuditEvent[]>([]);
  const [issues, setIssues] = useState<DataQualityIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<{ valid: boolean; protectedEvents: number } | null>(null);
  const [reviewIssue, setReviewIssue] = useState<DataQualityIssue | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [canonicalRecordId, setCanonicalRecordId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [filters, setFilters] = useState({ search: "", riskLevel: "", result: "", startDate: "", endDate: "" });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const canExport = can(user, PERMISSIONS.AUDIT_EXPORT);
  const canManageQuality = can(user, PERMISSIONS.DATA_QUALITY_MANAGE);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    Object.entries(appliedFilters).forEach(([key, value]) => value && params.set(key, value));
    return params.toString();
  }, [appliedFilters, offset]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      if (view === "quality") {
        const response = await authFetch("/data-quality?limit=200", token);
        if (!response.ok) throw new Error("You do not have access to data-quality review.");
        const body = await response.json();
        setIssues(body.data ?? []);
        setTotal(body.total ?? 0);
      } else {
        const response = await authFetch(`/audit?${query}`, token);
        if (!response.ok) throw new Error("You do not have access to the audit trail.");
        const body = await response.json();
        setLogs(body.data ?? []);
        setTotal(body.total ?? 0);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load records");
    } finally {
      setLoading(false);
    }
  }, [token, query, view]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!token || view !== "events") return;
    authFetch("/audit/integrity", token).then((response) => response.ok ? response.json() : null).then(setIntegrity).catch(() => setIntegrity(null));
  }, [token, view]);

  const exportAudit = async (format: "csv" | "json") => {
    if (!token) return;
    const params = new URLSearchParams(query);
    params.delete("offset");
    params.set("limit", "25000");
    params.set("format", format);
    const response = await authFetch(`/audit/export?${params.toString()}`, token);
    if (!response.ok) return setError("Audit export failed.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `plethora-audit-${new Date().toISOString().slice(0, 10)}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const refreshQualityChecks = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch("/data-quality/scan", token, { method: "POST" });
      if (!response.ok) throw new Error("Unable to refresh data-quality checks.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to refresh checks");
      setLoading(false);
    }
  };

  const openReview = (issue: DataQualityIssue) => {
    const affected = issue.affectedRecords as { recordIds?: string[] } | null;
    setReviewIssue(issue);
    setReviewReason("");
    setCanonicalRecordId(issue.ruleKey === "duplicate_leave_day" ? affected?.recordIds?.[0] ?? "" : "");
  };

  const submitReview = async () => {
    if (!token || !reviewIssue || reviewReason.trim().length < 5) return;
    setSubmitting(true);
    setError(null);
    try {
      const proposedResolution = reviewIssue.ruleKey === "duplicate_leave_day"
        ? { canonicalRecordId }
        : { resolution: "verified_in_source_workflow" };
      const response = await authFetch(`/data-quality/${reviewIssue.id}/resolution-requests`, token, {
        method: "POST",
        body: JSON.stringify({ reason: reviewReason.trim(), proposedResolution }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? "Unable to submit the review.");
      }
      setReviewIssue(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit review");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-fade-in space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Audit & data assurance</h1>
          <p className="mt-1 text-sm text-neutral-600">Understand who changed what, why it changed, and who approved it.</p>
        </div>
        {view === "events" && integrity && (
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${integrity.valid ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
            {integrity.valid ? `${integrity.protectedEvents} protected events verified` : "Audit chain needs investigation"}
          </span>
        )}
      </header>

      <nav className="inline-flex rounded-xl border border-neutral-200 bg-neutral-100 p-1" aria-label="Audit views">
        <button className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === "events" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600"}`} onClick={() => { setView("events"); setOffset(0); }}>Activity history</button>
        <button className={`rounded-lg px-4 py-2 text-sm font-semibold ${view === "quality" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600"}`} onClick={() => { setView("quality"); setOffset(0); }}>Data-quality review</button>
      </nav>

      {view === "quality" && canManageQuality && <div className="flex justify-end"><button className="btn-secondary" type="button" onClick={refreshQualityChecks} disabled={loading}>Refresh quality checks</button></div>}

      {view === "events" && (
        <section className="card-wireframe p-4" aria-label="Audit filters">
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-6" onSubmit={(event) => { event.preventDefault(); setOffset(0); setAppliedFilters(filters); }}>
            <label className="xl:col-span-2"><span className="mb-1 block text-xs font-semibold text-neutral-700">Search</span><input className="input-field w-full" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="User, action, reason or record" /></label>
            <label><span className="mb-1 block text-xs font-semibold text-neutral-700">Risk</span><select className="input-field w-full" value={filters.riskLevel} onChange={(event) => setFilters({ ...filters, riskLevel: event.target.value })}><option value="">All risks</option><option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></label>
            <label><span className="mb-1 block text-xs font-semibold text-neutral-700">Result</span><select className="input-field w-full" value={filters.result} onChange={(event) => setFilters({ ...filters, result: event.target.value })}><option value="">All results</option><option value="success">Successful</option><option value="pending">Pending</option><option value="denied">Denied</option><option value="failed">Failed</option></select></label>
            <label><span className="mb-1 block text-xs font-semibold text-neutral-700">From</span><input type="date" className="input-field w-full" value={filters.startDate} onChange={(event) => setFilters({ ...filters, startDate: event.target.value })} /></label>
            <label><span className="mb-1 block text-xs font-semibold text-neutral-700">To</span><input type="date" className="input-field w-full" value={filters.endDate} onChange={(event) => setFilters({ ...filters, endDate: event.target.value })} /></label>
            <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-6"><button className="btn-primary" type="submit">Apply filters</button><button className="btn-secondary" type="button" onClick={() => { const empty = { search: "", riskLevel: "", result: "", startDate: "", endDate: "" }; setFilters(empty); setAppliedFilters(empty); setOffset(0); }}>Clear</button>{canExport && <><button className="btn-secondary ml-auto" type="button" onClick={() => exportAudit("csv")}>Export CSV</button><button className="btn-secondary" type="button" onClick={() => exportAudit("json")}>Export JSON</button></>}</div>
          </form>
        </section>
      )}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {loading ? <div className="card-wireframe p-10 text-center text-sm text-neutral-600">Loading records…</div> : view === "events" ? (
        <section className="card-wireframe overflow-hidden">
          <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-neutral-50"><tr><th className="px-4 py-3 text-left">Date & time</th><th className="px-4 py-3 text-left">Person</th><th className="px-4 py-3 text-left">What happened</th><th className="px-4 py-3 text-left">Result</th><th className="px-4 py-3 text-left">Risk</th><th className="px-4 py-3 text-right">Details</th></tr></thead><tbody>
            {logs.map((log) => <AuditRow key={log.id} log={log} expanded={expandedId === log.id} onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)} />)}
            {logs.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-neutral-600">No activity matches these filters.</td></tr>}
          </tbody></table></div>
          <footer className="flex items-center justify-between border-t border-neutral-200 px-4 py-3 text-sm"><span className="text-neutral-600">{total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}`} of {total}</span><div className="flex gap-2"><button className="btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button><button className="btn-secondary" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button></div></footer>
        </section>
      ) : (
        <section className="grid gap-3">
          {issues.map((issue) => <article key={issue.id} className="card-wireframe p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${badgeClass(issue.severity)}`}>{issue.severity}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(issue.status)}`}>{issue.status.replace(/_/g, " ")}</span></div><h2 className="mt-2 font-semibold text-neutral-900">{issue.title}</h2><p className="mt-1 text-sm text-neutral-600">{issue.description}</p></div>{canManageQuality && <button className="btn-secondary" disabled={issue.status !== "OPEN"} onClick={() => openReview(issue)}>{issue.status === "UNDER_REVIEW" ? "Awaiting approval" : "Review resolution"}</button>}</div></article>)}
          {issues.length === 0 && <div className="card-wireframe p-10 text-center text-sm text-neutral-600">No data-quality issues need review.</div>}
        </section>
      )}

      {reviewIssue && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="quality-review-title"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"><h2 id="quality-review-title" className="text-lg font-bold text-neutral-900">Request independent resolution approval</h2><p className="mt-2 text-sm text-neutral-600">Confirm the source record has been corrected. A different authorised person must approve this request.</p><div className="mt-4 rounded-xl bg-neutral-50 p-3"><p className="font-semibold text-neutral-900">{reviewIssue.title}</p><p className="mt-1 text-sm text-neutral-600">{reviewIssue.description}</p></div>{reviewIssue.ruleKey === "duplicate_leave_day" && <label className="mt-4 block"><span className="mb-1 block text-sm font-semibold">Record to retain</span><select className="input-field w-full" value={canonicalRecordId} onChange={(event) => setCanonicalRecordId(event.target.value)}>{((reviewIssue.affectedRecords as { recordIds?: string[] } | null)?.recordIds ?? []).map((id) => <option key={id} value={id}>{id}</option>)}</select></label>}<label className="mt-4 block"><span className="mb-1 block text-sm font-semibold">Reason and evidence</span><textarea className="input-field min-h-28 w-full" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="Explain what was checked and corrected." /></label><div className="mt-5 flex justify-end gap-2"><button className="btn-secondary" type="button" onClick={() => setReviewIssue(null)} disabled={submitting}>Cancel</button><button className="btn-primary" type="button" onClick={submitReview} disabled={submitting || reviewReason.trim().length < 5 || (reviewIssue.ruleKey === "duplicate_leave_day" && !canonicalRecordId)}>{submitting ? "Submitting…" : "Submit for approval"}</button></div></div></div>}
    </div>
  );
}

function AuditRow({ log, expanded, onToggle }: { log: AuditEvent; expanded: boolean; onToggle: () => void }) {
  return <>
    <tr className="border-t border-neutral-200 align-top"><td className="whitespace-nowrap px-4 py-3 text-neutral-600">{new Date(log.timestamp).toLocaleString()}</td><td className="px-4 py-3"><p className="font-medium text-neutral-900">{log.user?.name ?? "System"}</p><p className="text-xs text-neutral-500">{log.user?.email ?? "Automated process"}</p></td><td className="px-4 py-3"><p className="font-medium text-neutral-900">{log.actionLabel}</p><p className="text-xs text-neutral-500">{log.entityType}{log.reason ? ` · ${log.reason}` : ""}</p></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(log.result)}`}>{log.result}</span></td><td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(log.riskLevel)}`}>{log.riskLevel}</span></td><td className="px-4 py-3 text-right"><button className="text-xs font-semibold text-security-navy-800 hover:underline" onClick={onToggle}>{expanded ? "Hide" : "View"}</button></td></tr>
    {expanded && <tr className="border-t border-neutral-100 bg-neutral-50"><td colSpan={6} className="px-4 py-4"><dl className="grid gap-3 text-xs sm:grid-cols-3"><div><dt className="font-semibold text-neutral-600">Record</dt><dd className="mt-1 break-all text-neutral-900">{log.entityType}{log.entityId ? ` · ${log.entityId}` : ""}</dd></div><div><dt className="font-semibold text-neutral-600">Request ID</dt><dd className="mt-1 break-all text-neutral-900">{log.requestId ?? "Not recorded"}</dd></div><div><dt className="font-semibold text-neutral-600">Integrity</dt><dd className="mt-1 text-neutral-900">{log.integrityProtected ? "Hash-protected" : "Legacy event"}</dd></div>{(log.beforeState != null || log.afterState != null || log.metadata != null) && <div className="sm:col-span-3"><dt className="font-semibold text-neutral-600">Recorded change</dt><dd className="mt-1 overflow-auto rounded-lg border border-neutral-200 bg-white p-3 font-mono text-[11px] text-neutral-800"><pre>{JSON.stringify({ before: log.beforeState, after: log.afterState, details: log.metadata }, null, 2)}</pre></dd></div>}</dl></td></tr>}
  </>;
}
