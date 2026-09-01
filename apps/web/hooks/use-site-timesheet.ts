"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  approveSiteTimesheet,
  bulkConfirmSiteTimesheetRows,
  confirmSiteTimesheetRow,
  fetchSecurityGuardOptions,
  fetchSiteTimesheet,
  mergeTimesheetGuardOptions,
  reopenSiteTimesheetRow,
  resyncSiteTimesheet,
  unlockSiteTimesheet,
  updateSiteTimesheetRow,
  type AttendanceShiftTypeFilter,
  type BulkConfirmResult,
  type GuardPickerOption,
  type SiteTimesheet,
  type SiteTimesheetRow,
} from "@/lib/roster-api";
import {
  isRowFullyReviewed,
  isRowPendingReview,
  resolveDutyOffFromRow,
  resolveDutyOnFromRow,
  rowMatchesShiftTypeFilter,
  rowNeedsObNumbers,
  sortSiteTimesheetRows,
} from "@/lib/site-timesheet-utils";
import { buildRowApprovalPatch, isBulkConfirmable } from "@/lib/site-timesheet-row-patch";

export type NoticeDialog = { title: string; message: string };

export type SiteTimesheetPermissions = {
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canExport: boolean;
};

export type SiteTimesheetFocus = {
  shiftId?: string;
  employeeId?: string;
  workDate?: string;
};

/**
 * Data layer for the site timesheet capture screen: loading, row edits, OB drafts,
 * confirmation (single and bulk), approval and unlock.
 *
 * Extracted from SiteTimesheetsSection so the component is presentation plus wiring.
 */
export function useSiteTimesheet(params: {
  token: string;
  siteId: string;
  periodStart: string;
  periodEnd: string;
  shiftType: AttendanceShiftTypeFilter;
  permissions: SiteTimesheetPermissions;
  focus?: SiteTimesheetFocus;
}) {
  const { token, siteId, periodStart, periodEnd, shiftType, permissions, focus } = params;
  const { canEdit, canApprove } = permissions;
  const canEditLockedOb = canApprove;

  const [sheet, setSheet] = useState<SiteTimesheet | null>(null);
  const [guards, setGuards] = useState<GuardPickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Centered notice so approve blockers are never missed at the top of a long page. */
  const [notice, setNotice] = useState<NoticeDialog | null>(null);
  const [dutyOnDrafts, setDutyOnDrafts] = useState<Record<string, string>>({});
  const [dutyOffDrafts, setDutyOffDrafts] = useState<Record<string, string>>({});
  const [guardFilter, setGuardFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState<"pending" | "confirmed" | "all">("pending");

  const loadIdRef = useRef(0);
  const locked = sheet?.status === "approved" || sheet?.status === "locked";
  const readOnly = locked || !canEdit;

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
    setReviewFilter(focus ? "all" : "pending");
    void load();
    // The identity of `load` changes every render; the inputs below are the real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, siteId, periodStart, periodEnd, focus?.shiftId, focus?.employeeId, focus?.workDate]);

  const replaceRow = (updated: SiteTimesheetRow) => {
    setSheet((current) =>
      current
        ? {
            ...current,
            rows: sortSiteTimesheetRows(
              current.rows.map((r) => (r.id === updated.id ? updated : r))
            ),
          }
        : current
    );
  };

  const guardOptions = useMemo(
    () => mergeTimesheetGuardOptions(guards, sheet?.rows ?? []),
    [guards, sheet?.rows]
  );
  const sortedRows = useMemo(() => (sheet ? sortSiteTimesheetRows(sheet.rows) : []), [sheet?.rows]);
  const shiftScopedRows = useMemo(
    () => sortedRows.filter((row) => rowMatchesShiftTypeFilter(row, shiftType)),
    [sortedRows, shiftType]
  );
  const focusActive = Boolean(focus?.shiftId || focus?.employeeId || focus?.workDate);
  const focusedRow = useMemo(() => {
    if (!focusActive) return null;

    const exactShiftRow = focus?.shiftId
      ? sortedRows.find((row) => row.sourceShiftId === focus.shiftId)
      : undefined;
    if (exactShiftRow) return exactShiftRow;

    return sortedRows.find((row) => {
      const employeeMatches = focus?.employeeId
        ? row.actualGuardId === focus.employeeId || row.plannedGuardId === focus.employeeId
        : true;
      const dateMatches = focus?.workDate ? row.workDate === focus.workDate : true;
      return employeeMatches && dateMatches;
    }) ?? null;
  }, [focus?.employeeId, focus?.shiftId, focus?.workDate, focusActive, sortedRows]);
  const focusScopedRows = focusActive ? (focusedRow ? [focusedRow] : []) : shiftScopedRows;
  const guardFilteredRows = useMemo(() => {
    const q = guardFilter.trim().toLowerCase();
    if (!q) return focusScopedRows;
    return focusScopedRows.filter((row) => {
      const haystack = [
        row.actualGuardName,
        row.plannedGuardName,
        row.employeeNumber,
        row.psiraRegistrationNumber,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [focusScopedRows, guardFilter]);
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

  /** Rows the "Confirm all as scheduled" action would submit, in display order. */
  const bulkConfirmableRows = useMemo(
    () => guardFilteredRows.filter(isBulkConfirmable),
    [guardFilteredRows]
  );

  const updateRow = async (row: SiteTimesheetRow, patch: Partial<SiteTimesheetRow>) => {
    if (!canEdit) return;
    setSavingRowId(row.id);
    setError(null);
    try {
      const res = await updateSiteTimesheetRow(token, row.id, patch);
      replaceRow(res.row);
      await load({ silent: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save timesheet row";
      showNotice("Could not save", message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setSavingRowId(null);
    }
  };

  const reopenRow = async (row: SiteTimesheetRow) => {
    if (!canEdit) return;
    setSavingRowId(row.id);
    setError(null);
    try {
      const res = await reopenSiteTimesheetRow(token, row.id);
      replaceRow(res.row);
      await load({ silent: true });
    } catch (err) {
      showNotice(
        "Could not reopen",
        err instanceof Error ? err.message : "Failed to reopen attendance row"
      );
    } finally {
      setSavingRowId(null);
    }
  };

  const getDutyOnDraft = (row: SiteTimesheetRow) => dutyOnDrafts[row.id] ?? resolveDutyOnFromRow(row);
  const getDutyOffDraft = (row: SiteTimesheetRow) => dutyOffDrafts[row.id] ?? resolveDutyOffFromRow(row);
  const setDutyOnDraft = (rowId: string, value: string) =>
    setDutyOnDrafts((prev) => ({ ...prev, [rowId]: value }));
  const setDutyOffDraft = (rowId: string, value: string) =>
    setDutyOffDrafts((prev) => ({ ...prev, [rowId]: value }));

  /**
   * Confirm a row. Both OB numbers travel with the confirmation in one request, so the
   * controller never has to save Duty ON separately just to unlock the Duty OFF field.
   */
  const approveRowAttendance = async (row: SiteTimesheetRow) => {
    const dutyOn = getDutyOnDraft(row).trim();
    const dutyOff = getDutyOffDraft(row).trim();
    const needsOb = rowNeedsObNumbers(row.attendanceStatus);
    if (needsOb && (!dutyOn || !dutyOff)) {
      showNotice(
        "Cannot confirm this attendance entry",
        "Enter both the Duty ON and Duty OFF OB numbers, then select Confirm attendance."
      );
      return;
    }
    try {
      setError(null);
      setSavingRowId(row.id);
      const res = await confirmSiteTimesheetRow(
        token,
        row.id,
        buildRowApprovalPatch(row, dutyOn, dutyOff)
      );
      replaceRow(res.row);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm this attendance entry");
    } finally {
      setSavingRowId(null);
    }
  };

  /** Save an OB number on its own — used when editing a row without confirming it yet. */
  const saveDutyObNumber = async (
    row: SiteTimesheetRow,
    which: "on" | "off",
    draftOverride?: string
  ) => {
    const isOn = which === "on";
    const next = (draftOverride ?? (isOn ? getDutyOnDraft(row) : getDutyOffDraft(row))).trim();
    const current = isOn ? resolveDutyOnFromRow(row) : resolveDutyOffFromRow(row);
    if (next === current) return;
    if (!canEditLockedOb && current) {
      showNotice(
        isOn ? "Duty ON locked" : "Duty OFF locked",
        `${isOn ? "Duty ON" : "Duty OFF"} OB number can only be changed with Attendance approval access once it has been entered.`
      );
      (isOn ? setDutyOnDraft : setDutyOffDraft)(row.id, current);
      return;
    }
    await updateRow(row, isOn ? { dutyOnObNumber: next || null } : { dutyOffObNumber: next || null });
  };

  const bulkConfirm = async (
    entries: Array<{ rowId: string; dutyOnObNumber: string; dutyOffObNumber: string }>
  ): Promise<BulkConfirmResult | null> => {
    if (!sheet || !canEdit) return null;
    setError(null);
    try {
      const result = await bulkConfirmSiteTimesheetRows(token, sheet.id, entries);
      await load({ silent: true });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to confirm attendance entries";
      showNotice("Could not confirm", message);
      return null;
    }
  };

  const refreshFromShifts = async () => {
    if (!canEdit) return;
    setLoading(true);
    setError(null);
    try {
      const refreshed = await resyncSiteTimesheet(token, siteId, periodStart, periodEnd);
      setSheet({ ...refreshed, rows: sortSiteTimesheetRows(refreshed.rows) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh from shifts");
    } finally {
      setLoading(false);
    }
  };

  const approveVisibleTimesheet = async () => {
    if (!sheet || !canApprove) return null;
    try {
      setError(null);
      const result = await approveSiteTimesheet(token, sheet.id, { shiftType });
      await load();
      return result;
    } catch (err) {
      showNotice(
        "Could not approve timesheet",
        err instanceof Error ? err.message : "Failed to approve timesheet"
      );
      return null;
    }
  };

  const submitUnlock = async (reason: string) => {
    if (!sheet || !reason.trim() || !canApprove) return false;
    try {
      setError(null);
      await unlockSiteTimesheet(token, sheet.id, reason.trim());
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlock timesheet");
      return false;
    }
  };

  return {
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
    sortedRows,
    shiftScopedRows,
    displayRows,
    bulkConfirmableRows,
    reviewedCount,
    pendingReviewCount,
    otherShiftPendingCount,
    focusActive,
    focusedRow,
    load,
    updateRow,
    reopenRow,
    getDutyOnDraft,
    getDutyOffDraft,
    setDutyOnDraft,
    setDutyOffDraft,
    saveDutyObNumber,
    approveRowAttendance,
    bulkConfirm,
    refreshFromShifts,
    approveVisibleTimesheet,
    submitUnlock,
  };
}
