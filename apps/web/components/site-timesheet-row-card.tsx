"use client";

import { useRef, useState } from "react";
import { GuardSearchPicker } from "@/components/guard-search-picker";
import { ShiftTimeSelect } from "@/components/shift-time-select";
import { defaultShiftTime, displayShiftTime } from "@/lib/shift-times";
import type { SiteTimesheetRow } from "@/lib/roster-api";
import {
  formatAttendanceStatus,
  isRowFullyReviewed,
  isRowPendingReview,
  resolveDutyOffFromRow,
  resolveDutyOnFromRow,
} from "@/lib/site-timesheet-utils";
import {
  combineClockOut,
  combineDateTime,
  hoursBetween,
  humanizeCode,
  rowShiftType,
} from "@/lib/site-timesheet-row-patch";

type GuardOption = {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber?: string | null;
  psiraRegistrationNumber?: string | null;
};

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
  onUpdate,
  onApprove,
  onReopen,
}: SiteTimesheetRowCardProps) {
  const guardChanged = Boolean(row.actualGuardId && row.actualGuardId !== row.plannedGuardId);
  // Open the editor straight away when the row already departs from the roster — there is
  // nothing to collapse behind a summary in that case.
  const [showDetails, setShowDetails] = useState(guardChanged);
  const [showDifferentGuard, setShowDifferentGuard] = useState(guardChanged);
  const dutyOffRef = useRef<HTMLInputElement>(null);

  const shiftType = rowShiftType(row);
  const pendingReview = isRowPendingReview(row.approvalStatus);
  const partiallyReviewed = row.approvalStatus === "partially_reviewed";
  const reviewed = isRowFullyReviewed(row.approvalStatus);
  const savedDutyOn = resolveDutyOnFromRow(row);
  const savedDutyOff = resolveDutyOffFromRow(row);
  const dutyOnLocked = Boolean(savedDutyOn) && !canEditLockedOb;
  const dutyOffLocked = Boolean(savedDutyOff) && !canEditLockedOb;

  const plannedShiftLabel = humanizeCode(row.plannedShiftType ?? row.plannedShiftCode);
  const explicitNotWorked =
    row.actualGuardId === null && !row.actualShiftType && !row.clockIn && !row.clockOut;

  /** One-line answer to "who worked, on what shift" so the common case needs no reading. */
  const summary = explicitNotWorked
    ? "Nobody worked"
    : guardChanged
      ? `${row.actualGuardName ?? "Another guard"} — covering for ${row.plannedGuardName ?? "unrostered"}`
      : `As scheduled — ${row.plannedGuardName ?? "Unrostered"}${
          shiftType
            ? ` · ${plannedShiftLabel} ${defaultShiftTime(shiftType, "start")}–${defaultShiftTime(shiftType, "end")}`
            : ""
        }`;

  const applyWorkedAsScheduled = () => {
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
  };

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

      <div className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 bg-white/70 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-950/40">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Who worked
          </p>
          <p className="mt-0.5 truncate text-sm text-neutral-800 dark:text-neutral-200">{summary}</p>
          {(row.employeeNumber || row.psiraRegistrationNumber) && (
            <p className="text-xs text-neutral-500">
              {row.employeeNumber ?? row.psiraRegistrationNumber}
            </p>
          )}
        </div>
        {!locked && (
          <button
            type="button"
            disabled={saving}
            onClick={() => setShowDetails((value) => !value)}
            aria-expanded={showDetails}
            className="btn-secondary min-h-11 shrink-0 text-sm"
          >
            {showDetails ? "Done" : "Change"}
          </button>
        )}
      </div>

      {showDetails && (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-white/70 p-3 dark:border-neutral-700 dark:bg-neutral-950/40">
          <div className="grid gap-2">
            <button
              type="button"
              disabled={locked || saving || !row.plannedGuardId}
              onClick={applyWorkedAsScheduled}
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Shift worked
              </label>
              <select
                disabled={locked}
                value={row.actualShiftType ?? ""}
                onChange={(e) => {
                  const nextType = e.target.value;
                  const selected = nextType === "night" ? "night" : nextType === "day" ? "day" : null;
                  const patch: Partial<SiteTimesheetRow> = {
                    actualShiftType: nextType || null,
                    actualShiftCode: nextType === "night" ? "N" : nextType === "day" ? "D" : null,
                  };
                  if (selected) {
                    const clockIn = combineDateTime(row.workDate, defaultShiftTime(selected, "start"));
                    const clockOut = combineClockOut(
                      row.workDate,
                      defaultShiftTime(selected, "end"),
                      clockIn
                    );
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
              <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Status
              </label>
              <p
                className="mt-1 text-sm font-medium text-neutral-800 dark:text-neutral-200"
                title="Set automatically when you confirm this attendance entry"
              >
                {formatAttendanceStatus(row.attendanceStatus)}
              </p>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Start / end time
            </label>
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

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Notes
            </label>
            <input
              disabled={locked}
              defaultValue={row.comments ?? ""}
              onBlur={(e) => onUpdate(row, { comments: e.target.value })}
              className="input-modern mt-1 w-full"
              placeholder="Optional comment"
            />
          </div>
        </div>
      )}

      {row.discrepancyCodes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.discrepancyCodes.map((code) => (
            <span
              key={code}
              className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
            >
              {humanizeCode(code)}
            </span>
          ))}
        </div>
      )}

      {/*
        Both OB numbers are entered together and submitted with the confirmation. The
        second field used to stay disabled until the first had been saved to the server,
        which made every row a three-step round trip.
      */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Duty ON OB
          </label>
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
                dutyOffRef.current?.focus();
              }}
              disabled={saving}
              inputMode="numeric"
              enterKeyHint="next"
              className="input-modern mt-1 w-full"
              placeholder="Duty ON OB"
              aria-label={`Duty ON OB for ${row.workDate}`}
            />
          )}
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Duty OFF OB
          </label>
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
              ref={dutyOffRef}
              value={dutyOffObNumber}
              onChange={(e) => onDutyOffObNumberChange(e.target.value)}
              onBlur={() => onDutyOffObNumberSave?.()}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                onApprove(row);
              }}
              disabled={saving}
              inputMode="numeric"
              enterKeyHint="done"
              className="input-modern mt-1 w-full"
              placeholder="Duty OFF OB"
              aria-label={`Duty OFF OB for ${row.workDate}`}
            />
          )}
        </div>
      </div>

      {!locked && pendingReview && (
        <button
          type="button"
          disabled={saving}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onApprove(row)}
          className="btn-primary w-full disabled:opacity-50"
          title="Enter both OB numbers, then confirm attendance."
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
