"use client";

import { useMemo, useRef, useState } from "react";
import type { BulkConfirmResult, SiteTimesheetRow } from "@/lib/roster-api";
import { rowRequiresObInUi, suggestNextObNumber, type ObBookModeUi } from "@/lib/site-timesheet-utils";
import { humanizeCode } from "@/lib/site-timesheet-row-patch";
import { AlertBanner, Button, Input, Modal } from "@/components/ui";

type Draft = { dutyOn: string; dutyOff: string };

/**
 * Confirm a whole day (or a whole sheet) of routine shifts in one pass.
 * Respects per-site `obBookMode` (`REQUIRED` | `OPTIONAL_WHEN_DIGITAL` | `OPTIONAL`).
 */
export function SiteTimesheetBulkConfirmModal({
  rows,
  saving,
  obBookMode = "REQUIRED",
  onCancel,
  onSubmit,
}: {
  rows: SiteTimesheetRow[];
  saving: boolean;
  obBookMode?: ObBookModeUi;
  onCancel: () => void;
  onSubmit: (
    entries: Array<{ rowId: string; dutyOnObNumber: string; dutyOffObNumber: string }>
  ) => Promise<BulkConfirmResult | null>;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [failures, setFailures] = useState<BulkConfirmResult["failed"]>([]);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const failureByRowId = useMemo(
    () => new Map(failures.map((failure) => [failure.rowId, failure])),
    [failures]
  );

  const draftFor = (rowId: string): Draft => drafts[rowId] ?? { dutyOn: "", dutyOff: "" };

  const setDraft = (rowId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [rowId]: { ...draftFor(rowId), ...patch } }));
  };

  const cascadeFrom = (index: number, value: string) => {
    const seed = value.trim();
    if (!seed) return;
    setDrafts((prev) => {
      const next = { ...prev };
      let previous = seed;
      for (let i = index + 1; i < rows.length; i += 1) {
        const suggestion = suggestNextObNumber(previous);
        if (!suggestion) break;
        const rowId = rows[i].id;
        const existing = next[rowId] ?? { dutyOn: "", dutyOff: "" };
        if (existing.dutyOn.trim()) {
          previous = existing.dutyOn.trim();
          continue;
        }
        next[rowId] = { ...existing, dutyOn: suggestion };
        previous = suggestion;
      }
      return next;
    });
  };

  const complete = rows.filter((row) => {
    const needsOb = rowRequiresObInUi(row, obBookMode);
    if (!needsOb) return true;
    const draft = draftFor(row.id);
    return Boolean(draft.dutyOn.trim() && draft.dutyOff.trim());
  });

  const submit = async () => {
    const entries = complete.map((row) => {
      const draft = draftFor(row.id);
      return {
        rowId: row.id,
        dutyOnObNumber: draft.dutyOn.trim(),
        dutyOffObNumber: draft.dutyOff.trim(),
      };
    });
    if (entries.length === 0) return;
    const result = await onSubmit(entries);
    if (!result) return;
    setFailures(result.failed);
    if (result.failed.length === 0) onCancel();
  };

  return (
    <Modal
      open={true}
      onClose={() => {
        if (!saving) onCancel();
      }}
      title={`Confirm ${rows.length} shift${rows.length === 1 ? "" : "s"} as scheduled`}
      description="These shifts match the roster. Enter the occurrence book numbers and confirm them all at once."
      size="xl"
      closeOnBackdrop={!saving}
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-security-navy-600" aria-live="polite">
            {complete.length} of {rows.length} ready —{" "}
            {obBookMode === "OPTIONAL"
              ? "OB numbers are optional on this site."
              : obBookMode === "OPTIONAL_WHEN_DIGITAL"
                ? "OB numbers are waived for digitally clocked shifts."
                : "both OB numbers are required for each shift."}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={complete.length === 0}
              onClick={() => void submit()}
            >
              Confirm {complete.length} shift{complete.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      }
    >
      {failures.length > 0 && (
        <AlertBanner variant="warning" className="mb-4">
          {failures.length} shift{failures.length === 1 ? " was" : "s were"} not confirmed. The reason
          is shown against each one below.
        </AlertBanner>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-security-navy-100 text-xs font-semibold text-security-navy-600">
            <tr>
              <th className="pb-2">Date</th>
              <th className="pb-2">Guard</th>
              <th className="pb-2">Shift</th>
              <th className="w-28 pb-2">Duty ON OB</th>
              <th className="w-28 pb-2">Duty OFF OB</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-security-navy-100">
            {rows.map((row, index) => {
              const draft = draftFor(row.id);
              const failure = failureByRowId.get(row.id);
              return (
                <tr key={row.id} className={failure ? "bg-security-amber-50/60" : ""}>
                  <td className="py-2 pr-2 align-top">
                    <span className="font-medium text-security-navy-900">{row.workDate}</span>
                    <br />
                    <span className="text-xs text-security-navy-500">{row.dayOfWeek}</span>
                  </td>
                  <td className="py-2 pr-2 align-top">
                    <span className="text-security-navy-900">{row.plannedGuardName ?? "—"}</span>
                    {failure && (
                      <p className="mt-0.5 text-xs text-security-amber-800">{failure.message}</p>
                    )}
                  </td>
                  <td className="py-2 pr-2 align-top text-security-navy-600">
                    {humanizeCode(row.plannedShiftType ?? row.plannedShiftCode)}
                  </td>
                  <td className="py-2 pr-2 align-top">
                    <input
                      ref={index === 0 ? firstInputRef : undefined}
                      autoFocus={index === 0}
                      className="input-compact w-full"
                      value={draft.dutyOn}
                      onChange={(e) => setDraft(row.id, { dutyOn: e.target.value })}
                      onBlur={(e) => cascadeFrom(index, e.target.value)}
                      disabled={saving}
                      inputMode="numeric"
                      enterKeyHint="next"
                      maxLength={80}
                      autoComplete="off"
                      placeholder="Duty ON"
                      aria-label={`Duty ON OB for ${row.plannedGuardName ?? "guard"} on ${row.workDate}`}
                    />
                  </td>
                  <td className="py-2 align-top">
                    <Input
                      density="compact"
                      value={draft.dutyOff}
                      onChange={(e) => setDraft(row.id, { dutyOff: e.target.value })}
                      disabled={saving}
                      inputMode="numeric"
                      enterKeyHint="next"
                      maxLength={80}
                      autoComplete="off"
                      placeholder="Duty OFF"
                      aria-label={`Duty OFF OB for ${row.plannedGuardName ?? "guard"} on ${row.workDate}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
