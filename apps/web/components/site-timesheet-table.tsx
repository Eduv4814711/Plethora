"use client";

import { GuardSearchPicker } from "@/components/guard-search-picker";
import { ShiftTimeSelect } from "@/components/shift-time-select";
import { displayShiftTime } from "@/lib/shift-times";
import type { GuardPickerOption, SiteTimesheetRow } from "@/lib/roster-api";
import {
  formatAttendanceStatus,
  isRowFullyReviewed,
  resolveDutyOffFromRow,
  resolveDutyOnFromRow,
} from "@/lib/site-timesheet-utils";
import {
  combineClockOut,
  combineDateTime,
  hoursBetween,
  humanizeCode,
  rowShiftType,
  shiftTypeTimesPatch,
} from "@/lib/site-timesheet-row-patch";

const COLUMNS = [
  "Date",
  "Who worked",
  "Shift",
  "Start / End",
  "Status",
  "Issues",
  "Notes",
  "Duty ON OB",
  "Duty OFF OB",
  "Action",
];

/** Wide-screen timesheet grid. Extracted from SiteTimesheetsSection. */
export function SiteTimesheetTable({
  rows,
  guardOptions,
  locked,
  readOnly,
  canEdit,
  canEditLockedOb,
  savingRowId,
  getDutyOnDraft,
  getDutyOffDraft,
  setDutyOnDraft,
  setDutyOffDraft,
  onSaveDutyOb,
  onUpdate,
  onApprove,
  onReopen,
}: {
  rows: SiteTimesheetRow[];
  guardOptions: GuardPickerOption[];
  locked: boolean;
  readOnly: boolean;
  canEdit: boolean;
  canEditLockedOb: boolean;
  savingRowId: string | null;
  getDutyOnDraft: (row: SiteTimesheetRow) => string;
  getDutyOffDraft: (row: SiteTimesheetRow) => string;
  setDutyOnDraft: (rowId: string, value: string) => void;
  setDutyOffDraft: (rowId: string, value: string) => void;
  onSaveDutyOb: (row: SiteTimesheetRow, which: "on" | "off") => void;
  onUpdate: (row: SiteTimesheetRow, patch: Partial<SiteTimesheetRow>) => void;
  onApprove: (row: SiteTimesheetRow) => void;
  onReopen: (row: SiteTimesheetRow) => void;
}) {
  return (
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
              {COLUMNS.map((column) => (
                <th key={column} className="px-2 py-1.5 font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {rows.map((row) => {
              const rowSurfaceClass = isRowFullyReviewed(row.approvalStatus)
                ? "bg-emerald-50/40 dark:bg-emerald-950/15"
                : row.approvalStatus === "partially_reviewed"
                  ? "bg-amber-50/50 dark:bg-amber-950/20"
                  : row.discrepancyCodes.length
                    ? "bg-amber-50/60 dark:bg-amber-950/20"
                    : "bg-white dark:bg-neutral-950";
              const cellClass = `px-2 py-1.5 align-top ${rowSurfaceClass}`;
              const guardChanged =
                !!row.actualGuardId && !!row.plannedGuardId && row.actualGuardId !== row.plannedGuardId;
              const savedDutyOn = resolveDutyOnFromRow(row);
              const savedDutyOff = resolveDutyOffFromRow(row);
              const dutyOnLocked = Boolean(savedDutyOn) && !canEditLockedOb;
              const dutyOffLocked = Boolean(savedDutyOff) && !canEditLockedOb;

              return (
                <tr key={row.id} className={rowSurfaceClass}>
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
                        {row.employeeNumber || row.psiraRegistrationNumber
                          ? ` (${row.employeeNumber ?? row.psiraRegistrationNumber})`
                          : ""}
                      </p>
                    ) : null}
                    <GuardSearchPicker
                      guards={guardOptions}
                      value={row.actualGuardId}
                      defaultGuardId={row.plannedGuardId}
                      defaultGuardLabel={row.plannedGuardName}
                      disabled={readOnly || savingRowId === row.id}
                      onChange={(guardId) => onUpdate(row, { actualGuardId: guardId })}
                      clearLabel="Nobody worked"
                      truncateLabel
                      compact
                      className="input-compact !px-2 !py-1 text-[11px]"
                    />
                  </td>
                  <td className={cellClass}>
                    <p className="mb-0.5 text-[10px] leading-tight text-neutral-500">
                      Plan: {humanizeCode(row.plannedShiftType ?? row.plannedShiftCode)}
                    </p>
                    <select
                      disabled={readOnly}
                      value={row.actualShiftType ?? ""}
                      onChange={(e) => {
                        const nextType =
                          e.target.value === "night" ? "night" : e.target.value === "day" ? "day" : null;
                        onUpdate(row, {
                          actualShiftType: e.target.value || null,
                          actualShiftCode:
                            e.target.value === "night" ? "N" : e.target.value === "day" ? "D" : null,
                          ...shiftTypeTimesPatch(row.workDate, nextType),
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
                        disabled={readOnly || savingRowId === row.id}
                        onChange={(time) => {
                          const clockIn = combineDateTime(row.workDate, time);
                          if (clockIn === (row.clockIn ?? null)) return;
                          onUpdate(row, { clockIn, hoursWorked: hoursBetween(clockIn, row.clockOut) });
                        }}
                        className="input-compact w-[4.25rem] !px-1 !py-1 text-[11px]"
                        title="Start time"
                      />
                      <span className="text-neutral-400">/</span>
                      <ShiftTimeSelect
                        value={displayShiftTime(row.clockOut, rowShiftType(row), "end")}
                        disabled={readOnly || savingRowId === row.id}
                        onChange={(time) => {
                          const shiftType = rowShiftType(row);
                          const clockIn =
                            row.clockIn ??
                            combineDateTime(row.workDate, displayShiftTime(null, shiftType, "start"));
                          const clockOut = combineClockOut(row.workDate, time, clockIn);
                          if (clockOut === (row.clockOut ?? null)) return;
                          onUpdate(row, { clockOut, hoursWorked: hoursBetween(clockIn, clockOut) });
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
                      {row.discrepancyCodes.length ? (
                        row.discrepancyCodes.map((code) => (
                          <span
                            key={code}
                            className="rounded-full border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium leading-tight text-amber-800"
                          >
                            {humanizeCode(code)}
                          </span>
                        ))
                      ) : (
                        <span className="text-neutral-400">None</span>
                      )}
                    </div>
                  </td>
                  <td className={cellClass}>
                    <input
                      disabled={readOnly}
                      defaultValue={row.comments ?? ""}
                      onBlur={(e) => onUpdate(row, { comments: e.target.value })}
                      className="input-compact w-full !px-2 !py-1 text-[11px]"
                      placeholder="Notes"
                      title="Supervisor note (optional)"
                    />
                  </td>
                  <td className={cellClass}>
                    {readOnly || row.approvalStatus === "approved" || dutyOnLocked ? (
                      <span
                        className="font-medium text-neutral-800 dark:text-neutral-200"
                        title={
                          dutyOnLocked
                            ? "Duty ON OB is locked. Attendance approval access is required to change it."
                            : "Duty ON OB number"
                        }
                      >
                        {savedDutyOn || "—"}
                      </span>
                    ) : (
                      <input
                        value={getDutyOnDraft(row)}
                        onChange={(e) => setDutyOnDraft(row.id, e.target.value)}
                        onBlur={() => onSaveDutyOb(row, "on")}
                        disabled={savingRowId === row.id}
                        inputMode="numeric"
                        enterKeyHint="next"
                        className="input-compact w-full !px-2 !py-1 text-[11px]"
                        placeholder="Duty ON"
                        title="Duty ON OB number"
                        aria-label={`Duty ON OB for ${row.workDate}`}
                      />
                    )}
                  </td>
                  <td className={cellClass}>
                    {readOnly || row.approvalStatus === "approved" || dutyOffLocked ? (
                      <span
                        className="font-medium text-neutral-800 dark:text-neutral-200"
                        title={
                          dutyOffLocked
                            ? "Duty OFF OB is locked. Attendance approval access is required to change it."
                            : "Duty OFF OB number"
                        }
                      >
                        {savedDutyOff || "—"}
                      </span>
                    ) : (
                      <input
                        value={getDutyOffDraft(row)}
                        onChange={(e) => setDutyOffDraft(row.id, e.target.value)}
                        onBlur={() => onSaveDutyOb(row, "off")}
                        disabled={savingRowId === row.id}
                        inputMode="numeric"
                        enterKeyHint="done"
                        className="input-compact w-full !px-2 !py-1 text-[11px]"
                        placeholder="Duty OFF"
                        title="Duty OFF OB — required before confirming attendance"
                        aria-label={`Duty OFF OB for ${row.workDate}`}
                      />
                    )}
                  </td>
                  <td className={cellClass}>
                    {row.approvalStatus === "approved" || locked ? (
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                        Approved
                      </span>
                    ) : !canEdit ? (
                      <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-neutral-600">
                        {formatAttendanceStatus(row.approvalStatus)}
                      </span>
                    ) : row.approvalStatus === "reviewed" ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="inline-flex w-fit items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Confirmed
                        </span>
                        <button
                          type="button"
                          disabled={savingRowId === row.id}
                          onClick={() => onReopen(row)}
                          className="text-left text-[9px] text-neutral-500 underline-offset-2 hover:text-neutral-700 hover:underline dark:hover:text-neutral-300"
                        >
                          Reopen
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={savingRowId === row.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onApprove(row)}
                        title="Enter both OB numbers, then confirm attendance."
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
  );
}
