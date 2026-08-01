"use client";

import { useState } from "react";
import { GuardSearchPicker } from "@/components/guard-search-picker";
import { ShiftTimeSelect } from "@/components/shift-time-select";
import { defaultShiftTime } from "@/lib/shift-times";
import type { SiteTimesheetRow } from "@/lib/roster-api";
import {
  formatAttendanceStatus,
  isRowFullyReviewed,
  isRowPendingReview,
  resolveDutyOffFromRow,
  resolveDutyOnFromRow,
} from "@/lib/site-timesheet-utils";

type GuardOption = {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber?: string | null;
  psiraRegistrationNumber?: string | null;
};

function label(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "Not set";
}

type SiteTimesheetRowCardProps = {
  row: SiteTimesheetRow;
  guards: GuardOption[];
  locked: boolean;
  saving: boolean;
  dutyOnObNumber: string;
  dutyOffObNumber: string;
  onDutyOnObNumberChange: (value: string) => void;
  onDutyOffObNumberChange: (value: string) => void;
  onDutyOnObNumberSave?: (value?: string) => void;
  onDutyOffObNumberSave?: (value?: string) => void;
  canEditLockedOb?: boolean;
  rowShiftType: (row: SiteTimesheetRow) => "day" | "night" | null;
  displayShiftTime: (
    iso: string | null | undefined,
    shiftType: "day" | "night" | null,
    which: "start" | "end"
  ) => string;
  combineDateTime: (workDate: string, time: string) => string | null;
  combineClockOut: (workDate: string, time: string, clockIn: string | null) => string | null;
  hoursBetween: (clockIn: string | null, clockOut: string | null) => number | null;
  onUpdate: (row: SiteTimesheetRow, patch: Partial<SiteTimesheetRow>) => void;
  onApprove: (row: SiteTimesheetRow) => void;
  onReopen: (row: SiteTimesheetRow) => void;
};

export function SiteTimesheetRowCard({
  row,
  guards,
  locked,
  saving,
  dutyOnObNumber,
  dutyOffObNumber,
  onDutyOnObNumberChange,
  onDutyOffObNumberChange,
  onDutyOnObNumberSave,
  onDutyOffObNumberSave,
  canEditLockedOb = false,
  rowShiftType,
  displayShiftTime,
  combineDateTime,
  combineClockOut,
  hoursBetween,
  onUpdate,
  onApprove,
  onReopen,
}: SiteTimesheetRowCardProps) {
  const [showDifferentGuard, setShowDifferentGuard] = useState(
    Boolean(row.actualGuardId && row.actualGuardId !== row.plannedGuardId)
  );
  const shiftType = rowShiftType(row);
  const pendingReview = isRowPendingReview(row.approvalStatus);
  const partiallyReviewed = row.approvalStatus === "partially_reviewed";
  const reviewed = isRowFullyReviewed(row.approvalStatus);
  const savedDutyOn = resolveDutyOnFromRow(row);
  const savedDutyOff = resolveDutyOffFromRow(row);
  const dutyOnLocked = Boolean(savedDutyOn) && !canEditLockedOb;
  const dutyOffLocked = Boolean(savedDutyOff) && !canEditLockedOb;
  const dutyOffEnabled = Boolean(savedDutyOn) || Boolean(dutyOnObNumber.trim());

  return (
    <article
      className={`rounded-xl border p-4 space-y-3 ${
        pendingReview
          ? row.discrepancyCodes.length
            ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20"
            : partiallyReviewed
              ? "border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/15"
              : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-950"
          : "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/15"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{row.workDate}</p>
          <p className="text-xs text-neutral-500">{row.dayOfWeek}</p>
        </div>
        {reviewed ? (
          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {locked ? "Approved" : "Confirmed"}
          </span>
        ) : partiallyReviewed ? (
          <span className="shrink-0 rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            Duty ON saved
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            Needs confirmation
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Scheduled</p>
          <p className="text-sm text-neutral-800 dark:text-neutral-200">{row.plannedGuardName ?? "Unrostered"}</p>
          {(row.employeeNumber || row.psiraRegistrationNumber) && (
            <p className="text-xs text-neutral-500">{row.employeeNumber ?? row.psiraRegistrationNumber}</p>
          )}
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Who worked?</p>
          <div className="grid gap-2">
            <button
              type="button"
              disabled={locked || saving || !row.plannedGuardId}
              onClick={() => {
                setShowDifferentGuard(false);
                const plannedType = row.plannedShiftType === "night" || row.plannedShiftCode === "N" ? "night" : "day";
                const clockIn = combineDateTime(row.workDate, defaultShiftTime(plannedType, "start"));
                const clockOut = combineClockOut(row.workDate, defaultShiftTime(plannedType, "end"), clockIn);
                onUpdate(row, {
                  actualGuardId: row.plannedGuardId,
                  actualShiftType: plannedType,
                  actualShiftCode: plannedType === "night" ? "N" : "D",
                  clockIn,
                  clockOut,
                  hoursWorked: hoursBetween(clockIn, clockOut),
                });
              }}
              className="btn-secondary min-h-11 w-full text-left"
            >
              Worked as scheduled
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={locked || saving}
                onClick={() => setShowDifferentGuard(true)}
                className="btn-secondary min-h-11 text-sm"
                aria-expanded={showDifferentGuard}
              >
                Different guard
              </button>
              <button
                type="button"
                disabled={locked || saving}
                onClick={() => {
                  setShowDifferentGuard(false);
                  onUpdate(row, {
                    actualGuardId: null,
                    actualShiftType: null,
                    actualShiftCode: null,
                    clockIn: null,
                    clockOut: null,
                    hoursWorked: null,
                  });
                }}
                className="btn-secondary min-h-11 text-sm"
              >
                Nobody worked
              </button>
            </div>
            {showDifferentGuard && (
              <GuardSearchPicker
                guards={guards}
                value={row.actualGuardId}
                defaultGuardId={row.plannedGuardId}
                defaultGuardLabel={row.plannedGuardName}
                disabled={locked || saving}
                onChange={(guardId) => onUpdate(row, { actualGuardId: guardId })}
                clearLabel="Choose another guard"
                className="input-modern w-full"
              />
            )}
          </div>
        </div>
      </div>

      <details className="rounded-lg border border-neutral-200 bg-white/70 p-3 dark:border-neutral-700 dark:bg-neutral-950/40">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-security-navy-700 dark:text-security-navy-300">
          Adjust shift, times, or notes
        </summary>
        <div className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Shift worked</label>
          <select
            disabled={locked}
            value={row.actualShiftType ?? ""}
            onChange={(e) => {
              const nextType = e.target.value;
              const shiftType = nextType === "night" ? "night" : nextType === "day" ? "day" : null;
              const patch: Partial<SiteTimesheetRow> = {
                actualShiftType: nextType || null,
                actualShiftCode: nextType === "night" ? "N" : nextType === "day" ? "D" : null,
              };
              if (shiftType) {
                const startTime = defaultShiftTime(shiftType, "start");
                const clockIn = combineDateTime(row.workDate, startTime);
                const endTime = defaultShiftTime(shiftType, "end");
                const clockOut = combineClockOut(row.workDate, endTime, clockIn);
                patch.clockIn = clockIn;
                patch.clockOut = clockOut;
                patch.hoursWorked = hoursBetween(clockIn, clockOut);
              }
              onUpdate(row, patch);
            }}
            className="input-modern mt-1 w-full"
          >
            <option value="">Not worked</option>
            <option value="day">Day shift</option>
            <option value="night">Night shift</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Status</label>
          <p
            className="mt-1 text-sm font-medium text-neutral-800 dark:text-neutral-200"
            title="Set automatically when you confirm this attendance entry"
          >
            {formatAttendanceStatus(row.attendanceStatus)}
          </p>
        </div>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Start / end time</label>
        <div className="mt-1 flex items-center gap-2">
          <ShiftTimeSelect
            value={displayShiftTime(row.clockIn, shiftType, "start")}
            disabled={locked || saving}
            onChange={(time) => {
              const clockIn = combineDateTime(row.workDate, time);
              if (clockIn === (row.clockIn ?? null)) return;
              onUpdate(row, { clockIn, hoursWorked: hoursBetween(clockIn, row.clockOut) });
            }}
            className="input-modern flex-1"
            title="Start time"
          />
          <span className="text-neutral-400">to</span>
          <ShiftTimeSelect
            value={displayShiftTime(row.clockOut, shiftType, "end")}
            disabled={locked || saving}
            onChange={(time) => {
              const clockIn =
                row.clockIn ?? combineDateTime(row.workDate, displayShiftTime(null, shiftType, "start"));
              const clockOut = combineClockOut(row.workDate, time, clockIn);
              if (clockOut === (row.clockOut ?? null)) return;
              onUpdate(row, { clockOut, hoursWorked: hoursBetween(clockIn, clockOut) });
            }}
            className="input-modern flex-1"
            title="End time"
          />
        </div>
      </div>

      {row.discrepancyCodes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.discrepancyCodes.map((code) => (
            <span
              key={code}
              className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
            >
              {label(code)}
            </span>
          ))}
        </div>
      )}

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Notes</label>
        <input
          disabled={locked}
          defaultValue={row.comments ?? ""}
          onBlur={(e) => onUpdate(row, { comments: e.target.value })}
          className="input-modern mt-1 w-full"
          placeholder="Optional comment"
        />
      </div>

        </div>
      </details>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">1 of 2 · Duty ON OB</label>
          {locked || row.approvalStatus === "approved" || dutyOnLocked ? (
            <div className="mt-1">
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {savedDutyOn || "—"}
              </p>
              {dutyOnLocked && !locked && row.approvalStatus !== "approved" && (
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  Locked — attendance approval access is required to change this.
                </p>
              )}
            </div>
          ) : (
            <input
              value={dutyOnObNumber}
              onChange={(e) => onDutyOnObNumberChange(e.target.value)}
              onBlur={() => onDutyOnObNumberSave?.()}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const value = e.currentTarget.value;
                onDutyOnObNumberChange(value);
                onDutyOnObNumberSave?.(value);
              }}
              disabled={saving}
              className="input-modern mt-1 w-full"
              placeholder="Duty ON OB"
              title="Duty ON OB — press Enter to save as partial approval"
              aria-label={`Duty ON OB for ${row.workDate}`}
            />
          )}
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">2 of 2 · Duty OFF OB</label>
          {locked || row.approvalStatus === "approved" || dutyOffLocked ? (
            <div className="mt-1">
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {savedDutyOff || "—"}
              </p>
              {dutyOffLocked && !locked && row.approvalStatus !== "approved" && (
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  Locked — attendance approval access is required to change this.
                </p>
              )}
            </div>
          ) : (
            <input
              value={dutyOffObNumber}
              onChange={(e) => onDutyOffObNumberChange(e.target.value)}
              onBlur={() => onDutyOffObNumberSave?.()}
              disabled={saving || !dutyOffEnabled}
              className="input-modern mt-1 w-full disabled:opacity-50"
              placeholder={dutyOffEnabled ? "Duty OFF OB" : "Enter Duty ON first"}
              title="Duty OFF OB — required before confirming attendance"
              aria-label={`Duty OFF OB for ${row.workDate}`}
            />
          )}
        </div>
      </div>

      {!locked && pendingReview && (
        <button
          type="button"
          disabled={saving}
          onMouseDown={(e) => {
            e.preventDefault();
          }}
          onClick={() => onApprove(row)}
          className="btn-primary w-full disabled:opacity-50"
          title="Enter Duty ON and Duty OFF OB numbers, then confirm attendance."
        >
          {saving ? "Saving…" : "Confirm attendance"}
        </button>
      )}

      {!locked && row.approvalStatus === "reviewed" && (
        <button
          type="button"
          disabled={saving}
          onClick={() => onReopen(row)}
          className="btn-secondary w-full text-sm"
        >
          Reopen attendance entry
        </button>
      )}
    </article>
  );
}
