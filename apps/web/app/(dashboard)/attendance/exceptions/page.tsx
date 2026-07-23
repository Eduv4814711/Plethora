"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { hasCapability } from "@/lib/permissions";
import {
  detectAttendanceExceptions,
  getExceptionAnalytics,
  getPayrollReadiness,
  listAttendanceExceptions,
  reviewAttendanceException,
  type AttendanceExceptionAnalytics,
  type AttendanceException,
} from "@/lib/msr-api";
import { AlertBanner, Badge, EmptyState, PageHeader } from "@/components/ui";
import {
  ATTENDANCE_EXCEPTION_ACTIONS,
  attendanceExceptionCopy,
  attendanceExceptionScanCopy,
  type AttendanceExceptionAction,
} from "@/lib/attendance-exception-copy";

type ExceptionShiftFilter = "all" | "day" | "night";

function exceptionShiftType(exception: AttendanceException): "day" | "night" | null {
  if (!exception.shift?.startTime) return null;
  return new Date(exception.shift.startTime).getHours() >= 18 ? "night" : "day";
}

function validShift(value: string | null): ExceptionShiftFilter {
  return value === "day" || value === "night" || value === "all" ? value : "all";
}

export default function AttendanceExceptionsPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/attendance", "create"));
  const canApprove = Boolean(user && hasCapability(user, "/attendance", "approve"));
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requestIdRef = useRef(0);
  const [items, setItems] = useState<AttendanceException[]>([]);
  const [analytics, setAnalytics] = useState<AttendanceExceptionAnalytics | null>(null);
  const [payrollReadiness, setPayrollReadiness] = useState<{ status: string; openExceptions: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "OPEN");
  const [severityFilter, setSeverityFilter] = useState(searchParams.get("severity") ?? "");
  const [siteFilter, setSiteFilter] = useState(searchParams.get("siteId") ?? "");
  const [shiftFilter, setShiftFilter] = useState<ExceptionShiftFilter>(() => validShift(searchParams.get("shiftType")));
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const periodStart = searchParams.get("start") ?? undefined;
  const periodEnd = searchParams.get("end") ?? undefined;

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    statusFilter === "OPEN" ? next.delete("status") : next.set("status", statusFilter);
    severityFilter ? next.set("severity", severityFilter) : next.delete("severity");
    siteFilter ? next.set("siteId", siteFilter) : next.delete("siteId");
    shiftFilter === "all" ? next.delete("shiftType") : next.set("shiftType", shiftFilter);
    if (next.toString() !== searchParams.toString()) router.replace(`${pathname}?${next}`, { scroll: false });
  }, [pathname, router, searchParams, severityFilter, shiftFilter, siteFilter, statusFilter]);

  useEffect(() => {
    if (!token || !canApprove) return;
    let cancelled = false;
    authFetch("/sites?limit=200", token)
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load sites");
        return response.json();
      })
      .then((body) => {
        if (!cancelled) setSites((body.data ?? []).map((site: { id: string; name: string }) => ({ id: site.id, name: site.name })));
      })
      .catch(() => {
        if (!cancelled) setSites([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token || !canCreate) return;
    const requestId = ++requestIdRef.current;
    setError("");
    try {
      const [listResult, analyticsResult, readiness] = await Promise.all([
        listAttendanceExceptions(token, {
          status: statusFilter === "all" ? undefined : statusFilter,
          severity: severityFilter || undefined,
          siteId: siteFilter || undefined,
          periodStart,
          periodEnd,
          limit: 100,
        }),
        getExceptionAnalytics(token, { periodStart, periodEnd }),
        getPayrollReadiness(token),
      ]);
      if (requestId !== requestIdRef.current) return;
      setItems(listResult.items);
      setAnalytics(analyticsResult);
      setPayrollReadiness(readiness);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Unable to load attendance issues");
      setItems([]);
    }
  }, [periodEnd, periodStart, severityFilter, siteFilter, statusFilter, token]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh, token]);

  const handleReview = async (exception: AttendanceException, action: AttendanceExceptionAction) => {
    if (!token) return;
    setActingId(exception.id);
    setError("");
    setSuccess("");
    try {
      await reviewAttendanceException(token, exception.id, action, notes[exception.id]?.trim() || undefined);
      const actionCopy = ATTENDANCE_EXCEPTION_ACTIONS.find((item) => item.action === action)?.label ?? "Attendance issue updated";
      setSuccess(`${actionCopy}: ${attendanceExceptionCopy(exception.exceptionType).title}.`);
      setOpenActionsId(null);
      setNotes((current) => ({ ...current, [exception.id]: "" }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update this attendance issue");
    } finally {
      setActingId(null);
    }
  };

  const handleDetect = async () => {
    if (!token) return;
    setDetecting(true);
    setError("");
    setSuccess("");
    try {
      const result = await detectAttendanceExceptions(token, siteFilter ? { siteId: siteFilter } : undefined);
      setSuccess(attendanceExceptionScanCopy(result));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to scan for attendance issues");
    } finally {
      setDetecting(false);
    }
  };

  const filteredItems = useMemo(() => {
    if (shiftFilter === "all") return items;
    return items.filter((exception) => {
      const shift = exceptionShiftType(exception);
      return !shift || shift === shiftFilter;
    });
  }, [items, shiftFilter]);

  const summary = analytics;
  const overviewParams = new URLSearchParams();
  if (periodStart) overviewParams.set("start", periodStart);
  if (periodEnd) overviewParams.set("end", periodEnd);
  overviewParams.set("shiftType", shiftFilter);

  return (
    <main className="animate-fade-in mx-auto max-w-6xl space-y-5">
      <Link href={`/attendance?${overviewParams}`} className="inline-flex min-h-11 items-center text-sm font-medium text-security-navy-700 hover:underline dark:text-security-navy-300">
        ← Back to attendance overview
      </Link>

      <PageHeader
        title="Attendance issues"
        description="Review missing clock events, late arrivals, and other items that could block payroll."
        actions={canCreate ? (
          <button type="button" className="btn-secondary min-h-11" onClick={() => void handleDetect()} disabled={detecting}>
            {detecting ? "Scanning…" : "Scan for new issues"}
          </button>
        ) : undefined}
      />

      {payrollReadiness && payrollReadiness.status !== "READY" && (
        <AlertBanner variant="warning">
          Payroll is waiting for attendance review
          {payrollReadiness.openExceptions > 0 ? ` · ${payrollReadiness.openExceptions} open issue${payrollReadiness.openExceptions === 1 ? "" : "s"}` : ""}.
        </AlertBanner>
      )}
      {error && (
        <AlertBanner variant="error" title="Attendance issues could not be updated">
          <span>{error}</span>{" "}
          <button type="button" className="min-h-11 font-semibold underline" onClick={() => void refresh()}>Try again</button>
        </AlertBanner>
      )}
      {success && <AlertBanner variant="success" aria-live="polite">{success}</AlertBanner>}

      {summary && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Attendance issue summary">
          {[
            ["Open issues", summary.openCount ?? 0],
            ["Issues this period", summary.total],
            ["Absence rate", `${summary.absenteePercentage}%`],
            ["Attendance complete", `${summary.completionRate ?? 100}%`],
          ].map(([label, value]) => (
            <div key={String(label)} className="card-dashboard p-3">
              <p className="text-xs font-semibold uppercase text-neutral-500">{label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </section>
      )}

      <section className="sticky top-0 z-20 grid gap-3 rounded-xl border border-neutral-200 bg-white/95 p-4 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-950/95 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter attendance issues">
        <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="input-modern mt-1 min-h-11 w-full">
            <option value="OPEN">Open</option><option value="UNDER_REVIEW">Follow up later</option><option value="all">All statuses</option><option value="RESOLVED">Resolved</option><option value="APPROVED">Confirmed</option><option value="REJECTED">Dismissed</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          Priority
          <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} className="input-modern mt-1 min-h-11 w-full">
            <option value="">All priorities</option><option value="CRITICAL">Critical</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          Site
          <select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)} className="input-modern mt-1 min-h-11 w-full">
            <option value="">All sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          Shift
          <select value={shiftFilter} onChange={(event) => setShiftFilter(validShift(event.target.value))} className="input-modern mt-1 min-h-11 w-full">
            <option value="all">All shifts</option><option value="day">Day shift</option><option value="night">Night shift</option>
          </select>
        </label>
      </section>

      {loading ? (
        <div className="animate-pulse space-y-3" aria-label="Loading attendance issues">
          {[1, 2, 3].map((item) => <div key={item} className="h-36 rounded-xl bg-neutral-200 dark:bg-neutral-700" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((exception) => {
            const copy = attendanceExceptionCopy(exception.exceptionType);
            const shift = exceptionShiftType(exception);
            const actionsOpen = openActionsId === exception.id;
            return (
              <article key={exception.id} className="card-dashboard p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">{copy.title}</h2>
                    <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{copy.description}</p>
                    <p className="mt-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                      {exception.employee ? `${exception.employee.firstName} ${exception.employee.lastName}` : "Unknown guard"}
                      {exception.site ? ` · ${exception.site.name}` : ""}{shift ? ` · ${shift} shift` : ""}
                    </p>
                    {exception.shift && <p className="mt-1 text-xs text-neutral-500">{new Date(exception.shift.startTime).toLocaleString()} – {new Date(exception.shift.endTime).toLocaleTimeString()}</p>}
                    {exception.reviewNote && <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">Previous note: {exception.reviewNote}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Badge variant={exception.severity === "CRITICAL" ? "error" : "warning"}>{exception.severity}</Badge>
                    <Badge variant="neutral">{exception.status.replace(/_/g, " ")}</Badge>
                  </div>
                </div>

                {canApprove && ["OPEN", "UNDER_REVIEW"].includes(exception.status) && (
                  <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                    <button
                      type="button"
                      className="btn-primary min-h-11 w-full sm:w-auto"
                      onClick={() => setOpenActionsId(actionsOpen ? null : exception.id)}
                      aria-expanded={actionsOpen}
                    >
                      Choose outcome
                    </button>
                    {actionsOpen && (
                      <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900">
                        <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                          Supervisor note <span className="font-normal text-neutral-500">(optional)</span>
                          <textarea
                            rows={2}
                            value={notes[exception.id] ?? ""}
                            onChange={(event) => setNotes((current) => ({ ...current, [exception.id]: event.target.value }))}
                            className="input-modern mt-1 w-full"
                            placeholder="Add context for the audit trail"
                          />
                        </label>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {ATTENDANCE_EXCEPTION_ACTIONS.map((action) => (
                            <button
                              key={action.action}
                              type="button"
                              disabled={actingId === exception.id}
                              onClick={() => void handleReview(exception, action.action)}
                              className={`${action.danger ? "btn-destructive" : action.action === "approve" ? "btn-primary" : "btn-secondary"} min-h-11 text-left`}
                              title={action.description}
                            >
                              <span className="block">{action.label}</span>
                              <span className="mt-0.5 block text-xs font-normal opacity-80">{action.description}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {!loading && filteredItems.length === 0 && (
        <EmptyState
          title="No attendance issues match these filters"
          description="Try another filter, or scan for new issues if attendance has recently changed."
          action={canCreate ? <button type="button" className="btn-secondary min-h-11" onClick={() => void handleDetect()} disabled={detecting}>Scan for issues</button> : undefined}
        />
      )}
    </main>
  );
}
