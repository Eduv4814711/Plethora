"use client";

import { useState } from "react";
import { GuardSearchPicker } from "@/components/guard-search-picker";
import type { GuardPickerOption, SiteTimesheetAttendance } from "@/lib/roster-api";

export type RelieverDraft = {
  workDate: string;
  actualGuardId: string;
  actualShiftType: string;
  actualShiftCode: string;
  attendanceStatus: SiteTimesheetAttendance;
  dutyOnObNumber: string;
  dutyOffObNumber: string;
  comments: string;
};

/** Record someone who worked but was never listed for the day. Extracted unchanged. */
export function SiteTimesheetRelieverForm({
  guardOptions,
  periodStart,
  periodEnd,
  onClose,
  onSubmit,
}: {
  guardOptions: GuardPickerOption[];
  periodStart: string;
  periodEnd: string;
  onClose: () => void;
  onSubmit: (draft: RelieverDraft) => Promise<void>;
}) {
  const [newRow, setNewRow] = useState<RelieverDraft>({
    workDate: periodStart,
    actualGuardId: "",
    actualShiftType: "day",
    actualShiftCode: "D",
    attendanceStatus: "reliever",
    dutyOnObNumber: "",
    dutyOffObNumber: "",
    comments: "",
  });
  const [saving, setSaving] = useState(false);

  const outOfRange = newRow.workDate < periodStart || newRow.workDate > periodEnd;
  const disabled = !newRow.actualGuardId || !newRow.dutyOnObNumber.trim() || outOfRange || saving;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-security-navy-900/45 p-4"
      role="presentation"
    >
      <div
        className="my-auto w-full max-w-4xl rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-xl dark:border-security-navy-700 dark:bg-security-navy-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-reliever-title"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="add-reliever-title"
              className="text-lg font-semibold text-security-navy-900 dark:text-security-navy-100"
            >
              Add a reliever
            </h2>
            <p className="mt-1 text-sm text-security-navy-500 dark:text-security-navy-400">
              Use this only when someone worked but was not already listed for the day.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary min-h-11"
            aria-label="Close add reliever dialog"
          >
            Close
          </button>
        </div>
        <div className="grid gap-3 rounded-lg border border-security-navy-100 bg-security-navy-50 p-3 text-sm dark:border-security-navy-700 dark:bg-security-navy-900 sm:grid-cols-2 lg:grid-cols-7">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
              Date
            </label>
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
            <label className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
              Guard <span className="text-security-amber-600">*</span>
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
              <p className="mt-1 text-xs text-security-amber-700 dark:text-security-amber-400">
                Select who worked — required before you can add them to the timesheet.
              </p>
            )}
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
              Shift
            </label>
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
            <label className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
              Duty ON OB <span className="text-security-amber-600">*</span>
            </label>
            <input
              value={newRow.dutyOnObNumber}
              onChange={(e) => setNewRow((prev) => ({ ...prev, dutyOnObNumber: e.target.value }))}
              placeholder="Duty ON OB"
              className="input-modern mt-1 w-full"
              maxLength={80}
              inputMode="numeric"
              autoComplete="off"
              required
              aria-required="true"
            />
            {!newRow.dutyOnObNumber.trim() && (
              <p className="mt-1 text-xs text-security-amber-700 dark:text-security-amber-400">
                Duty ON OB is required before adding a reliever.
              </p>
            )}
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-500">
              Duty OFF OB
            </label>
            <input
              value={newRow.dutyOffObNumber}
              onChange={(e) => setNewRow((prev) => ({ ...prev, dutyOffObNumber: e.target.value }))}
              placeholder="Optional — enter later"
              className="input-modern mt-1 w-full"
              maxLength={80}
              inputMode="numeric"
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
              disabled={disabled}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSubmit(newRow);
                } finally {
                  setSaving(false);
                }
              }}
              className="btn-primary min-h-11 w-full disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add reliever"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
