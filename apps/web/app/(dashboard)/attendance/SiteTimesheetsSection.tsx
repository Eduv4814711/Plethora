"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { clsx } from "clsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { authFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { GuardSearchPicker } from "@/components/guard-search-picker";
import { SiteTimesheetRowCard } from "@/components/site-timesheet-row-card";
import { ShiftTimeSelect } from "@/components/shift-time-select";
import { defaultShiftTime, displayShiftTime } from "@/lib/shift-times";
import {
  addSiteTimesheetRow,
  approveSiteTimesheet,
  fetchSecurityGuardOptions,
  fetchSiteTimesheet,
  mergeTimesheetGuardOptions,
  resyncSiteTimesheet,
  siteTimesheetCsvUrl,
  type GuardPickerOption,
  type SiteTimesheet,
  type SiteTimesheetAttendance,
  type SiteTimesheetRow,
  type AttendanceShiftTypeFilter,
  unlockSiteTimesheet,
  updateSiteTimesheetRow,
} from "@/lib/roster-api";
import {
  formatAttendanceStatus,
  isRowFullyReviewed,
  isRowPendingReview,
  resolveAttendanceStatusOnApprove,
  resolveDutyOffFromRow,
  resolveDutyOnFromRow,
  rowMatchesShiftTypeFilter,
  rowNeedsObNumbers,
  sortSiteTimesheetRows,
} from "@/lib/site-timesheet-utils";
import { isFullAdmin } from "@/lib/permissions";
import { ConfirmModal, useConfirmDialog } from "@/components/ui";

type GuardOption = GuardPickerOption;

type NoticeDialog = {
  title: string;
  message: string;
};

function label(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "Not set";
}

function normalizeShiftType(value: string | null | undefined): "day" | "night" | null {
  if (!value) return null;
  if (value === "day" || value === "D") return "day";
  if (value === "night" || value === "N") return "night";
  return null;
}

function rowShiftType(row: SiteTimesheetRow): "day" | "night" | null {
  return normalizeShiftType(
    row.actualShiftType ?? row.plannedShiftType ?? row.actualShiftCode ?? row.plannedShiftCode
  );
}

/** Combine a work date (yyyy-MM-dd) with an HH:mm time into a local-time ISO string. */
function combineDateTime(workDate: string, time: string): string | null {
  if (!time) return null;
  const d = new Date(`${workDate}T${time}:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function combineClockOut(workDate: string, time: string, clockIn: string | null): string | null {
  const out = combineDateTime(workDate, time);
  if (!out || !clockIn) return out;
  if (new Date(out).getTime() <= new Date(clockIn).getTime()) {
    const next = new Date(`${workDate}T00:00:00`);
    next.setDate(next.getDate() + 1);
    const nextDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    return combineDateTime(nextDate, time);
  }
  return out;
}

function hoursBetween(clockIn: string | null, clockOut: string | null): number | null {
  if (!clockIn || !clockOut) return null;
  let start = new Date(clockIn).getTime();
  let end = new Date(clockOut).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  // Night shifts: an end at/earlier than the start rolls over to the next day.
  if (end <= start) end += 24 * 60 * 60 * 1000;
  return Math.round(((end - start) / (1000 * 60 * 60)) * 100) / 100;
}

function shiftTypeTimesPatch(
  workDate: string,
  shiftType: "day" | "night" | null
): { clockIn: string | null; clockOut: string | null; hoursWorked: number | null } {
  if (!shiftType) return { clockIn: null, clockOut: null, hoursWorked: null };
  const startTime = defaultShiftTime(shiftType, "start");
  const clockIn = combineDateTime(workDate, startTime);
  const endTime = defaultShiftTime(shiftType, "end");
  const clockOut = combineClockOut(workDate, endTime, clockIn);
  return { clockIn, clockOut, hoursWorked: hoursBetween(clockIn, clockOut) };
}

function buildRowApprovalPatch(
  row: SiteTimesheetRow,
  dutyOnObNumber: string,
  dutyOffObNumber: string
): Partial<SiteTimesheetRow> {
  const plannedShiftType = normalizeShiftType(row.plannedShiftType ?? row.plannedShiftCode);
  const explicitNotWorked =
    row.actualGuardId === null &&
    (row.actualShiftType === null || row.actualShiftType === "") &&
    !row.clockIn &&
    !row.clockOut;

  // If the controller cleared who worked / shift, keep that and mark absent.
  // Otherwise default missing fields from the rostered plan when approving.
  const actualGuardId = explicitNotWorked
    ? null
    : (row.actualGuardId ?? row.plannedGuardId);
  const shiftType = explicitNotWorked
    ? null
    : normalizeShiftType(row.actualShiftType ?? row.actualShiftCode) ?? plannedShiftType;
  const actualShiftType = explicitNotWorked ? null : (row.actualShiftType ?? shiftType);
  const actualShiftCode = explicitNotWorked
    ? null
    : (row.actualShiftCode ??
      (shiftType === "night" ? "N" : shiftType === "day" ? "D" : null));

  const startTime = displayShiftTime(row.clockIn, shiftType, "start");
  const endTime = displayShiftTime(row.clockOut, shiftType, "end");
  const clockIn = explicitNotWorked
    ? null
    : (row.clockIn ?? (startTime ? combineDateTime(row.workDate, startTime) : null));
  const clockOut = explicitNotWorked
    ? null
    : (row.clockOut ?? (endTime ? combineClockOut(row.workDate, endTime, clockIn) : null));

  return {
    actualGuardId,
    clockIn,
    clockOut,
    hoursWorked: explicitNotWorked ? null : (row.hoursWorked ?? hoursBetween(clockIn, clockOut)),
    attendanceStatus: resolveAttendanceStatusOnApprove({
      plannedGuardId: row.plannedGuardId,
      actualGuardId,
      plannedShiftCode: row.plannedShiftCode,
      actualShiftCode,
      actualShiftType,
      clockIn,
      clockOut,
    }),
    actualShiftType,
    actualShiftCode,
    dutyOnObNumber,
    dutyOffObNumber,
    occurrenceBookNumber: dutyOnObNumber,
    approvalStatus: "reviewed",
  };
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
  const canEditLockedOb = Boolean(user && isFullAdmin(user));
  const [sheet, setSheet] = useState<SiteTimesheet | null>(null);
  const [guards, setGuards] = useState<GuardOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Centered notice so approve blockers are never missed at the top of a long page. */
  const [notice, setNotice] = useState<NoticeDialog | null>(null);
  /** Draft Duty ON/OFF OB numbers before Approve. */
  const [dutyOnDrafts, setDutyOnDrafts] = useState<Record<string, string>>({});
  const [dutyOffDrafts, setDutyOffDrafts] = useState<Record<string, string>>({});
  /** Filter timesheet rows by planned/actual guard name. */
  const [guardFilter, setGuardFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState<"pending" | "confirmed" | "all">("pending");
  const [showRelieverForm, setShowRelieverForm] = useState(false);
  const [showSecondaryActions, setShowSecondaryActions] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const { confirm, confirmDialog } = useConfirmDialog();
  const [newRow, setNewRow] = useState({
    workDate: periodStart,
    actualGuardId: "",
    actualShiftType: "day",
    actualShiftCode: "D",
    attendanceStatus: "reliever" as SiteTimesheetAttendance,
    dutyOnObNumber: "",
    dutyOffObNumber: "",
    comments: "",
  });

  const locked = sheet?.status === "approved" || sheet?.status === "locked";
  const loadIdRef = useRef(0);
  const displaySiteName = sheet?.siteName ?? siteName;

  const showNotice = (title: string, message: string) => {
    setNotice({ title, message });
    setError(message);
  };

  const load = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    const loadId = ++loadIdRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [nextSheet, guardEmployees] = await Promise.all([
        fetchSiteTimesheet(token, siteId, periodStart, periodEnd),
        fetchSecurityGuardOptions(token),
      ]);
      if (loadId !== loadIdRef.current) return;
      setSheet({ ...nextSheet, rows: sortSiteTimesheetRows(nextSheet.rows) });
      setGuards(guardEmployees);
    } catch (err) {
      if (loadId !== loadIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load site timesheet");
    } finally {
      if (loadId === loadIdRef.current && !silent) setLoading(false);
    }
  };

  useEffect(() => {
    setGuardFilter("");
    setReviewFilter("pending");
    setNewRow((previous) => ({ ...previous, workDate: periodStart }));
    void load();
  }, [token, siteId, periodStart, periodEnd]);

  const guardOptions = useMemo(
    () => mergeTimesheetGuardOptions(guards, sheet?.rows ?? []),
    [guards, sheet?.rows]
  );
  const sortedRows = useMemo(
    () => (sheet ? sortSiteTimesheetRows(sheet.rows) : []),
    [sheet?.rows]
  );
  const shiftScopedRows = useMemo(
    () => sortedRows.filter((row) => rowMatchesShiftTypeFilter(row, shiftType)),
    [sortedRows, shiftType]
  );
  const guardFilteredRows = useMemo(() => {
    const q = guardFilter.trim().toLowerCase();
    if (!q) return shiftScopedRows;
    return shiftScopedRows.filter((row) => {
      const haystack = [
        row.actualGuardName,
        row.plannedGuardName,
        row.employeeNumber,
        row.psiraNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [shiftScopedRows, guardFilter]);
  const displayRows = useMemo(() => {
    if (reviewFilter === "all") return guardFilteredRows;
    if (reviewFilter === "pending") {
      return guardFilteredRows.filter((row) => isRowPendingReview(row.approvalStatus));
    }
    return guardFilteredRows.filter((row) => isRowFullyReviewed(row.approvalStatus));
  }, [guardFilteredRows, reviewFilter]);
  const reviewedCount = shiftScopedRows.filter((r) => isRowFullyReviewed(r.approvalStatus)).length;
  const pendingReviewCount = shiftScopedRows.filter((r) => isRowPendingReview(r.approvalStatus)).length;
  const otherShiftPendingCount = useMemo(() => {
    if (shiftType === "all") return 0;
    const other: AttendanceShiftTypeFilter = shiftType === "day" ? "night" : "day";
    return sortedRows.filter(
      (r) => rowMatchesShiftTypeFilter(r, other) && isRowPendingReview(r.approvalStatus)
    ).length;
  }, [sortedRows, shiftType]);
  const guardFilterActive = guardFilter.trim().length > 0;
  const shiftFilterActive = shiftType !== "all";
  const shiftLabel =
    shiftType === "day" ? "day-shift" : shiftType === "night" ? "night-shift" : "all";

  const updateRow = async (row: SiteTimesheetRow, patch: Partial<SiteTimesheetRow>) => {
    const nextPatch =
      row.approvalStatus === "reviewed" && patch.approvalStatus === undefined
        ? { ...patch, approvalStatus: "pending" as const }
        : patch;
    setSavingRowId(row.id);
    setError(null);
    try {
      const res = await updateSiteTimesheetRow(token, row.id, nextPatch);
      setSheet((current) =>
        current
          ? {
              ...current,
              rows: sortSiteTimesheetRows(
                current.rows.map((r) => (r.id === row.id ? res.row : r))
              ),
            }
          : current
      );
      await load({ silent: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save timesheet row";
      showNotice("Could not save", message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setSavingRowId(null);
    }
  };

  const getDutyOnDraft = (row: SiteTimesheetRow) =>
    dutyOnDrafts[row.id] ?? resolveDutyOnFromRow(row);

  const getDutyOffDraft = (row: SiteTimesheetRow) =>
    dutyOffDrafts[row.id] ?? resolveDutyOffFromRow(row);

  const setDutyOnDraft = (rowId: string, value: string) => {
    setDutyOnDrafts((prev) => ({ ...prev, [rowId]: value }));
  };

  const setDutyOffDraft = (rowId: string, value: string) => {
    setDutyOffDrafts((prev) => ({ ...prev, [rowId]: value }));
  };

  const saveDutyOnNumber = async (row: SiteTimesheetRow, draftOverride?: string) => {
    const next = (draftOverride ?? getDutyOnDraft(row)).trim();
    const current = resolveDutyOnFromRow(row);
    const needsOb = rowNeedsObNumbers(row.attendanceStatus);
    const confirmingPartialApproval =
      Boolean(next) && needsOb && row.approvalStatus === "pending" && next === current;
    if (next === current) {
      if (confirmingPartialApproval) {
        await updateRow(row, { dutyOnObNumber: next });
      }
      return;
    }
    if (!canEditLockedOb && current && next !== current) {
      showNotice(
        "Duty ON locked",
        "Duty ON OB number can only be changed by an administrator once it has been entered."
      );
      setDutyOnDraft(row.id, current);
      return;
    }
    await updateRow(row, { dutyOnObNumber: next || null });
  };

  const handleDutyOnKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    row: SiteTimesheetRow
  ) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const value = e.currentTarget.value;
    setDutyOnDraft(row.id, value);
    void saveDutyOnNumber(row, value).then(() => {
      e.currentTarget.blur();
    });
  };

  const saveDutyOffNumber = async (row: SiteTimesheetRow, draftOverride?: string) => {
    const next = (draftOverride ?? getDutyOffDraft(row)).trim();
    const current = resolveDutyOffFromRow(row);
    if (next === current) return;
    if (!canEditLockedOb && current && next !== current) {
      showNotice(
        "Duty OFF locked",
        "Duty OFF OB number can only be changed by an administrator once it has been entered."
      );
      setDutyOffDraft(row.id, current);
      return;
    }
    await updateRow(row, { dutyOffObNumber: next || null });
  };

  const approveRowAttendance = async (row: SiteTimesheetRow) => {
    const dutyOn = getDutyOnDraft(row).trim();
    const dutyOff = getDutyOffDraft(row).trim();
    const needsOb = rowNeedsObNumbers(row.attendanceStatus);
    if (needsOb && !dutyOn) {
      showNotice(
        "Cannot confirm this attendance entry",
        "Enter the Duty ON OB number first, then Duty OFF OB, then select Confirm attendance again."
      );
      return;
    }
    if (needsOb && !dutyOff) {
      showNotice(
        "Cannot confirm this attendance entry",
        "Enter the Duty OFF OB number before confirming this attendance entry."
      );
      return;
    }
    try {
      setError(null);
      await updateRow(
        row,
        buildRowApprovalPatch(row, dutyOn, dutyOff)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to confirm this attendance entry";
      setError(message);
    }
  };

  const explainSheetApproveBlocked = (): string | null => {
    if (pendingReviewCount > 0) {
      const shiftPart =
        shiftType === "all"
          ? `${pendingReviewCount} row${pendingReviewCount === 1 ? "" : "s"} still need review`
          : `${pendingReviewCount} ${shiftLabel} row${pendingReviewCount === 1 ? "" : "s"} still need review`;
      return (
        `Cannot approve the timesheet yet.\n\n` +
        `${shiftPart}.\n\n` +
        `For each pending row:\n` +
        `1. Enter Duty ON OB (saves as partial approval)\n` +
        `2. Enter Duty OFF OB and select Confirm attendance\n\n` +
        `When every visible row is reviewed, you can approve the timesheet for payroll.`
      );
    }
    return null;
  };

  const exportPdf = () => {
    if (!sheet) return;
    const exportRows = shiftScopedRows;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text("Site Timesheet", 14, 16);
    doc.setFontSize(10);
    const shiftNote = shiftType === "all" ? "All shifts" : `${shiftLabel} only`;
    doc.text(
      `${sheet.siteName} | ${sheet.periodStart} to ${sheet.periodEnd} | ${shiftNote} | Generated ${new Date().toLocaleDateString()}`,
      14,
      24
    );
    doc.text(`Status: ${label(sheet.status)} | Approved: ${sheet.approvedAt ? new Date(sheet.approvedAt).toLocaleString() : "Not approved"}`, 14, 30);
    autoTable(doc, {
      startY: 36,
      head: [["Date", "Day", "Scheduled", "Actual", "Planned", "Actual shift", "Status", "Hours", "Duty ON OB", "Duty OFF OB", "Discrepancies", "Comments"]],
      body: exportRows.map((row) => [
        row.workDate,
        row.dayOfWeek,
        row.plannedGuardName ?? "",
        row.actualGuardName ?? "",
        row.plannedShiftType ?? row.plannedShiftCode ?? "",
        row.actualShiftType ?? row.actualShiftCode ?? "",
        label(row.attendanceStatus),
        row.hoursWorked ?? "",
        row.dutyOnObNumber ?? row.occurrenceBookNumber ?? "",
        row.dutyOffObNumber ?? "",
        row.discrepancyCodes.map(label).join("; "),
        row.comments ?? "",
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [15, 23, 42] },
    });
    const y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 180;
    doc.text("Supervisor signature: ____________________    Manager signature: ____________________", 14, y + 12);
    const suffix = shiftType === "all" ? "" : `-${shiftType}`;
    doc.save(`site-timesheet-${sheet.siteName}-${sheet.periodStart}${suffix}.pdf`);
  };

  const refreshFromShifts = async () => {
    setLoading(true);
    setError(null);
    try {
      const refreshed = await resyncSiteTimesheet(token, siteId, periodStart, periodEnd);
      setSheet({ ...refreshed, rows: sortSiteTimesheetRows(refreshed.rows) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh from shifts");
    } finally {
      setLoading(false);
      setShowSecondaryActions(false);
    }
  };

  const exportCsv = async () => {
    if (!sheet) return;
    try {
      const res = await authFetch(siteTimesheetCsvUrl(siteId, periodStart, periodEnd, shiftType), token);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { message?: string; error?: string }).message ||
            (body as { error?: string }).error ||
            "Failed to download CSV"
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const suffix = shiftType === "all" ? "" : `-${shiftType}`;
      anchor.download = `site-timesheet-${sheet.siteName}-${sheet.periodStart}${suffix}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download CSV");
    } finally {
      setShowSecondaryActions(false);
    }
  };

  const approveVisibleTimesheet = async () => {
    if (!sheet) return;
    const blocked = explainSheetApproveBlocked();
    if (blocked) {
      showNotice("Cannot approve timesheet yet", blocked);
      return;
    }
    const message =
      otherShiftPendingCount > 0
        ? `Approve ${shiftScopedRows.length} confirmed ${shiftLabel} attendance entries? The timesheet will remain open because ${otherShiftPendingCount} other-shift entries still need review.`
        : `Approve and lock this site timesheet for payroll (${shiftScopedRows.length} ${shiftLabel} attendance entries)?`;
    const accepted = await confirm({
      title: otherShiftPendingCount > 0 ? `Approve ${shiftLabel}` : "Approve timesheet for payroll",
      message,
      confirmLabel: "Approve timesheet",
      danger: false,
    });
    if (!accepted) return;
    try {
      setError(null);
      const result = await approveSiteTimesheet(token, sheet.id, { shiftType });
      if (!result.locked && result.remainingPending > 0) {
        showNotice(
          "Shift approved",
          `${result.approvedRowCount} attendance entries approved. ${result.remainingPending} entries on the other shift still need review before payroll lock.`
        );
      }
      await load();
    } catch (err) {
      showNotice("Could not approve timesheet", err instanceof Error ? err.message : "Failed to approve timesheet");
    }
  };

  const submitUnlock = async () => {
    if (!sheet || !unlockReason.trim()) return;
    try {
      setError(null);
      await unlockSiteTimesheet(token, sheet.id, unlockReason.trim());
      setUnlockOpen(false);
      setUnlockReason("");
      setShowSecondaryActions(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlock timesheet");
    }
  };

  if (loading && !sheet) {
    return <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">Loading site timesheet…</div>;
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
      {unlockOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4" role="presentation">
          <form
            className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-700 dark:bg-neutral-950"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unlock-timesheet-title"
            onSubmit={(event) => {
              event.preventDefault();
              void submitUnlock();
            }}
          >
            <h2 id="unlock-timesheet-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Unlock approved timesheet</h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              Unlocking allows attendance changes. The reason is saved in the audit trail.
            </p>
            <label htmlFor="unlock-reason" className="mt-4 block text-sm font-medium text-neutral-700 dark:text-neutral-300">Reason for unlocking</label>
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
              <button type="button" className="btn-secondary min-h-11" onClick={() => setUnlockOpen(false)}>Cancel</button>
              <button type="submit" className="btn-primary min-h-11" disabled={!unlockReason.trim()}>Unlock timesheet</button>
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
            Review and edit who actually worked, then approve. The approved timesheet is the official attendance
            record and the source for payroll actuals. Download it as audit evidence of who worked each day.
          </p>
        </div>
        {sheet && (
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
              <div id="timesheet-secondary-actions" className="z-20 grid gap-2 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 sm:absolute sm:right-0 sm:top-12 sm:min-w-52">
                {!locked && <button type="button" onClick={() => void refreshFromShifts()} className="btn-secondary min-h-11 text-left">Refresh from shifts</button>}
                <button type="button" onClick={() => { exportPdf(); setShowSecondaryActions(false); }} className="btn-secondary min-h-11 text-left">Download PDF</button>
                <button type="button" onClick={() => void exportCsv()} className="btn-secondary min-h-11 text-left">Download CSV</button>
                {locked && canEditLockedOb && (
                  <button type="button" onClick={() => setUnlockOpen(true)} className="btn-secondary min-h-11 text-left">Admin unlock</button>
                )}
              </div>
            )}
            {!locked && (
              <button
                type="button"
                onClick={() => void approveVisibleTimesheet()}
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" aria-live="assertive">
          <span>{error}</span>
          <button type="button" className="min-h-11 font-semibold underline" onClick={() => void load()}>Try again</button>
        </div>
      )}

      {locked && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <span>
            Attendance {sheet?.status === "locked" ? "locked" : "approved"} for this period. Next step: process payroll
            from the verified hours.
          </span>
          <Link href="/payroll" className="btn-primary">Go to Payroll</Link>
        </div>
      )}

      {sheet && (
        <>
          <div className="grid gap-2 text-xs sm:grid-cols-7">
            {[
              ["Status", label(sheet.status)],
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
              <div key={String(title)} className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
                <p className="text-neutral-500">{title}</p>
                <p className="mt-1 font-semibold text-neutral-900 dark:text-neutral-100">{value}</p>
              </div>
            ))}
          </div>

          {!locked && pendingReviewCount > 0 && (
            <div id="timesheet-approval-help" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Confirm each {shiftType === "all" ? "" : `${shiftLabel} `}attendance entry, enter both Occurrence Book (OB) numbers, then
              select <span className="font-medium">Confirm attendance</span>. Status is set
              automatically.{" "}
              <span className="font-medium">{pendingReviewCount}</span>{" "}
              {shiftType === "all" ? "row" : `${shiftLabel} row`}
              {pendingReviewCount === 1 ? "" : "s"} still need review
              {otherShiftPendingCount > 0
                ? ` · ${otherShiftPendingCount} on the other shift also pending`
                : ""}
              .
            </div>
          )}

          {!locked && pendingReviewCount === 0 && otherShiftPendingCount > 0 && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
              All visible {shiftLabel} rows are reviewed. Switch to the other shift to finish{" "}
              <span className="font-medium">{otherShiftPendingCount}</span> pending row
              {otherShiftPendingCount === 1 ? "" : "s"} before the timesheet can lock for payroll.
            </div>
          )}

          {!locked && (
            <>
              <div className="flex justify-end">
                <button type="button" onClick={() => setShowRelieverForm(true)} className="btn-secondary min-h-11">
                  Add a reliever or unrostered guard
                </button>
              </div>
              {showRelieverForm && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-slate-900/45 p-4" role="presentation">
                  <div className="my-auto w-full max-w-4xl rounded-xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-950" role="dialog" aria-modal="true" aria-labelledby="add-reliever-title">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h2 id="add-reliever-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Add a reliever</h2>
                        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Use this only when someone worked but was not already listed for the day.</p>
                      </div>
                      <button type="button" onClick={() => setShowRelieverForm(false)} className="btn-secondary min-h-11" aria-label="Close add reliever dialog">Close</button>
                    </div>
                    <div className="grid gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900 sm:grid-cols-2 lg:grid-cols-7">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Date</label>
                <input
                  type="date"
                  value={newRow.workDate}
                  min={periodStart}
                  max={periodEnd}
                  required
                  onChange={(e) => setNewRow((prev) => ({ ...prev, workDate: e.target.value }))}
                  className="input-modern mt-1 w-full"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Guard <span className="text-amber-600">*</span>
                </label>
                <GuardSearchPicker
                  guards={guardOptions}
                  value={newRow.actualGuardId || null}
                  onChange={(id) => setNewRow((prev) => ({ ...prev, actualGuardId: id ?? "" }))}
                  placeholder="Choose reliever or guard…"
                  className="input-modern mt-1 w-full"
                  allowClear={false}
                />
                {!newRow.actualGuardId && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Select who worked — required before you can add them to the timesheet.
                  </p>
                )}
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Shift</label>
                <select
                  value={newRow.actualShiftType}
                  onChange={(e) =>
                    setNewRow((prev) => ({
                      ...prev,
                      actualShiftType: e.target.value,
                      actualShiftCode: e.target.value === "night" ? "N" : "D",
                    }))
                  }
                  className="input-modern mt-1 w-full"
                >
                  <option value="day">Day shift</option>
                  <option value="night">Night shift</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Duty ON OB <span className="text-amber-600">*</span>
                </label>
                <input
                  value={newRow.dutyOnObNumber}
                  onChange={(e) =>
                    setNewRow((prev) => ({ ...prev, dutyOnObNumber: e.target.value }))
                  }
                  placeholder="Duty ON OB"
                  className="input-modern mt-1 w-full"
                  maxLength={80}
                  autoComplete="off"
                  required
                  aria-required="true"
                />
                {!newRow.dutyOnObNumber.trim() && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Duty ON OB is required before adding a reliever.
                  </p>
                )}
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Duty OFF OB
                </label>
                <input
                  value={newRow.dutyOffObNumber}
                  onChange={(e) =>
                    setNewRow((prev) => ({ ...prev, dutyOffObNumber: e.target.value }))
                  }
                  placeholder="Optional — enter later"
                  className="input-modern mt-1 w-full"
                  maxLength={80}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col justify-end gap-2 sm:col-span-2">
                <input
                  value={newRow.comments}
                  onChange={(e) => setNewRow((prev) => ({ ...prev, comments: e.target.value }))}
                  placeholder="Reason (optional)"
                  className="input-modern w-full"
                />
                <button
                  type="button"
                  disabled={
                    !newRow.actualGuardId ||
                    !newRow.dutyOnObNumber.trim() ||
                    newRow.workDate < periodStart ||
                    newRow.workDate > periodEnd
                  }
                  onClick={async () => {
                    if (!newRow.actualGuardId) {
                      setError("Select a guard before adding them to the timesheet.");
                      return;
                    }
                    const dutyOn = newRow.dutyOnObNumber.trim();
                    if (!dutyOn) {
                      showNotice(
                        "Duty ON required",
                        "Duty ON OB number is required before adding a reliever."
                      );
                      return;
                    }
                    if (newRow.workDate < periodStart || newRow.workDate > periodEnd) {
                      showNotice(
                        "Date outside this timesheet",
                        `Choose a date from ${periodStart} to ${periodEnd}.`
                      );
                      return;
                    }
                    try {
                      setError(null);
                      await addSiteTimesheetRow(token, sheet.id, {
                        ...newRow,
                        dutyOnObNumber: dutyOn,
                        dutyOffObNumber: newRow.dutyOffObNumber.trim() || null,
                      });
                      setNewRow((prev) => ({
                        ...prev,
                        actualGuardId: "",
                        dutyOnObNumber: "",
                        dutyOffObNumber: "",
                        comments: "",
                      }));
                      setShowRelieverForm(false);
                      await load();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to add reliever row");
                    }
                  }}
                  className="btn-primary min-h-11 w-full disabled:opacity-50"
                >
                  Add reliever
                </button>
              </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Attendance entries</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Pending work is shown first so unfinished attendance is not missed.</p>
            </div>
            <div className="flex flex-wrap gap-1 rounded-lg border border-neutral-200 bg-white p-1 dark:border-neutral-700 dark:bg-neutral-950" role="group" aria-label="Show attendance entries">
              {([
                ["pending", `Needs confirmation (${pendingReviewCount})`],
                ["confirmed", `Confirmed (${reviewedCount})`],
                ["all", `All (${shiftScopedRows.length})`],
              ] as const).map(([value, text]) => (
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
              No {shiftType === "day" ? "day" : "night"}-shift rows for this site in the selected period. Switch shift
              type above to review the other shift.
            </div>
          )}

          {!guardFilterActive && shiftScopedRows.length > 0 && displayRows.length === 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" role="status">
              {reviewFilter === "pending"
                ? "All visible attendance entries are confirmed. Use the approval button below when you are ready."
                : "No attendance entries match this review status."}
            </div>
          )}

          <div className="space-y-3 xl:hidden">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Confirm who worked and the shift times, enter Duty ON OB, then Duty OFF OB
              and tap{" "}
              <span className="font-medium text-neutral-700 dark:text-neutral-300">Confirm attendance</span>. Status is set
              automatically.
            </p>
            {displayRows.map((row) => (
              <SiteTimesheetRowCard
                key={row.id}
                row={row}
                guards={guardOptions}
                locked={locked}
                saving={savingRowId === row.id}
                dutyOnObNumber={getDutyOnDraft(row)}
                dutyOffObNumber={getDutyOffDraft(row)}
                onDutyOnObNumberChange={(value) => setDutyOnDraft(row.id, value)}
                onDutyOffObNumberChange={(value) => setDutyOffDraft(row.id, value)}
                onDutyOnObNumberSave={(value?: string) => void saveDutyOnNumber(row, value)}
                onDutyOffObNumberSave={(value?: string) => void saveDutyOffNumber(row, value)}
                canEditLockedOb={canEditLockedOb}
                rowShiftType={rowShiftType}
                displayShiftTime={displayShiftTime}
                combineDateTime={combineDateTime}
                combineClockOut={combineClockOut}
                hoursBetween={hoursBetween}
                onUpdate={(r, patch) => void updateRow(r, patch)}
                onApprove={(r) => void approveRowAttendance(r)}
              />
            ))}
          </div>

          <div className="hidden xl:block">
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
            <table className="site-timesheet-table w-full table-fixed text-left text-[11px]">
              <colgroup>
                <col className="w-[7%]" />
                <col className="w-[18%]" />
                <col className="w-[8%]" />
                <col className="w-[10%]" />
                <col className="w-[7%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[7%]" />
              </colgroup>
              <thead className="bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                <tr>
                  {["Date", "Who worked", "Shift", "Start / End", "Status", "Issues", "Notes", "Duty ON OB", "Duty OFF OB", "Action"].map((label) => (
                    <th key={label} className="px-2 py-1.5 font-semibold">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {displayRows.map((row) => {
                  const rowSurfaceClass =
                    isRowFullyReviewed(row.approvalStatus)
                      ? "bg-emerald-50/40 dark:bg-emerald-950/15"
                      : row.approvalStatus === "partially_reviewed"
                        ? "bg-amber-50/50 dark:bg-amber-950/20"
                        : row.discrepancyCodes.length
                          ? "bg-amber-50/60 dark:bg-amber-950/20"
                          : "bg-white dark:bg-neutral-950";
                  const cellClass = `px-2 py-1.5 align-top ${rowSurfaceClass}`;
                  const guardChanged =
                    !!row.actualGuardId &&
                    !!row.plannedGuardId &&
                    row.actualGuardId !== row.plannedGuardId;

                  return (
                  <tr
                    key={row.id}
                    className={rowSurfaceClass}
                  >
                    <td className={`${cellClass} font-medium leading-tight`}>
                      {row.workDate}
                      <br />
                      <span className="text-neutral-500">{row.dayOfWeek}</span>
                    </td>
                    <td className={cellClass}>
                      {!row.plannedGuardName ? (
                        <p className="mb-1 text-[10px] font-medium text-amber-700">Unrostered</p>
                      ) : guardChanged ? (
                        <p className="mb-1 text-[10px] leading-tight text-neutral-500">
                          Scheduled: {row.plannedGuardName}
                          {row.employeeNumber || row.psiraNumber
                            ? ` (${row.employeeNumber ?? row.psiraNumber})`
                            : ""}
                        </p>
                      ) : null}
                      <GuardSearchPicker
                        guards={guardOptions}
                        value={row.actualGuardId}
                        defaultGuardId={row.plannedGuardId}
                        defaultGuardLabel={row.plannedGuardName}
                        disabled={locked || savingRowId === row.id}
                        onChange={(guardId) => void updateRow(row, { actualGuardId: guardId })}
                        clearLabel="Nobody worked"
                        truncateLabel
                        compact
                        className="input-compact !px-2 !py-1 text-[11px]"
                      />
                    </td>
                    <td className={cellClass}>
                      <p className="mb-0.5 text-[10px] leading-tight text-neutral-500">
                        Plan: {label(row.plannedShiftType ?? row.plannedShiftCode)}
                      </p>
                      <select
                        disabled={locked}
                        value={row.actualShiftType ?? ""}
                        onChange={(e) => {
                          const shiftType =
                            e.target.value === "night" ? "night" : e.target.value === "day" ? "day" : null;
                          void updateRow(row, {
                            actualShiftType: e.target.value || null,
                            actualShiftCode: e.target.value === "night" ? "N" : e.target.value === "day" ? "D" : null,
                            ...shiftTypeTimesPatch(row.workDate, shiftType),
                          });
                        }}
                        className="input-compact w-full !px-2 !py-1 text-[11px]"
                      >
                        <option value="">Not worked</option>
                        <option value="day">Day</option>
                        <option value="night">Night</option>
                      </select>
                    </td>
                    <td className={cellClass}>
                      <div className="flex items-center gap-0.5">
                        <ShiftTimeSelect
                          value={displayShiftTime(row.clockIn, rowShiftType(row), "start")}
                          disabled={locked || savingRowId === row.id}
                          onChange={(time) => {
                            const clockIn = combineDateTime(row.workDate, time);
                            if (clockIn === (row.clockIn ?? null)) return;
                            void updateRow(row, { clockIn, hoursWorked: hoursBetween(clockIn, row.clockOut) });
                          }}
                          className="input-compact w-[4.25rem] !px-1 !py-1 text-[11px]"
                          title="Start time"
                        />
                        <span className="text-neutral-400">/</span>
                        <ShiftTimeSelect
                          value={displayShiftTime(row.clockOut, rowShiftType(row), "end")}
                          disabled={locked || savingRowId === row.id}
                          onChange={(time) => {
                            const shiftType = rowShiftType(row);
                            const clockIn =
                              row.clockIn ?? combineDateTime(row.workDate, displayShiftTime(null, shiftType, "start"));
                            const clockOut = combineClockOut(row.workDate, time, clockIn);
                            if (clockOut === (row.clockOut ?? null)) return;
                            void updateRow(row, { clockOut, hoursWorked: hoursBetween(clockIn, clockOut) });
                          }}
                          className="input-compact w-[4.25rem] !px-1 !py-1 text-[11px]"
                          title="End time"
                        />
                      </div>
                    </td>
                    <td className={cellClass}>
                      <span
                        className="font-medium text-neutral-800 dark:text-neutral-200"
                        title="Set automatically when you confirm this attendance entry"
                      >
                        {formatAttendanceStatus(row.attendanceStatus)}
                      </span>
                    </td>
                    <td className={cellClass}>
                      <div className="flex flex-wrap gap-0.5">
                        {row.discrepancyCodes.length ? row.discrepancyCodes.map((code) => (
                          <span key={code} className="rounded-full border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium leading-tight text-amber-800">{label(code)}</span>
                        )) : <span className="text-neutral-400">None</span>}
                      </div>
                    </td>
                    <td className={cellClass}>
                      <input
                        disabled={locked}
                        defaultValue={row.comments ?? ""}
                        onBlur={(e) => void updateRow(row, { comments: e.target.value })}
                        className="input-compact w-full !px-2 !py-1 text-[11px]"
                        placeholder="Notes"
                        title="Supervisor note (optional)"
                      />
                    </td>
                    <td className={cellClass}>
                      {(() => {
                        const savedDutyOn = resolveDutyOnFromRow(row);
                        const dutyOnLocked = Boolean(savedDutyOn) && !canEditLockedOb;
                        if (locked || row.approvalStatus === "approved" || dutyOnLocked) {
                          return (
                            <span
                              className="font-medium text-neutral-800 dark:text-neutral-200"
                              title={
                                dutyOnLocked
                                  ? "Duty ON OB is locked. Only an administrator can change it."
                                  : "Duty ON OB number"
                              }
                            >
                              {savedDutyOn || "—"}
                            </span>
                          );
                        }
                        return (
                          <input
                            value={getDutyOnDraft(row)}
                            onChange={(e) => setDutyOnDraft(row.id, e.target.value)}
                            onBlur={() => void saveDutyOnNumber(row)}
                            onKeyDown={(e) => handleDutyOnKeyDown(e, row)}
                            disabled={savingRowId === row.id}
                            className="input-compact w-full !px-2 !py-1 text-[11px]"
                            placeholder="Duty ON"
                            title="Duty ON OB — press Enter to save as partial approval"
                            aria-label={`Duty ON OB for ${row.workDate}`}
                          />
                        );
                      })()}
                    </td>
                    <td className={cellClass}>
                      {(() => {
                        const savedDutyOn = resolveDutyOnFromRow(row);
                        const savedDutyOff = resolveDutyOffFromRow(row);
                        const dutyOffLocked = Boolean(savedDutyOff) && !canEditLockedOb;
                        const dutyOffEnabled = Boolean(savedDutyOn) || Boolean(getDutyOnDraft(row).trim());
                        if (locked || row.approvalStatus === "approved" || dutyOffLocked) {
                          return (
                            <span
                              className="font-medium text-neutral-800 dark:text-neutral-200"
                              title={
                                dutyOffLocked
                                  ? "Duty OFF OB is locked. Only an administrator can change it."
                                  : "Duty OFF OB number"
                              }
                            >
                              {savedDutyOff || "—"}
                            </span>
                          );
                        }
                        return (
                          <input
                            value={getDutyOffDraft(row)}
                            onChange={(e) => setDutyOffDraft(row.id, e.target.value)}
                            onBlur={() => void saveDutyOffNumber(row)}
                            disabled={savingRowId === row.id || !dutyOffEnabled}
                            className="input-compact w-full !px-2 !py-1 text-[11px] disabled:opacity-50"
                            placeholder={dutyOffEnabled ? "Duty OFF" : "Duty ON first"}
                            title="Duty OFF OB — required before confirming attendance"
                            aria-label={`Duty OFF OB for ${row.workDate}`}
                          />
                        );
                      })()}
                    </td>
                    <td className={cellClass}>
                      {row.approvalStatus === "approved" || locked ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Approved
                        </span>
                      ) : row.approvalStatus === "reviewed" ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex w-fit items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Confirmed
                          </span>
                          <button
                            type="button"
                            disabled={savingRowId === row.id}
                            onClick={() => void updateRow(row, { approvalStatus: "pending" })}
                            className="text-left text-[9px] text-neutral-500 underline-offset-2 hover:text-neutral-700 hover:underline dark:hover:text-neutral-300"
                          >
                            Reopen
                          </button>
                        </div>
                      ) : row.approvalStatus === "partially_reviewed" ? (
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex w-fit items-center rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                            Duty ON saved
                          </span>
                          <button
                            type="button"
                            disabled={savingRowId === row.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                            }}
                            onClick={() => void approveRowAttendance(row)}
                            title="Enter Duty OFF OB, then confirm attendance."
                            className="w-full rounded-security border-2 border-security-navy bg-security-navy px-2 py-1.5 text-[11px] font-semibold leading-tight text-white hover:bg-security-navy-800 disabled:opacity-50"
                          >
                            {savingRowId === row.id ? "…" : "Confirm"}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={savingRowId === row.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                          }}
                          onClick={() => void approveRowAttendance(row)}
                          title="Enter Duty ON and Duty OFF OB numbers, then confirm attendance."
                          className="w-full rounded-security border-2 border-security-navy bg-security-navy px-2 py-1.5 text-[11px] font-semibold leading-tight text-white hover:bg-security-navy-800 disabled:opacity-50"
                        >
                          {savingRowId === row.id ? "…" : "Confirm"}
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}
      {sheet && !locked && (
        <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl border border-security-navy-200 bg-white/95 p-4 shadow-xl backdrop-blur dark:border-security-navy-700 dark:bg-neutral-950/95 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {pendingReviewCount === 0 ? "Visible attendance is ready for approval" : `${pendingReviewCount} attendance ${pendingReviewCount === 1 ? "entry needs" : "entries need"} confirmation`}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {otherShiftPendingCount > 0
                ? `${otherShiftPendingCount} entries on the other shift will still need attention before payroll lock.`
                : "Approving the final shift locks this site timesheet for payroll."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void approveVisibleTimesheet()}
            disabled={pendingReviewCount > 0 || shiftScopedRows.length === 0}
            className="btn-primary min-h-11 w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {shiftType === "all" ? "Approve timesheet" : `Approve ${shiftLabel}`}
          </button>
        </div>
      )}
    </section>
  );
}
