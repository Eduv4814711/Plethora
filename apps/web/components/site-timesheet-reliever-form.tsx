"use client";

import { useState } from "react";
import { GuardSearchPicker } from "@/components/guard-search-picker";
import type { GuardPickerOption, SiteTimesheetAttendance } from "@/lib/roster-api";
import { Button, Field, Input, Modal, Select } from "@/components/ui";

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

/** Record someone who worked but was never listed for the day. */
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
    <Modal
      open={true}
      onClose={() => {
        if (!saving) onClose();
      }}
      title="Add a reliever"
      description="Use this only when someone worked but was not already listed for the day."
      size="xl"
      closeOnBackdrop={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={disabled}
            onClick={async () => {
              setSaving(true);
              try {
                await onSubmit(newRow);
              } finally {
                setSaving(false);
              }
            }}
          >
            Add reliever
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Date">
          <Input
            type="date"
            value={newRow.workDate}
            min={periodStart}
            max={periodEnd}
            required
            onChange={(e) => setNewRow((prev) => ({ ...prev, workDate: e.target.value }))}
          />
        </Field>

        <div className="space-y-1.5 sm:col-span-2">
          <label className="label-text block">
            Guard <span className="text-security-amber-600">*</span>
          </label>
          <GuardSearchPicker
            guards={guardOptions}
            value={newRow.actualGuardId || null}
            onChange={(id) => setNewRow((prev) => ({ ...prev, actualGuardId: id ?? "" }))}
            placeholder="Choose reliever or guard…"
            className="input-modern w-full"
            allowClear={false}
          />
          {!newRow.actualGuardId && (
            <p className="text-xs text-security-amber-700">
              Select who worked — required before you can add them to the timesheet.
            </p>
          )}
        </div>

        <Field label="Shift">
          <Select
            value={newRow.actualShiftType}
            onChange={(e) =>
              setNewRow((prev) => ({
                ...prev,
                actualShiftType: e.target.value,
                actualShiftCode: e.target.value === "night" ? "N" : "D",
              }))
            }
          >
            <option value="day">Day shift</option>
            <option value="night">Night shift</option>
          </Select>
        </Field>

        <Field
          label="Duty ON OB *"
          error={!newRow.dutyOnObNumber.trim() ? "Duty ON OB is required." : undefined}
        >
          <Input
            value={newRow.dutyOnObNumber}
            onChange={(e) => setNewRow((prev) => ({ ...prev, dutyOnObNumber: e.target.value }))}
            placeholder="Duty ON OB"
            maxLength={80}
            inputMode="numeric"
            autoComplete="off"
            required
          />
        </Field>

        <Field label="Duty OFF OB">
          <Input
            value={newRow.dutyOffObNumber}
            onChange={(e) => setNewRow((prev) => ({ ...prev, dutyOffObNumber: e.target.value }))}
            placeholder="Optional — enter later"
            maxLength={80}
            inputMode="numeric"
            autoComplete="off"
          />
        </Field>

        <Field label="Reason (optional)" className="sm:col-span-2 lg:col-span-3">
          <Input
            value={newRow.comments}
            onChange={(e) => setNewRow((prev) => ({ ...prev, comments: e.target.value }))}
            placeholder="Why a reliever covered this shift"
          />
        </Field>
      </div>
    </Modal>
  );
}
