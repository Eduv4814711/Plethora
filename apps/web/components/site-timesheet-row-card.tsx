"use client";

import { GuardSearchPicker } from "@/components/guard-search-picker";
import { ShiftTimeSelect } from "@/components/shift-time-select";
import { defaultShiftTime } from "@/lib/shift-times";
import type { SiteTimesheetAttendance, SiteTimesheetRow } from "@/lib/roster-api";

type GuardOption = {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber?: string | null;
  psiraNumber?: string | null;
};

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

type SiteTimesheetRowCardProps = {
  row: SiteTimesheetRow;
  guards: GuardOption[];
  locked: boolean;
  saving: boolean;
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
};

export function SiteTimesheetRowCard({
  row,
  guards,
  locked,
  saving,
  rowShiftType,
  displayShiftTime,
  combineDateTime,
  combineClockOut,
  hoursBetween,
  onUpdate,
  onApprove,
}: SiteTimesheetRowCardProps) {
  const shiftType = rowShiftType(row);
  const needsReview = row.approvalStatus === "pending";
  const reviewed = row.approvalStatus === "reviewed" || row.approvalStatus === "approved";

  return (
    <article
      className={`rounded-xl border p-4 space-y-3 ${
        needsReview
          ? row.discrepancyCodes.length
            ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20"
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
            {locked ? "Approved" : "Reviewed"}
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            Needs review
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Scheduled</p>
          <p className="text-sm text-neutral-800 dark:text-neutral-200">{row.plannedGuardName ?? "Unrostered"}</p>
          {(row.employeeNumber || row.psiraNumber) && (
            <p className="text-xs text-neutral-500">{row.employeeNumber ?? row.psiraNumber}</p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Who worked</p>
          <GuardSearchPicker
            guards={guards}
            value={row.actualGuardId}
            defaultGuardId={row.plannedGuardId}
            disabled={locked || saving}
            onChange={(guardId) => onUpdate(row, { actualGuardId: guardId })}
            clearLabel="Nobody worked"
            className="input-modern w-full"
          />
        </div>
      </div>

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
          <select
            disabled={locked}
            value={row.attendanceStatus}
            onChange={(e) => onUpdate(row, { attendanceStatus: e.target.value as SiteTimesheetAttendance })}
            className="input-modern mt-1 w-full"
          >
            {ATTENDANCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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

      {!locked && row.approvalStatus === "pending" && (
        <button
          type="button"
          disabled={saving}
          onClick={() => onApprove(row)}
          className="btn-primary w-full disabled:opacity-50"
        >
          {saving ? "Saving…" : "Approve this day"}
        </button>
      )}

      {!locked && row.approvalStatus === "reviewed" && (
        <button
          type="button"
          disabled={saving}
          onClick={() => onUpdate(row, { approvalStatus: "pending" })}
          className="btn-secondary w-full text-sm"
        >
          Undo review
        </button>
      )}
    </article>
  );
}
