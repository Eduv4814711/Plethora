"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import {
  detectAttendanceExceptions,
  getExceptionAnalytics,
  getPayrollReadiness,
  listAttendanceExceptions,
  reviewAttendanceException,
  type AttendanceException,
} from "@/lib/msr-api";
import { AlertBanner, Badge, EmptyState, PageHeader } from "@/components/ui";

type ExceptionShiftFilter = "all" | "day" | "night";

/** Classify exception by shift start hour in local time (day before 18:00, night from 18:00). */
function exceptionShiftType(ex: AttendanceException): "day" | "night" | null {
  if (!ex.shift?.startTime) return null;
  const hour = new Date(ex.shift.startTime).getHours();
  return hour >= 18 ? "night" : "day";
}

export default function AttendanceExceptionsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<AttendanceException[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null);
  const [payrollReadiness, setPayrollReadiness] = useState<{ status: string; openExceptions: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [severityFilter, setSeverityFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [shiftFilter, setShiftFilter] = useState<ExceptionShiftFilter>("all");
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [noteForId, setNoteForId] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    if (!token) return;
    authFetch("/sites?limit=200", token)
      .then((r) => r.json())
      .then((d) => setSites((d.data ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }))))
      .catch(() => setSites([]));
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const [listResult, analyticsResult, readiness] = await Promise.all([
        listAttendanceExceptions(token, {
          status: statusFilter === "all" ? undefined : statusFilter,
          severity: severityFilter || undefined,
          siteId: siteFilter || undefined,
          limit: 100,
        }),
        getExceptionAnalytics(token),
        getPayrollReadiness(token),
      ]);
      setItems(listResult.items);
      setAnalytics(analyticsResult);
      setPayrollReadiness(readiness);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load exceptions");
      setItems([]);
    }
  }, [token, statusFilter, severityFilter, siteFilter]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [token, refresh]);

  const handleReview = async (
    id: string,
    action: "approve" | "reject" | "resolve" | "under_review" | "mark_absent",
    note?: string
  ) => {
    if (!token) return;
    setActingId(id);
    try {
      await reviewAttendanceException(token, id, action, note);
      setNoteForId(null);
      setReviewNote("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setActingId(null);
    }
  };

  const handleDetect = async () => {
    if (!token) return;
    setDetecting(true);
    try {
      await detectAttendanceExceptions(token, siteFilter ? { siteId: siteFilter } : undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Detection failed");
    } finally {
      setDetecting(false);
    }
  };

  const filteredItems = useMemo(() => {
    if (shiftFilter === "all") return items;
    return items.filter((ex) => {
      const shift = exceptionShiftType(ex);
      if (!shift) return true;
      return shift === shiftFilter;
    });
  }, [items, shiftFilter]);

  if (loading) {
    return <div className="animate-pulse h-48 bg-neutral-200 rounded-lg" />;
  }

  const summary = analytics as {
    totalExceptions?: number;
    openCount?: number;
    absenteePercent?: number;
    completionRate?: number;
    byType?: { type: string; count: number }[];
  } | null;

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <Link href="/attendance" className="text-sm text-security-navy-700 hover:underline mb-4 inline-block">
        ← Back to attendance
      </Link>

      <PageHeader
        title="Attendance exceptions"
        description="Review missed clock-ins, late arrivals, and other attendance issues."
        actions={
          <button type="button" className="btn-secondary" onClick={handleDetect} disabled={detecting}>
            {detecting ? "Scanning…" : "Scan for new issues"}
          </button>
        }
      />

      {payrollReadiness && payrollReadiness.status !== "READY" && (
        <AlertBanner variant="warning" className="mb-4">
          Payroll status: {payrollReadiness.status.replace(/_/g, " ").toLowerCase()}
          {payrollReadiness.openExceptions > 0 ? ` · ${payrollReadiness.openExceptions} open exception(s)` : ""}
        </AlertBanner>
      )}

      {summary && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="card-dashboard p-3">
            <p className="text-xs text-neutral-500 uppercase font-semibold">Open</p>
            <p className="text-2xl font-bold tabular-nums">{summary.openCount ?? 0}</p>
          </div>
          <div className="card-dashboard p-3">
            <p className="text-xs text-neutral-500 uppercase font-semibold">Total this period</p>
            <p className="text-2xl font-bold tabular-nums">{summary.totalExceptions ?? 0}</p>
          </div>
          <div className="card-dashboard p-3">
            <p className="text-xs text-neutral-500 uppercase font-semibold">Absentee %</p>
            <p className="text-2xl font-bold tabular-nums">{summary.absenteePercent ?? 0}%</p>
          </div>
          <div className="card-dashboard p-3">
            <p className="text-xs text-neutral-500 uppercase font-semibold">Completion rate</p>
            <p className="text-2xl font-bold tabular-nums">{summary.completionRate ?? 100}%</p>
          </div>
        </section>
      )}

      {summary?.byType && summary.byType.length > 0 && (
        <section className="mb-4 flex flex-wrap gap-2">
          {summary.byType.map((t) => (
            <span key={t.type} className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
              {t.type.replace(/_/g, " ")}: {t.count}
            </span>
          ))}
        </section>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-compact w-auto" aria-label="Filter by status">
          <option value="OPEN">Open</option>
          <option value="UNDER_REVIEW">Under review</option>
          <option value="all">All</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="input-compact w-auto" aria-label="Filter by severity">
          <option value="">All severities</option>
          <option value="CRITICAL">Critical</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className="input-compact w-auto min-w-[10rem]" aria-label="Filter by site">
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={shiftFilter}
          onChange={(e) => setShiftFilter(e.target.value as ExceptionShiftFilter)}
          className="input-compact w-auto"
          aria-label="Filter by shift type"
        >
          <option value="all">All shifts</option>
          <option value="day">Day shift</option>
          <option value="night">Night shift</option>
        </select>
      </div>

      {error && <AlertBanner variant="error" className="mb-4">{error}</AlertBanner>}

      <div className="space-y-3">
        {filteredItems.map((ex) => (
          <article key={ex.id} className="card-dashboard p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold text-neutral-900">{ex.exceptionType.replace(/_/g, " ")}</h2>
                <p className="text-sm text-neutral-600 mt-0.5">
                  {ex.employee ? `${ex.employee.firstName} ${ex.employee.lastName}` : "Unknown guard"}
                  {ex.site ? ` · ${ex.site.name}` : ""}
                  {exceptionShiftType(ex) ? ` · ${exceptionShiftType(ex)} shift` : ""}
                </p>
                {ex.shift && (
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Shift {new Date(ex.shift.startTime).toLocaleString()} – {new Date(ex.shift.endTime).toLocaleTimeString()}
                  </p>
                )}
                <p className="text-xs text-neutral-500 mt-1">Detected {new Date(ex.detectedAt).toLocaleString()}</p>
                {ex.reviewNote && <p className="text-sm text-neutral-700 mt-2">Note: {ex.reviewNote}</p>}
              </div>
              <div className="flex gap-1.5">
                <Badge variant={ex.severity === "CRITICAL" ? "error" : "warning"}>{ex.severity}</Badge>
                <Badge variant="neutral">{ex.status.replace(/_/g, " ")}</Badge>
              </div>
            </div>
            {["OPEN", "UNDER_REVIEW"].includes(ex.status) && (
              <div className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-3">
                {noteForId === ex.id && (
                  <textarea
                    className="input-modern w-full text-sm"
                    rows={2}
                    placeholder="Supervisor note (optional)"
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary text-sm py-1.5" disabled={actingId === ex.id} onClick={() => handleReview(ex.id, "approve", reviewNote || undefined)}>
                    Approve
                  </button>
                  <button type="button" className="btn-secondary text-sm py-1.5" disabled={actingId === ex.id} onClick={() => handleReview(ex.id, "under_review", reviewNote || undefined)}>
                    Under review
                  </button>
                  <button type="button" className="btn-secondary text-sm py-1.5" disabled={actingId === ex.id} onClick={() => handleReview(ex.id, "resolve", reviewNote || undefined)}>
                    Mark resolved
                  </button>
                  <button type="button" className="btn-secondary text-sm py-1.5" disabled={actingId === ex.id} onClick={() => handleReview(ex.id, "mark_absent", reviewNote || undefined)}>
                    Mark absent
                  </button>
                  <button type="button" className="btn-destructive text-sm py-1.5" disabled={actingId === ex.id} onClick={() => handleReview(ex.id, "reject", reviewNote || undefined)}>
                    Reject
                  </button>
                  <button type="button" className="btn-secondary text-sm py-1.5" onClick={() => setNoteForId(noteForId === ex.id ? null : ex.id)}>
                    {noteForId === ex.id ? "Hide note" : "Add note"}
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>

      {filteredItems.length === 0 && (
        <EmptyState
          className="mt-6"
          title="No exceptions to review"
          description={
            items.length > 0 && shiftFilter !== "all"
              ? `No ${shiftFilter}-shift exceptions match the current filters. Try All shifts.`
              : "Run a scan to detect missed clock-ins and other attendance issues."
          }
          action={
            <button type="button" className="btn-secondary text-sm py-1.5" onClick={handleDetect} disabled={detecting}>
              Scan for issues
            </button>
          }
        />
      )}
    </div>
  );
}
