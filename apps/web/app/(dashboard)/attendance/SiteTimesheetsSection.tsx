"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { SiteTimesheetRowCard } from "@/components/site-timesheet-row-card";
import { SiteTimesheetTable } from "@/components/site-timesheet-table";
import { SiteTimesheetRelieverForm } from "@/components/site-timesheet-reliever-form";
import { SiteTimesheetBulkConfirmModal } from "@/components/site-timesheet-bulk-confirm-modal";
import {
  addSiteTimesheetRow,
  type AttendanceShiftTypeFilter,
  type SiteTimesheetRow,
} from "@/lib/roster-api";
import { humanizeCode } from "@/lib/site-timesheet-row-patch";
import { NO_SHIFT_LABEL, noShiftDateKeys } from "@/lib/site-coverage-days";
import { downloadSiteTimesheetCsv, exportSiteTimesheetPdf } from "@/lib/site-timesheet-export";
import { hasCapability } from "@/lib/permissions";
import { Button, ConfirmModal, Field, Modal, Textarea, useConfirmDialog } from "@/components/ui";
import { useSiteTimesheet, type SiteTimesheetFocus } from "@/hooks/use-site-timesheet";

/** "Sat 8 Aug" — date keys are UTC calendar days, so read them back in UTC. */
function formatNoShiftDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function SiteTimesheetsSection({
  token,
  siteId,
  siteName,
  periodStart,
  periodEnd,
  shiftType = "all",
  focus,
  returnTo,
  showAllHref,
}: {
  token: string;
  siteId: string;
  siteName?: string;
  periodStart: string;
  periodEnd: string;
  shiftType?: AttendanceShiftTypeFilter;
  focus?: SiteTimesheetFocus;
  returnTo?: string;
  showAllHref?: string;
}) {
  const { user } = useAuth();
  // Either module's grant works here on purpose — attendance capture belongs to both the
  // attendance and rostering workflows.
  const permission = (action: "create" | "edit" | "approve" | "export") =>
    Boolean(
      user && (hasCapability(user, "/attendance", action) || hasCapability(user, "/rostering", action))
    );
  const permissions = useMemo(
    () => ({
      canCreate: permission("create"),
      canEdit: permission("edit"),
      canApprove: permission("approve"),
      canExport: permission("export"),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user]
  );
  const { canCreate, canEdit, canApprove, canExport } = permissions;

  const timesheet = useSiteTimesheet({
    token,
    siteId,
    periodStart,
    periodEnd,
    shiftType,
    permissions,
    focus,
  });
  const {
    sheet,
    guardOptions,
    loading,
    savingRowId,
    error,
    setError,
    notice,
    setNotice,
    showNotice,
    locked,
    readOnly,
    canEditLockedOb,
    guardFilter,
    setGuardFilter,
    reviewFilter,
    setReviewFilter,
    shiftScopedRows,
    displayRows,
    bulkConfirmableRows,
    reviewedCount,
    pendingReviewCount,
    otherShiftPendingCount,
    focusActive,
    focusedRow,
    load,
  } = timesheet;

  const { confirm, confirmDialog } = useConfirmDialog();
  const [showRelieverForm, setShowRelieverForm] = useState(false);
  const [showSecondaryActions, setShowSecondaryActions] = useState(false);
  const [bulkRows, setBulkRows] = useState<SiteTimesheetRow[] | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const [viewMode, setViewMode] = useState<"by_date" | "by_guard">("by_date");

  const displaySiteName = sheet?.siteName ?? siteName;
  const guardFilterActive = guardFilter.trim().length > 0;
  const shiftFilterActive = shiftType !== "all";
  const shiftLabel = shiftType === "day" ? "day-shift" : shiftType === "night" ? "night-shift" : "all";

  useEffect(() => {
    if (!focusedRow) return;
    const frame = window.requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-attendance-row-id]"))
        .find((element) => element.dataset.attendanceRowId === focusedRow.id && element.offsetParent !== null);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedRow]);

  /**
   * Days in this period the site does not run, taken from its "Days covered" picker. These
   * never produce roster shifts, so attendance has nothing to capture — naming them stops a
   * controller hunting for rows that were never meant to exist.
   */
  const noShiftDates = useMemo(() => {
    if (!sheet?.coverageDays) return [];
    return noShiftDateKeys(sheet.coverageDays, sheet.periodStart, sheet.periodEnd, shiftType);
  }, [sheet?.coverageDays, sheet?.periodStart, sheet?.periodEnd, shiftType]);

  /** Bulk-confirmable rows grouped by date, so a controller can do one day at a time. */
  const bulkByDate = useMemo(() => {
    const byDate = new Map<string, SiteTimesheetRow[]>();
    for (const row of bulkConfirmableRows) {
      byDate.set(row.workDate, [...(byDate.get(row.workDate) ?? []), row]);
    }
    return byDate;
  }, [bulkConfirmableRows]);

  const approveTimesheet = async () => {
    if (!sheet || !canApprove) return;
    if (pendingReviewCount > 0) {
      showNotice(
        "Cannot approve timesheet yet",
        `${pendingReviewCount} ${shiftType === "all" ? "row" : `${shiftLabel} row`}${pendingReviewCount === 1 ? "" : "s"} still need confirmation.\n\n` +
          `For each one: enter both OB numbers and select Confirm attendance. Use "Confirm all as scheduled" for routine shifts.`
      );
      return;
    }
    const accepted = await confirm({
      title: otherShiftPendingCount > 0 ? `Approve ${shiftLabel}` : "Approve timesheet for export",
      message:
        otherShiftPendingCount > 0
          ? `Approve ${shiftScopedRows.length} confirmed ${shiftLabel} attendance entries? The timesheet will remain open because ${otherShiftPendingCount} other-shift entries still need review.`
          : `Approve and lock this site timesheet (${shiftScopedRows.length} ${shiftLabel} attendance entries)?`,
      confirmLabel: "Approve timesheet",
      danger: false,
    });
    if (!accepted) return;
    const result = await timesheet.approveVisibleTimesheet();
    if (result && !result.locked && result.remainingPending > 0) {
      showNotice(
        "Shift approved",
        `${result.approvedRowCount} attendance entries approved. ${result.remainingPending} entries on the other shift still need review before lock.`
      );
    }
  };

  if (loading && !sheet) {
    return (
      <div className="rounded-security-lg border border-security-navy-100 bg-white p-4 text-sm text-security-navy-500">
        Loading site timesheet…
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card">
      <ConfirmModal
        open={Boolean(notice)}
        title={notice?.title ?? ""}
        message={notice?.message ?? ""}
        confirmLabel="Got it"
        cancelLabel="Close"
        danger={false}
        onCancel={() => setNotice(null)}
        onConfirm={() => setNotice(null)}
      />
      {confirmDialog}

      {bulkRows && (
        <SiteTimesheetBulkConfirmModal
          rows={bulkRows}
          saving={bulkSaving}
          obBookMode={sheet?.obBookMode ?? "REQUIRED"}
          onCancel={() => setBulkRows(null)}
          onSubmit={async (entries) => {
            setBulkSaving(true);
            try {
              const result = await timesheet.bulkConfirm(entries);
              if (result) {
                // Keep only the rows that came back rejected so the controller can see why.
                const failedIds = new Set(result.failed.map((failure) => failure.rowId));
                setBulkRows((current) =>
                  current && failedIds.size > 0
                    ? current.filter((row) => failedIds.has(row.id))
                    : current
                );
              }
              return result;
            } finally {
              setBulkSaving(false);
            }
          }}
        />
      )}

      <Modal
        open={Boolean(unlockOpen && canApprove)}
        onClose={() => setUnlockOpen(false)}
        title="Unlock approved timesheet"
        description="Unlocking allows attendance changes. The reason is saved in the audit trail."
        size="sm"
      >
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await timesheet.submitUnlock(unlockReason);
            if (ok) {
              setUnlockOpen(false);
              setUnlockReason("");
              setShowSecondaryActions(false);
            }
          }}
        >
          <Field label="Reason for unlocking" id="unlock-reason">
            <Textarea
              value={unlockReason}
              onChange={(event) => setUnlockReason(event.target.value)}
              rows={3}
              autoFocus
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUnlockOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!unlockReason.trim()}>
              Unlock timesheet
            </Button>
          </div>
        </form>
      </Modal>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-security-navy-900">
            Site Timesheet{displaySiteName ? ` — ${displaySiteName}` : ""}
          </h2>
          <p className="mt-1 text-sm text-security-navy-500">
            Review and edit who actually worked, then approve. The approved timesheet is the official
            attendance record and the source for Sage payroll export hours.
          </p>
        </div>
        {sheet && (canEdit || canApprove || canExport) && (
          <div className="relative flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <button
              type="button"
              className="btn-secondary min-h-11 w-full sm:w-auto"
              onClick={() => setShowSecondaryActions((value) => !value)}
              aria-expanded={showSecondaryActions}
              aria-controls="timesheet-secondary-actions"
            >
              More actions
            </button>
            {showSecondaryActions && (
              <div
                id="timesheet-secondary-actions"
                className="z-20 grid gap-2 rounded-lg border border-security-navy-100 bg-white p-2 shadow-lg sm:absolute sm:right-0 sm:top-12 sm:min-w-52"
              >
                {!locked && canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      void timesheet.refreshFromShifts();
                      setShowSecondaryActions(false);
                    }}
                    className="btn-secondary min-h-11 text-left"
                  >
                    Refresh from shifts
                  </button>
                )}
                {canExport && sheet && (
                  <button
                    type="button"
                    onClick={() => {
                      exportSiteTimesheetPdf({ sheet, rows: shiftScopedRows, shiftType });
                      setShowSecondaryActions(false);
                    }}
                    className="btn-secondary min-h-11 text-left"
                  >
                    Download PDF
                  </button>
                )}
                {canExport && sheet && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await downloadSiteTimesheetCsv({
                          token,
                          sheet,
                          siteId,
                          periodStart,
                          periodEnd,
                          shiftType,
                        });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to download CSV");
                      } finally {
                        setShowSecondaryActions(false);
                      }
                    }}
                    className="btn-secondary min-h-11 text-left"
                  >
                    Download CSV
                  </button>
                )}
                {locked && canApprove && (
                  <button
                    type="button"
                    onClick={() => setUnlockOpen(true)}
                    className="btn-secondary min-h-11 text-left"
                  >
                    Admin unlock
                  </button>
                )}
              </div>
            )}
            {!locked && canApprove && (
              <button
                type="button"
                onClick={() => void approveTimesheet()}
                disabled={pendingReviewCount > 0 || shiftScopedRows.length === 0}
                className="btn-primary min-h-11 w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                aria-describedby={pendingReviewCount > 0 ? "timesheet-approval-help" : undefined}
              >
                {shiftType === "all" ? "Approve timesheet" : `Approve ${shiftLabel}`}
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
          aria-live="assertive"
        >
          <span>{error}</span>
          <button type="button" className="min-h-11 font-semibold underline" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {locked && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-security-emerald-200 bg-security-emerald-50 px-3 py-2 text-sm text-security-emerald-700">
          <span>
            Attendance {sheet?.status === "locked" ? "locked" : "approved"} for this period. Next step:
            export verified hours to Sage.
          </span>
          <Link href="/payroll-exports" className="btn-primary">
            Go to Payroll Export
          </Link>
        </div>
      )}

      {focusActive && (
        <div
          className="flex flex-col gap-3 rounded-lg border-2 border-security-amber-400 bg-security-amber-50 px-4 py-3 text-sm text-security-navy-900 sm:flex-row sm:items-center sm:justify-between"
          role="status"
        >
          <div>
            <p className="font-semibold">
              {focusedRow ? "Attendance issue record found" : "Attendance issue record not found"}
            </p>
            <p className="mt-1 text-xs text-security-navy-600">
              {focusedRow
                ? `${focusedRow.workDate} · ${focusedRow.actualGuardName ?? focusedRow.plannedGuardName ?? "Unassigned guard"}. Review the highlighted row and save the corrected attendance.`
                : "The linked shift is not in this timesheet yet. Refresh the timesheet from roster shifts, or show the full timesheet to locate it manually."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {showAllHref && (
              <Link href={showAllHref} className="btn-secondary min-h-11">
                Show full timesheet
              </Link>
            )}
            {returnTo && (
              <Link href={returnTo} className="btn-primary min-h-11">
                Back to attendance issues
              </Link>
            )}
          </div>
        </div>
      )}

      {sheet && (
        <>
          <div className="grid gap-2 text-xs sm:grid-cols-7">
            {[
              ["Status", humanizeCode(sheet.status)],
              [
                shiftType === "all" ? "Confirmed" : `Confirmed (${shiftLabel})`,
                `${reviewedCount}/${shiftScopedRows.length}`,
              ],
              ["Day shifts", sheet.totals.dayShifts],
              ["Night shifts", sheet.totals.nightShifts],
              ["Hours", sheet.totals.totalHours],
              ["Relievers", sheet.totals.relieverShifts],
              ["Discrepancies", sheet.totals.discrepancies],
            ].map(([title, value]) => (
              <div
                key={String(title)}
                className="rounded-lg border border-security-navy-100 bg-security-navy-50 px-3 py-2"
              >
                <p className="text-security-navy-500">{title}</p>
                <p className="mt-1 font-semibold text-security-navy-900">{value}</p>
              </div>
            ))}
          </div>

          {!locked && pendingReviewCount > 0 && (
            <div
              id="timesheet-approval-help"
              className="rounded-lg border border-security-amber-200 bg-security-amber-50 px-3 py-2 text-sm text-security-amber-900"
            >
              <span className="font-medium">{pendingReviewCount}</span>{" "}
              {shiftType === "all" ? "entry" : `${shiftLabel} entry`}
              {pendingReviewCount === 1 ? "" : "s"} still need confirmation
              {otherShiftPendingCount > 0 ? ` · ${otherShiftPendingCount} on the other shift` : ""}.{" "}
              {bulkConfirmableRows.length > 0
                ? `${bulkConfirmableRows.length} match the roster and can be confirmed together.`
                : "Confirm each one and enter both Occurrence Book numbers. Status is set automatically."}
            </div>
          )}

          {!locked && pendingReviewCount === 0 && otherShiftPendingCount > 0 && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              All visible {shiftLabel} rows are reviewed. Switch to the other shift to finish{" "}
              <span className="font-medium">{otherShiftPendingCount}</span> pending row
              {otherShiftPendingCount === 1 ? "" : "s"} before the timesheet locks for export.
            </div>
          )}

          {!locked && canCreate && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowRelieverForm(true)}
                className="btn-secondary min-h-11"
              >
                Add a reliever or unrostered guard
              </button>
            </div>
          )}
          {showRelieverForm && sheet && (
            <SiteTimesheetRelieverForm
              guardOptions={guardOptions}
              periodStart={periodStart}
              periodEnd={periodEnd}
              onClose={() => setShowRelieverForm(false)}
              onSubmit={async (draft) => {
                try {
                  setError(null);
                  await addSiteTimesheetRow(token, sheet.id, {
                    ...draft,
                    dutyOnObNumber: draft.dutyOnObNumber.trim(),
                    dutyOffObNumber: draft.dutyOffObNumber.trim() || null,
                  });
                  setShowRelieverForm(false);
                  await load();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to add reliever row");
                }
              }}
            />
          )}

          {/* Confirming a routine day is one action; exceptions still go row by row. */}
          {!locked && canEdit && bulkConfirmableRows.length > 0 && (
            <div className="flex flex-col gap-3 rounded-lg border border-security-navy-200 bg-security-navy-50/60 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-security-navy-900">
                  {bulkConfirmableRows.length} shift{bulkConfirmableRows.length === 1 ? "" : "s"} match
                  the roster
                </p>
                <p className="mt-0.5 text-xs text-security-navy-600">
                  Confirm them together — you only need to enter the occurrence book numbers.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {bulkByDate.size > 1 &&
                  [...bulkByDate.entries()].slice(0, 3).map(([date, rows]) => (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setBulkRows(rows)}
                      className="btn-secondary min-h-11 text-sm"
                    >
                      {date} ({rows.length})
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => setBulkRows(bulkConfirmableRows)}
                  className="btn-primary min-h-11"
                >
                  Confirm all as scheduled ({bulkConfirmableRows.length})
                </button>
              </div>
            </div>
          )}

          {noShiftDates.length > 0 && (
            <div className="rounded-lg border border-security-navy-100 bg-security-navy-50 px-3 py-2">
              <p className="text-sm font-semibold text-security-navy-700">
                {NO_SHIFT_LABEL} — {noShiftDates.length} day{noShiftDates.length === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-xs text-security-navy-500">
                This site runs no {shiftType === "all" ? "" : `${shiftLabel} `}shift on these days, so
                there is nothing to capture. Change it under Days covered on the site.
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {noShiftDates.map((date) => (
                  <span
                    key={date}
                    className="rounded-full border border-security-navy-100 bg-white px-2 py-0.5 text-[11px] font-medium text-security-navy-500"
                  >
                    {formatNoShiftDate(date)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-lg border border-security-navy-100 bg-security-navy-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-security-navy-900">
                Attendance entries
              </p>
              <p className="text-xs text-security-navy-500">
                {focusActive
                  ? "Showing the attendance entry linked to the selected issue."
                  : "Pending work is shown first so unfinished attendance is not missed."}
              </p>
            </div>
            {!focusActive && (
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="flex rounded-lg border border-security-navy-100 bg-white p-1"
                  role="group"
                  aria-label="Timesheet view grouping"
                >
                  <button
                    type="button"
                    aria-pressed={viewMode === "by_date"}
                    onClick={() => setViewMode("by_date")}
                    className={clsx(
                      "min-h-11 rounded-md px-3 text-xs font-semibold",
                      viewMode === "by_date"
                        ? "bg-[var(--accent-primary)] text-white"
                        : "text-security-navy-700"
                    )}
                  >
                    By Date
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewMode === "by_guard"}
                    onClick={() => setViewMode("by_guard")}
                    className={clsx(
                      "min-h-11 rounded-md px-3 text-xs font-semibold",
                      viewMode === "by_guard"
                        ? "bg-[var(--accent-primary)] text-white"
                        : "text-security-navy-700"
                    )}
                  >
                    By Guard (SA Pay)
                  </button>
                </div>

                {viewMode === "by_date" && (
                  <div
                    className="flex flex-wrap gap-1 rounded-lg border border-security-navy-100 bg-white p-1"
                    role="group"
                    aria-label="Show attendance entries"
                  >
                    {(
                      [
                        ["pending", `Needs confirmation (${pendingReviewCount})`],
                        ["confirmed", `Confirmed (${reviewedCount})`],
                        ["all", `All (${shiftScopedRows.length})`],
                      ] as const
                    ).map(([value, text]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setReviewFilter(value)}
                        aria-pressed={reviewFilter === value}
                        className={clsx(
                          "min-h-11 rounded-md px-3 text-sm font-medium",
                          reviewFilter === value
                            ? "bg-security-navy-800 text-white"
                            : "text-security-navy-700 hover:bg-security-navy-50"
                        )}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {!focusActive && <div className="flex flex-col gap-2 rounded-lg border border-security-navy-100 bg-white p-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label
                htmlFor="site-timesheet-guard-filter"
                className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500"
              >
                Search / filter by guard
              </label>
              <input
                id="site-timesheet-guard-filter"
                type="search"
                value={guardFilter}
                onChange={(e) => setGuardFilter(e.target.value)}
                placeholder="Type a guard name or employee number…"
                className="input-modern mt-1 w-full"
                autoComplete="off"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {guardFilterActive && (
                <p className="text-xs text-security-navy-500">
                  Showing {displayRows.length} of {shiftScopedRows.length} day
                  {shiftScopedRows.length === 1 ? "" : "s"}
                </p>
              )}
              {!guardFilterActive && shiftFilterActive && (
                <p className="text-xs text-security-navy-500">
                  Showing {displayRows.length} of {shiftScopedRows.length}{" "}
                  {shiftType === "day" ? "day" : "night"}-shift attendance entries
                </p>
              )}
              <button
                type="button"
                onClick={() => setGuardFilter("")}
                disabled={!guardFilterActive}
                className="btn-secondary disabled:opacity-40"
              >
                Clear filter
              </button>
            </div>
          </div>}

          {guardFilterActive && displayRows.length === 0 && (
            <div className="rounded-lg border border-security-navy-100 bg-security-navy-50 px-3 py-3 text-sm text-security-navy-600">
              No timesheet days match “{guardFilter.trim()}”. Clear the filter to see all guards again.
            </div>
          )}
          {!guardFilterActive && shiftFilterActive && shiftScopedRows.length === 0 && (
            <div className="rounded-lg border border-security-navy-100 bg-security-navy-50 px-3 py-3 text-sm text-security-navy-600">
              No {shiftType === "day" ? "day" : "night"}-shift rows for this site in the selected
              period. Switch shift type above to review the other shift.
            </div>
          )}
          {!focusActive && !guardFilterActive && shiftScopedRows.length > 0 && displayRows.length === 0 && (
            <div
              className="rounded-lg border border-security-emerald-200 bg-security-emerald-50 px-4 py-4 text-sm text-security-emerald-700"
              role="status"
            >
              {reviewFilter === "pending"
                ? "All visible attendance entries are confirmed. Use the approval button below when you are ready."
                : "No attendance entries match this review status."}
            </div>
          )}

          {viewMode === "by_guard" ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-security-navy-100 bg-security-navy-50/70 px-4 py-3 text-xs text-security-navy-700">
                South African NBCPSS payroll preview per guard across all captured shifts on this site. OB mode: <strong>{sheet.obBookMode ?? "REQUIRED"}</strong>.
              </div>
              <div
                role="region"
                tabIndex={0}
                aria-label="Per-guard SA NBCPSS hours summary"
                className="overflow-x-auto rounded-lg border border-security-navy-100"
              >
                <table className="min-w-full text-xs text-left">
                  <thead className="bg-security-navy-50 text-security-navy-600 border-b border-security-navy-100">
                    <tr>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Guard</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">Total (h)</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">Basic &lt;=48h</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">Overtime 1.5x</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">Sunday 1.5x</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">Sunday 2x</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">Pub Hol 2x</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">Night Allow.</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">SA Compliance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-security-navy-100">
                    {(sheet.guardSummaries ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-6 text-center text-security-navy-500">
                          Confirm shifts in &ldquo;By Date&rdquo; to preview South African pay-period hour buckets per guard.
                        </td>
                      </tr>
                    ) : (
                      (sheet.guardSummaries ?? []).map((gs) => (
                        <tr key={gs.employeeId}>
                          <th scope="row" className="px-3 py-2.5 font-medium text-security-navy-900">
                            {gs.guardName}{" "}
                            <span className="text-security-navy-500 font-normal">({gs.employeeNumber})</span>
                          </th>
                          <td className="px-3 py-2.5 text-right tabular-nums">{gs.totalWorkedHours}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{gs.basicHours}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${gs.overtimeHours > 0 ? "text-amber-700" : ""}`}>
                            {gs.overtimeHours}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{gs.sundayHours}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{gs.sundayDoubleHours}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{gs.publicHolidayHours}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {gs.nightShiftCount} (R{gs.nightAllowanceTotalRand.toFixed(2)})
                          </td>
                          <td className="px-3 py-2.5">
                            {gs.flags.length === 0 ? (
                              <span className="rounded bg-emerald-100 text-emerald-900 px-2 py-0.5 text-[10px] font-semibold">
                                Compliant
                              </span>
                            ) : (
                              <span className="text-amber-800">
                                {gs.flags.map((f) => f.message).join("; ")}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3 xl:hidden">
                {displayRows.map((row) => (
                  <SiteTimesheetRowCard
                    key={row.id}
                    row={row}
                    guards={guardOptions}
                    locked={locked || !canEdit}
                    saving={savingRowId === row.id}
                    obBookMode={sheet.obBookMode ?? "REQUIRED"}
                    dutyOnObNumber={timesheet.getDutyOnDraft(row)}
                    dutyOffObNumber={timesheet.getDutyOffDraft(row)}
                    onDutyOnObNumberChange={(value) => timesheet.setDutyOnDraft(row.id, value)}
                    onDutyOffObNumberChange={(value) => timesheet.setDutyOffDraft(row.id, value)}
                    onDutyOnObNumberSave={(value) => void timesheet.saveDutyObNumber(row, "on", value)}
                    onDutyOffObNumberSave={(value) => void timesheet.saveDutyObNumber(row, "off", value)}
                    canEditLockedOb={canEditLockedOb}
                    onUpdate={(r, patch) => void timesheet.updateRow(r, patch)}
                    onApprove={(r) => void timesheet.approveRowAttendance(r)}
                    onReopen={(r) => void timesheet.reopenRow(r)}
                    focused={focusedRow?.id === row.id}
                  />
                ))}
              </div>

              <SiteTimesheetTable
                rows={displayRows}
                guardOptions={guardOptions}
                locked={locked}
                readOnly={readOnly}
                canEdit={canEdit}
                canEditLockedOb={canEditLockedOb}
                savingRowId={savingRowId}
                obBookMode={sheet.obBookMode ?? "REQUIRED"}
                getDutyOnDraft={timesheet.getDutyOnDraft}
                getDutyOffDraft={timesheet.getDutyOffDraft}
                setDutyOnDraft={timesheet.setDutyOnDraft}
                setDutyOffDraft={timesheet.setDutyOffDraft}
                onSaveDutyOb={(row, which) => void timesheet.saveDutyObNumber(row, which)}
                onUpdate={(row, patch) => void timesheet.updateRow(row, patch)}
                onApprove={(row) => void timesheet.approveRowAttendance(row)}
                onReopen={(row) => void timesheet.reopenRow(row)}
                focusedRowId={focusedRow?.id}
              />
            </>
          )}
        </>
      )}

      {sheet && !locked && (
        <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-security-lg border border-security-navy-200 bg-white/95 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-security-navy-900">
              {pendingReviewCount === 0
                ? "Visible attendance is ready for approval"
                : `${pendingReviewCount} attendance ${pendingReviewCount === 1 ? "entry needs" : "entries need"} confirmation`}
            </p>
            <p className="mt-0.5 text-xs text-security-navy-500">
              {otherShiftPendingCount > 0
                ? `${otherShiftPendingCount} entries on the other shift will still need attention before export lock.`
                : "Approving the final shift locks this site timesheet for payroll export."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && bulkConfirmableRows.length > 0 && (
              <button
                type="button"
                onClick={() => setBulkRows(bulkConfirmableRows)}
                className="btn-secondary min-h-11"
              >
                Confirm all as scheduled ({bulkConfirmableRows.length})
              </button>
            )}
            {canApprove && (
              <button
                type="button"
                onClick={() => void approveTimesheet()}
                disabled={pendingReviewCount > 0 || shiftScopedRows.length === 0}
                className="btn-primary min-h-11 w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {shiftType === "all" ? "Approve timesheet" : `Approve ${shiftLabel}`}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
