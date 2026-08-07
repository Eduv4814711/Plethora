"use client";

import { useMemo, useState } from "react";
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
import { ConfirmModal, useConfirmDialog } from "@/components/ui";
import { useSiteTimesheet } from "@/hooks/use-site-timesheet";

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
}: {
  token: string;
  siteId: string;
  siteName?: string;
  periodStart: string;
  periodEnd: string;
  shiftType?: AttendanceShiftTypeFilter;
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
    load,
  } = timesheet;

  const { confirm, confirmDialog } = useConfirmDialog();
  const [showRelieverForm, setShowRelieverForm] = useState(false);
  const [showSecondaryActions, setShowSecondaryActions] = useState(false);
  const [bulkRows, setBulkRows] = useState<SiteTimesheetRow[] | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");

  const displaySiteName = sheet?.siteName ?? siteName;
  const guardFilterActive = guardFilter.trim().length > 0;
  const shiftFilterActive = shiftType !== "all";
  const shiftLabel = shiftType === "day" ? "day-shift" : shiftType === "night" ? "night-shift" : "all";

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
      title: otherShiftPendingCount > 0 ? `Approve ${shiftLabel}` : "Approve timesheet for payroll",
      message:
        otherShiftPendingCount > 0
          ? `Approve ${shiftScopedRows.length} confirmed ${shiftLabel} attendance entries? The timesheet will remain open because ${otherShiftPendingCount} other-shift entries still need review.`
          : `Approve and lock this site timesheet for payroll (${shiftScopedRows.length} ${shiftLabel} attendance entries)?`,
      confirmLabel: "Approve timesheet",
      danger: false,
    });
    if (!accepted) return;
    const result = await timesheet.approveVisibleTimesheet();
    if (result && !result.locked && result.remainingPending > 0) {
      showNotice(
        "Shift approved",
        `${result.approvedRowCount} attendance entries approved. ${result.remainingPending} entries on the other shift still need review before payroll lock.`
      );
    }
  };

  if (loading && !sheet) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
        Loading site timesheet…
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-950">
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

      {unlockOpen && canApprove && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4" role="presentation">
          <form
            className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-700 dark:bg-neutral-950"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unlock-timesheet-title"
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
            <h2 id="unlock-timesheet-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Unlock approved timesheet
            </h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              Unlocking allows attendance changes. The reason is saved in the audit trail.
            </p>
            <label htmlFor="unlock-reason" className="mt-4 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Reason for unlocking
            </label>
            <textarea
              id="unlock-reason"
              value={unlockReason}
              onChange={(event) => setUnlockReason(event.target.value)}
              rows={3}
              className="input-modern mt-1 w-full"
              autoFocus
              required
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary min-h-11" onClick={() => setUnlockOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary min-h-11" disabled={!unlockReason.trim()}>
                Unlock timesheet
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            Site Timesheet{displaySiteName ? ` — ${displaySiteName}` : ""}
          </h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Review and edit who actually worked, then approve. The approved timesheet is the official
            attendance record and the source for payroll actuals.
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
                className="z-20 grid gap-2 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 sm:absolute sm:right-0 sm:top-12 sm:min-w-52"
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <span>
            Attendance {sheet?.status === "locked" ? "locked" : "approved"} for this period. Next step:
            process payroll from the verified hours.
          </span>
          <Link href="/payroll" className="btn-primary">
            Go to Payroll
          </Link>
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
                className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              >
                <p className="text-neutral-500">{title}</p>
                <p className="mt-1 font-semibold text-neutral-900 dark:text-neutral-100">{value}</p>
              </div>
            ))}
          </div>

          {!locked && pendingReviewCount > 0 && (
            <div
              id="timesheet-approval-help"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
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
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
              All visible {shiftLabel} rows are reviewed. Switch to the other shift to finish{" "}
              <span className="font-medium">{otherShiftPendingCount}</span> pending row
              {otherShiftPendingCount === 1 ? "" : "s"} before the timesheet can lock for payroll.
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
            <div className="flex flex-col gap-3 rounded-lg border border-security-navy-200 bg-security-navy-50/60 p-3 dark:border-security-navy-700 dark:bg-security-navy-950/30 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {bulkConfirmableRows.length} shift{bulkConfirmableRows.length === 1 ? "" : "s"} match
                  the roster
                </p>
                <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
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
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
              <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                {NO_SHIFT_LABEL} — {noShiftDates.length} day{noShiftDates.length === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                This site runs no {shiftType === "all" ? "" : `${shiftLabel} `}shift on these days, so
                there is nothing to capture. Change it under Days covered on the site.
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {noShiftDates.map((date) => (
                  <span
                    key={date}
                    className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400"
                  >
                    {formatNoShiftDate(date)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Attendance entries
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Pending work is shown first so unfinished attendance is not missed.
              </p>
            </div>
            <div
              className="flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-white p-1 dark:border-neutral-700 dark:bg-neutral-950"
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
                      ? "bg-security-navy-800 text-white dark:bg-security-navy-600"
                      : "text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  )}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-950 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label
                htmlFor="site-timesheet-guard-filter"
                className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500"
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
                <p className="text-xs text-neutral-500">
                  Showing {displayRows.length} of {shiftScopedRows.length} day
                  {shiftScopedRows.length === 1 ? "" : "s"}
                </p>
              )}
              {!guardFilterActive && shiftFilterActive && (
                <p className="text-xs text-neutral-500">
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
          </div>

          {guardFilterActive && displayRows.length === 0 && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              No timesheet days match “{guardFilter.trim()}”. Clear the filter to see all guards again.
            </div>
          )}
          {!guardFilterActive && shiftFilterActive && shiftScopedRows.length === 0 && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              No {shiftType === "day" ? "day" : "night"}-shift rows for this site in the selected
              period. Switch shift type above to review the other shift.
            </div>
          )}
          {!guardFilterActive && shiftScopedRows.length > 0 && displayRows.length === 0 && (
            <div
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
              role="status"
            >
              {reviewFilter === "pending"
                ? "All visible attendance entries are confirmed. Use the approval button below when you are ready."
                : "No attendance entries match this review status."}
            </div>
          )}

          <div className="space-y-3 xl:hidden">
            {displayRows.map((row) => (
              <SiteTimesheetRowCard
                key={row.id}
                row={row}
                guards={guardOptions}
                locked={locked || !canEdit}
                saving={savingRowId === row.id}
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
            getDutyOnDraft={timesheet.getDutyOnDraft}
            getDutyOffDraft={timesheet.getDutyOffDraft}
            setDutyOnDraft={timesheet.setDutyOnDraft}
            setDutyOffDraft={timesheet.setDutyOffDraft}
            onSaveDutyOb={(row, which) => void timesheet.saveDutyObNumber(row, which)}
            onUpdate={(row, patch) => void timesheet.updateRow(row, patch)}
            onApprove={(row) => void timesheet.approveRowAttendance(row)}
            onReopen={(row) => void timesheet.reopenRow(row)}
          />
        </>
      )}

      {sheet && !locked && (
        <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border border-security-navy-200 bg-white/95 p-4 shadow-xl backdrop-blur dark:border-security-navy-700 dark:bg-neutral-950/95 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {pendingReviewCount === 0
                ? "Visible attendance is ready for approval"
                : `${pendingReviewCount} attendance ${pendingReviewCount === 1 ? "entry needs" : "entries need"} confirmation`}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {otherShiftPendingCount > 0
                ? `${otherShiftPendingCount} entries on the other shift will still need attention before payroll lock.`
                : "Approving the final shift locks this site timesheet for payroll."}
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
