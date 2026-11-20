"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/api";
import { attendanceExceptionCopy } from "@/lib/attendance-exception-copy";
import { attendanceSiteHref } from "@/lib/attendance-navigation";
import {
  listAttendanceExceptions,
  reviewAttendanceException,
  type AttendanceException,
} from "@/lib/msr-api";
import {
  fetchSiteTimesheetCaptureOverview,
  getAttendanceReplacementSuggestions,
  type AttendanceShiftTypeFilter,
  type RankedReplacementCandidate,
  type SiteTimesheetCaptureOverviewSite,
} from "@/lib/roster-api";

export interface AttendanceNeedsAttentionPanelProps {
  token: string;
  periodStart: string;
  periodEnd: string;
  shiftType?: AttendanceShiftTypeFilter;
  canApprove?: boolean;
  onUpdated?: () => void;
}

export function AttendanceNeedsAttentionPanel({
  token,
  periodStart,
  periodEnd,
  shiftType = "all",
  canApprove = true,
  onUpdated,
}: AttendanceNeedsAttentionPanelProps) {
  const [exceptions, setExceptions] = useState<AttendanceException[]>([]);
  const [pendingSites, setPendingSites] = useState<SiteTimesheetCaptureOverviewSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quick-fix dialog state
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [activeExc, setActiveExc] = useState<AttendanceException | null>(null);
  const [candidates, setCandidates] = useState<RankedReplacementCandidate[]>([]);
  const [loadingRelievers, setLoadingRelievers] = useState(false);
  const [selectedRelieverId, setSelectedRelieverId] = useState("");
  const [note, setNote] = useState("");
  const [obNumber, setObNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [excRes, capRes] = await Promise.all([
        listAttendanceExceptions(token, { status: "OPEN", limit: 100 }),
        fetchSiteTimesheetCaptureOverview(token, periodStart, periodEnd, shiftType).catch(() => null),
      ]);
      setExceptions(excRes.items ?? []);
      setPendingSites((capRes?.sites ?? []).filter((s) => s.status === "needs_capture"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load items needing attention");
    } finally {
      setLoading(false);
    }
  }, [token, periodStart, periodEnd, shiftType]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (activeExc && !dlg.open) dlg.showModal();
    else if (!activeExc && dlg.open) dlg.close();
  }, [activeExc]);

  const openQuickFix = (exc: AttendanceException) => {
    setActiveExc(exc);
    setSelectedRelieverId("");
    setNote("");
    setObNumber("");
    setModalError(null);
    setCandidates([]);
    if (exc.shift?.id) {
      setLoadingRelievers(true);
      getAttendanceReplacementSuggestions(token, exc.shift.id)
        .then((res) => setCandidates(res.candidates))
        .catch(() => setCandidates([]))
        .finally(() => setLoadingRelievers(false));
    }
  };

  const handleResolveAction = async (
    action: "approve" | "resolve" | "mark_absent" | "reject"
  ) => {
    if (!activeExc) return;
    setSubmitting(true);
    setModalError(null);
    try {
      await reviewAttendanceException(
        token,
        activeExc.id,
        action,
        note.trim() || undefined,
        obNumber.trim() || undefined
      );
      setActiveExc(null);
      await loadData();
      onUpdated?.();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Unable to update attendance issue");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignReplacement = async () => {
    if (!activeExc?.shift?.id || !selectedRelieverId) return;
    setSubmitting(true);
    setModalError(null);
    try {
      const res = await authFetch("/attendance/replace-guard", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shiftId: activeExc.shift.id,
          replacementEmployeeId: selectedRelieverId,
          reason: note.trim() || "Controller replaced absent/late guard",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || "Replacement failed");
      }
      await reviewAttendanceException(
        token,
        activeExc.id,
        "resolve",
        note.trim() || "Replaced guard on duty",
        obNumber.trim() || undefined
      ).catch(() => undefined);
      setActiveExc(null);
      await loadData();
      onUpdated?.();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Failed to replace guard");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-security-navy-200 dark:border-security-navy-800 bg-white dark:bg-security-navy-900 p-8 text-center text-sm text-security-navy-500">
        Checking live exceptions and site sign-offs…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-security-navy-200 dark:border-security-navy-800 bg-white dark:bg-security-navy-900 p-4">
          <div className="text-xs text-security-navy-500">Open Live Issues</div>
          <div className="text-2xl font-bold tabular-nums text-security-navy-900 dark:text-white mt-1">
            {exceptions.length}
          </div>
          <p className="text-xs text-security-navy-500 mt-0.5">
            No-shows, late arrivals, or missed clock-outs to resolve today.
          </p>
        </div>

        <div className="rounded-xl border border-security-navy-200 dark:border-security-navy-800 bg-white dark:bg-security-navy-900 p-4">
          <div className="text-xs text-security-navy-500">Sites Waiting Sign-Off</div>
          <div className="text-2xl font-bold tabular-nums text-[var(--accent-signal-deep)] dark:text-amber-300 mt-1">
            {pendingSites.length}
          </div>
          <p className="text-xs text-security-navy-500 mt-0.5">
            Sites with unconfirmed shifts in the current pay cycle.
          </p>
        </div>
      </div>

      {/* Urgent Live Exceptions */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-security-navy-900 dark:text-white">
            Urgent Attendance Issues ({exceptions.length})
          </h2>
          <Link
            href="/attendance/exceptions"
            className="text-xs font-semibold text-[var(--accent-signal-deep)] hover:underline"
          >
            Open Full Exception Log →
          </Link>
        </div>

        {exceptions.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20 p-5 text-sm text-emerald-900 dark:text-emerald-100">
            All caught up — zero open clock-in or attendance exceptions.
          </div>
        ) : (
          <div className="space-y-2.5">
            {exceptions.map((exc) => {
              const copy = attendanceExceptionCopy(exc.exceptionType);
              const guardName = exc.employee
                ? `${exc.employee.firstName} ${exc.employee.lastName}`.trim()
                : "Guard";
              return (
                <div
                  key={exc.id}
                  className="rounded-xl border border-security-navy-200 dark:border-security-navy-800 bg-white dark:bg-security-navy-900 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          exc.severity === "CRITICAL"
                            ? "bg-red-100 text-red-900"
                            : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {exc.severity}
                      </span>
                      <span className="text-sm font-semibold text-security-navy-900 dark:text-white">
                        {copy.title} · {guardName}
                      </span>
                    </div>
                    <p className="text-xs text-security-navy-600 dark:text-security-navy-300">
                      {exc.site?.name ?? "Site"} · {exc.description || copy.description}
                    </p>
                  </div>

                  {canApprove && (
                    <button
                      type="button"
                      onClick={() => openQuickFix(exc)}
                      className="btn-primary text-xs min-h-[40px] shrink-0"
                    >
                      Quick Fix
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Pending Site Sign-Offs */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-security-navy-900 dark:text-white">
          Sites Waiting for Confirmation ({pendingSites.length})
        </h2>
        {pendingSites.length === 0 ? (
          <div className="rounded-xl border border-security-navy-200 dark:border-security-navy-800 bg-white dark:bg-security-navy-900 p-5 text-sm text-security-navy-600 dark:text-security-navy-300">
            All scheduled shifts up to today have been captured.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendingSites.map((s) => (
              <div
                key={s.siteId}
                className="rounded-xl border border-security-navy-200 dark:border-security-navy-800 bg-white dark:bg-security-navy-900 p-4 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-sm font-semibold text-security-navy-900 dark:text-white">
                    {s.siteName}
                  </div>
                  <div className="text-xs text-security-navy-500 mt-0.5">
                    {s.pendingRows} pending shift{s.pendingRows === 1 ? "" : "s"}
                  </div>
                </div>
                <Link
                  href={attendanceSiteHref(s.siteId, {
                    start: periodStart,
                    end: periodEnd,
                    shiftType,
                  })}
                  className="btn-primary text-xs min-h-[38px]"
                >
                  Confirm
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Native <dialog> Quick-Fix Modal */}
      <dialog
        ref={dialogRef}
        onCancel={(e) => {
          e.preventDefault();
          setActiveExc(null);
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) setActiveExc(null);
        }}
        className="m-auto w-full max-w-lg rounded-2xl border border-security-navy-200 dark:border-security-navy-700 bg-white dark:bg-security-navy-900 p-0 text-security-navy-900 dark:text-white shadow-2xl"
      >
        {activeExc && (
          <>
            <div className="flex items-center justify-between border-b border-security-navy-200 dark:border-security-navy-800 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold">
                  Fix: {attendanceExceptionCopy(activeExc.exceptionType).title}
                </h3>
                <p className="text-xs text-security-navy-500">
                  {activeExc.site?.name ?? "Site"} ·{" "}
                  {activeExc.employee
                    ? `${activeExc.employee.firstName} ${activeExc.employee.lastName}`
                    : "Guard"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveExc(null)}
                className="rounded-lg px-3 py-1.5 text-xs text-security-navy-500 hover:bg-security-navy-100"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {modalError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {modalError}
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-medium">Controller Note</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional reason or explanation…"
                  className="input-modern w-full text-xs"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium">OB Number (if required by site)</label>
                <input
                  type="text"
                  value={obNumber}
                  onChange={(e) => setObNumber(e.target.value)}
                  placeholder="Optional OB number…"
                  className="input-modern w-full text-xs"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleResolveAction("approve")}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-950 px-3 py-2 text-xs font-semibold min-h-[40px]"
                >
                  Approve Shift
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleResolveAction("mark_absent")}
                  className="rounded-lg border border-red-300 bg-red-50 text-red-950 px-3 py-2 text-xs font-semibold min-h-[40px]"
                >
                  Mark Absent
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleResolveAction("reject")}
                  className="rounded-lg border border-security-navy-300 bg-security-navy-50 text-security-navy-800 px-3 py-2 text-xs font-semibold min-h-[40px]"
                >
                  Dismiss Issue
                </button>
              </div>

              {activeExc.shift?.id && (
                <div className="border-t border-security-navy-200 dark:border-security-navy-800 pt-4 space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-security-navy-500">
                    Or Assign SA-Compliant Reliever
                  </h4>
                  {loadingRelievers ? (
                    <p className="text-xs text-security-navy-500">Ranking available guards…</p>
                  ) : candidates.length === 0 ? (
                    <p className="text-xs text-security-navy-500">No replacement candidates loaded.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {candidates.slice(0, 12).map((c) => {
                        const selected = selectedRelieverId === c.employeeId;
                        return (
                          <button
                            key={c.employeeId}
                            type="button"
                            disabled={!c.eligible}
                            onClick={() => setSelectedRelieverId(c.employeeId)}
                            className={`w-full text-left rounded-lg border p-2 text-xs ${
                              !c.eligible
                                ? "opacity-45 cursor-not-allowed bg-security-navy-50"
                                : selected
                                  ? "border-[var(--accent-primary)] bg-amber-50/70"
                                  : "border-security-navy-200 hover:border-security-navy-400"
                            }`}
                          >
                            <div className="flex justify-between">
                              <span className="font-semibold">{c.fullName}</span>
                              <span>{c.weekHoursBefore}h → {c.weekHoursAfter}h</span>
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {c.eligible ? (
                                c.badges.map((b) => (
                                  <span key={b} className="rounded bg-security-navy-100 px-1.5 py-0.5 text-[10px]">
                                    {b}
                                  </span>
                                ))
                              ) : (
                                <span className="text-red-600">{c.ineligibleReason}</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selectedRelieverId && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleAssignReplacement}
                      className="btn-primary w-full text-xs min-h-[40px]"
                    >
                      {submitting ? "Assigning…" : "Assign Reliever & Resolve"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
