"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { authFetch } from "@/lib/api";
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
  unlockSiteTimesheet,
  updateSiteTimesheetRow,
} from "@/lib/roster-api";
import { sortSiteTimesheetRows } from "@/lib/site-timesheet-utils";

type GuardOption = GuardPickerOption;

const ATTENDANCE_OPTIONS: { value: SiteTimesheetAttendance; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "late", label: "Late" },
  { value: "left_early", label: "Left early" },
  { value: "reliever", label: "Reliever" },
  { value: "shift_swapped", label: "Shift swapped" },
  { value: "leave", label: "Leave" },
  { value: "sick_leave", label: "Sick leave" },
  { value: "training", label: "Training" },
  { value: "off", label: "Off" },
];

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

function buildRowApprovalPatch(row: SiteTimesheetRow): Partial<SiteTimesheetRow> {
  const shiftType = rowShiftType(row);
  const actualGuardId = row.actualGuardId ?? row.plannedGuardId;
  const startTime = displayShiftTime(row.clockIn, shiftType, "start");
  const endTime = displayShiftTime(row.clockOut, shiftType, "end");
  const clockIn = row.clockIn ?? (startTime ? combineDateTime(row.workDate, startTime) : null);
  const clockOut =
    row.clockOut ?? (endTime ? combineClockOut(row.workDate, endTime, clockIn) : null);

  return {
    actualGuardId,
    clockIn,
    clockOut,
    hoursWorked: row.hoursWorked ?? hoursBetween(clockIn, clockOut),
    attendanceStatus: row.attendanceStatus === "pending" ? "present" : row.attendanceStatus,
    actualShiftType: row.actualShiftType ?? shiftType,
    actualShiftCode:
      row.actualShiftCode ??
      (shiftType === "night" ? "N" : shiftType === "day" ? "D" : null),
    approvalStatus: "reviewed",
  };
}

export function SiteTimesheetsSection({
  token,
  siteId,
  siteName,
  periodStart,
  periodEnd,
}: {
  token: string;
  siteId: string;
  siteName?: string;
  periodStart: string;
  periodEnd: string;
}) {
  const [sheet, setSheet] = useState<SiteTimesheet | null>(null);
  const [guards, setGuards] = useState<GuardOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newRow, setNewRow] = useState({
    workDate: periodStart,
    actualGuardId: "",
    actualShiftType: "day",
    actualShiftCode: "D",
    attendanceStatus: "reliever" as SiteTimesheetAttendance,
    comments: "",
  });

  const locked = sheet?.status === "approved" || sheet?.status === "locked";
  const loadIdRef = useRef(0);
  const displaySiteName = sheet?.siteName ?? siteName;

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
    void load();
  }, [token, siteId, periodStart, periodEnd]);

  const guardOptions = useMemo(
    () => mergeTimesheetGuardOptions(guards, sheet?.rows ?? []),
    [guards, sheet?.rows]
  );
  const displayRows = useMemo(
    () => (sheet ? sortSiteTimesheetRows(sheet.rows) : []),
    [sheet?.rows]
  );
  const reviewedCount = sheet?.rows.filter((r) => r.approvalStatus !== "pending").length ?? 0;
  const pendingReviewCount = sheet ? sheet.rows.length - reviewedCount : 0;

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
      setError(err instanceof Error ? err.message : "Failed to save timesheet row");
    } finally {
      setSavingRowId(null);
    }
  };

  const approveRowAttendance = async (row: SiteTimesheetRow) => {
    await updateRow(row, buildRowApprovalPatch(row));
  };

  const exportPdf = () => {
    if (!sheet) return;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text("Site Timesheet", 14, 16);
    doc.setFontSize(10);
    doc.text(`${sheet.siteName} | ${sheet.periodStart} to ${sheet.periodEnd} | Generated ${new Date().toLocaleDateString()}`, 14, 24);
    doc.text(`Status: ${label(sheet.status)} | Approved: ${sheet.approvedAt ? new Date(sheet.approvedAt).toLocaleString() : "Not approved"}`, 14, 30);
    autoTable(doc, {
      startY: 36,
      head: [["Date", "Day", "Scheduled", "Actual", "Planned", "Actual shift", "Status", "Hours", "Discrepancies", "Comments"]],
      body: displayRows.map((row) => [
        row.workDate,
        row.dayOfWeek,
        row.plannedGuardName ?? "",
        row.actualGuardName ?? "",
        row.plannedShiftType ?? row.plannedShiftCode ?? "",
        row.actualShiftType ?? row.actualShiftCode ?? "",
        label(row.attendanceStatus),
        row.hoursWorked ?? "",
        row.discrepancyCodes.map(label).join("; "),
        row.comments ?? "",
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [15, 23, 42] },
    });
    const y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 180;
    doc.text("Supervisor signature: ____________________    Manager signature: ____________________", 14, y + 12);
    doc.save(`site-timesheet-${sheet.siteName}-${sheet.periodStart}.pdf`);
  };

  if (loading && !sheet) {
    return <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">Loading site timesheet…</div>;
  }

  return (
    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-950">
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
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            {!locked && (
              <button
                type="button"
                onClick={async () => {
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
                }}
                className="btn-secondary w-full sm:w-auto"
                title="Pull the latest published shifts and clock-ins into this timesheet"
              >
                Refresh from shifts
              </button>
            )}
            <button type="button" onClick={exportPdf} className="btn-secondary w-full sm:w-auto">
              Download PDF
            </button>
            <button
              type="button"
              onClick={async () => {
                const res = await authFetch(siteTimesheetCsvUrl(siteId, periodStart, periodEnd), token);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `site-timesheet-${sheet.siteName}-${sheet.periodStart}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="btn-secondary w-full sm:w-auto"
            >
              Download CSV
            </button>
            {locked ? (
              <button
                type="button"
                onClick={async () => {
                  const reason = window.prompt("Reason for unlocking this approved timesheet?");
                  if (reason == null) return;
                  await unlockSiteTimesheet(token, sheet.id, reason);
                  await load();
                }}
                className="btn-secondary w-full sm:w-auto"
              >
                Admin unlock
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  const unreviewed = sheet.rows.filter((r) => r.approvalStatus === "pending").length;
                  const message =
                    unreviewed > 0
                      ? `${unreviewed} row(s) have not been individually approved yet. Approve and lock this site timesheet for payroll anyway?`
                      : "Approve and lock this site timesheet for payroll?";
                  if (!window.confirm(message)) return;
                  await approveSiteTimesheet(token, sheet.id);
                  await load();
                }}
                className="btn-primary w-full sm:w-auto"
              >
                Approve timesheet
              </button>
            )}
          </div>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {locked && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <span>Attendance approved for this period. Next step: process payroll from the verified hours.</span>
          <Link href="/payroll" className="btn-primary">Go to Payroll</Link>
        </div>
      )}

      {sheet && (
        <>
          <div className="grid gap-2 text-xs sm:grid-cols-7">
            {[
              ["Status", label(sheet.status)],
              ["Reviewed", `${reviewedCount}/${sheet.rows.length}`],
              ["Day shifts", sheet.totals.dayShifts],
              ["Night shifts", sheet.totals.nightShifts],
              ["Hours", sheet.totals.totalHours],
              ["Relievers", sheet.totals.relieverShifts],
              ["Discrepancies", sheet.totals.discrepancies],
            ].map(([title, value]) => (
              <div key={title} className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
                <p className="text-neutral-500">{title}</p>
                <p className="mt-1 font-semibold text-neutral-900 dark:text-neutral-100">{value}</p>
              </div>
            ))}
          </div>

          {!locked && pendingReviewCount > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Review each row and click <span className="font-medium">Approve attendance</span> to confirm who worked, shift times, and status.
              {" "}
              <span className="font-medium">{pendingReviewCount}</span> row{pendingReviewCount === 1 ? "" : "s"} still need review.
            </div>
          )}

          {!locked && (
            <div className="grid gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900 sm:grid-cols-2 lg:grid-cols-6">
              <div className="sm:col-span-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Date</label>
                <input
                  type="date"
                  value={newRow.workDate}
                  onChange={(e) => setNewRow({ ...newRow, workDate: e.target.value })}
                  className="input-modern mt-1 w-full"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Guard</label>
                <GuardSearchPicker
                  guards={guardOptions}
                  value={newRow.actualGuardId || null}
                  onChange={(id) => setNewRow({ ...newRow, actualGuardId: id ?? "" })}
                  placeholder="Choose reliever or guard…"
                  className="input-modern mt-1 w-full"
                  allowClear={false}
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Shift</label>
                <select
                  value={newRow.actualShiftType}
                  onChange={(e) =>
                    setNewRow({
                      ...newRow,
                      actualShiftType: e.target.value,
                      actualShiftCode: e.target.value === "night" ? "N" : "D",
                    })
                  }
                  className="input-modern mt-1 w-full"
                >
                  <option value="day">Day shift</option>
                  <option value="night">Night shift</option>
                </select>
              </div>
              <div className="flex flex-col justify-end gap-2 sm:col-span-2 lg:col-span-1">
                <input
                  value={newRow.comments}
                  onChange={(e) => setNewRow({ ...newRow, comments: e.target.value })}
                  placeholder="Reason (optional)"
                  className="input-modern w-full"
                />
                <button
                  type="button"
                  disabled={!newRow.actualGuardId}
                  onClick={async () => {
                    await addSiteTimesheetRow(token, sheet.id, newRow);
                    setNewRow({ ...newRow, actualGuardId: "", comments: "" });
                    await load();
                  }}
                  className="btn-secondary w-full disabled:opacity-50"
                >
                  Add reliever
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3 2xl:hidden">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Review each day below, confirm who worked and shift times, then tap{" "}
              <span className="font-medium text-neutral-700 dark:text-neutral-300">Approve this day</span> when
              correct.
            </p>
            {displayRows.map((row) => (
              <SiteTimesheetRowCard
                key={row.id}
                row={row}
                guards={guardOptions}
                locked={locked}
                saving={savingRowId === row.id}
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

          <div className="hidden 2xl:block">
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
            <table className="site-timesheet-table w-full table-fixed text-left text-[11px]">
              <colgroup>
                <col className="w-[7%]" />
                <col className="w-[24%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[9%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead className="bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                <tr>
                  {["Date", "Who worked", "Shift", "Start / End", "Status", "Issues", "Notes", "Action"].map((label) => (
                    <th key={label} className="px-2 py-1.5 font-semibold">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {displayRows.map((row) => {
                  const rowSurfaceClass =
                    row.approvalStatus === "pending"
                      ? row.discrepancyCodes.length
                        ? "bg-amber-50/60 dark:bg-amber-950/20"
                        : "bg-white dark:bg-neutral-950"
                      : "bg-emerald-50/40 dark:bg-emerald-950/15";
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
                      <select
                        disabled={locked}
                        value={row.attendanceStatus}
                        onChange={(e) => void updateRow(row, { attendanceStatus: e.target.value as SiteTimesheetAttendance })}
                        className="input-compact w-full !px-2 !py-1 text-[11px]"
                      >
                        {ATTENDANCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
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
                      {row.approvalStatus === "approved" || locked ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Approved
                        </span>
                      ) : row.approvalStatus === "reviewed" ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex w-fit items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Reviewed
                          </span>
                          <button
                            type="button"
                            disabled={savingRowId === row.id}
                            onClick={() => void updateRow(row, { approvalStatus: "pending" })}
                            className="text-left text-[9px] text-neutral-500 underline-offset-2 hover:text-neutral-700 hover:underline dark:hover:text-neutral-300"
                          >
                            Undo
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={savingRowId === row.id}
                          onClick={() => void approveRowAttendance(row)}
                          title="Approve attendance for this day"
                          className="w-full rounded-security border-2 border-security-navy bg-security-navy px-2 py-1.5 text-[11px] font-semibold leading-tight text-white hover:bg-security-navy-800 disabled:opacity-50"
                        >
                          {savingRowId === row.id ? "…" : "Approve"}
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
    </section>
  );
}
