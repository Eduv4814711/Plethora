"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BulkConfirmResult, SiteTimesheetRow } from "@/lib/roster-api";
import { suggestNextObNumber } from "@/lib/site-timesheet-utils";
import { humanizeCode } from "@/lib/site-timesheet-row-patch";

type Draft = { dutyOn: string; dutyOff: string };

/**
 * Confirm a whole day (or a whole sheet) of routine shifts in one pass.
 *
 * OB numbers stay mandatory per shift — they are the occurrence book audit trail — so the
 * modal collects them in a single grid instead of asking the controller to walk each row
 * card. Duty ON numbers auto-advance from the row above, which is how the book is written.
 */
export function SiteTimesheetBulkConfirmModal({
  rows,
  saving,
  onCancel,
  onSubmit,
}: {
  rows: SiteTimesheetRow[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (
    entries: Array<{ rowId: string; dutyOnObNumber: string; dutyOffObNumber: string }>
  ) => Promise<BulkConfirmResult | null>;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [failures, setFailures] = useState<BulkConfirmResult["failed"]>([]);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Rows drop out of `rows` as they are confirmed, so failures are all that remain of a
  // partial submission.
  const failureByRowId = useMemo(
    () => new Map(failures.map((failure) => [failure.rowId, failure])),
    [failures]
  );

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  const draftFor = (rowId: string): Draft => drafts[rowId] ?? { dutyOn: "", dutyOff: "" };

  const setDraft = (rowId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [rowId]: { ...draftFor(rowId), ...patch } }));
  };

  /**
   * Fill this row's Duty ON and every empty Duty ON below it by continuing the sequence.
   * Runs on blur so a controller types one number and the rest of the page follows.
   */
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
    const draft = draftFor(row.id);
    return draft.dutyOn.trim() && draft.dutyOff.trim();
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
    // Everything went through — nothing left to show.
    if (result.failed.length === 0) onCancel();
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center overflow-y-auto bg-slate-900/45 p-4"
      role="presentation"
    >
      <div
        className="my-auto flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-confirm-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4 dark:border-neutral-700">
          <div>
            <h2
              id="bulk-confirm-title"
              className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
            >
              Confirm {rows.length} shift{rows.length === 1 ? "" : "s"} as scheduled
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              These shifts match the roster. Enter the occurrence book numbers and confirm them
              all at once. Anything that differs from the roster is not listed here — confirm
              those individually.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary min-h-11 shrink-0"
            aria-label="Close bulk confirmation dialog"
          >
            Close
          </button>
        </div>

        {failures.length > 0 && (
          <div
            className="mx-4 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            role="alert"
          >
            {failures.length} shift{failures.length === 1 ? " was" : "s were"} not confirmed. The
            reason is shown against each one below.
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="pb-2">Date</th>
                <th className="pb-2">Guard</th>
                <th className="pb-2">Shift</th>
                <th className="pb-2 w-28">Duty ON OB</th>
                <th className="pb-2 w-28">Duty OFF OB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {rows.map((row, index) => {
                const draft = draftFor(row.id);
                const failure = failureByRowId.get(row.id);
                return (
                  <tr key={row.id} className={failure ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}>
                    <td className="py-2 pr-2 align-top">
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                        {row.workDate}
                      </span>
                      <br />
                      <span className="text-xs text-neutral-500">{row.dayOfWeek}</span>
                    </td>
                    <td className="py-2 pr-2 align-top">
                      <span className="text-neutral-800 dark:text-neutral-200">
                        {row.plannedGuardName ?? "—"}
                      </span>
                      {failure && (
                        <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
                          {failure.message}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-2 align-top text-neutral-600 dark:text-neutral-400">
                      {humanizeCode(row.plannedShiftType ?? row.plannedShiftCode)}
                    </td>
                    <td className="py-2 pr-2 align-top">
                      <input
                        ref={index === 0 ? firstInputRef : undefined}
                        value={draft.dutyOn}
                        onChange={(e) => setDraft(row.id, { dutyOn: e.target.value })}
                        onBlur={(e) => cascadeFrom(index, e.target.value)}
                        disabled={saving}
                        inputMode="numeric"
                        enterKeyHint="next"
                        maxLength={80}
                        autoComplete="off"
                        className="input-modern w-full"
                        placeholder="Duty ON"
                        aria-label={`Duty ON OB for ${row.plannedGuardName ?? "guard"} on ${row.workDate}`}
                      />
                    </td>
                    <td className="py-2 align-top">
                      <input
                        value={draft.dutyOff}
                        onChange={(e) => setDraft(row.id, { dutyOff: e.target.value })}
                        disabled={saving}
                        inputMode="numeric"
                        enterKeyHint="next"
                        maxLength={80}
                        autoComplete="off"
                        className="input-modern w-full"
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

        <div className="flex flex-col gap-3 border-t border-neutral-200 p-4 dark:border-neutral-700 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-neutral-600 dark:text-neutral-400" aria-live="polite">
            {complete.length} of {rows.length} ready — both OB numbers are required for each shift.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="btn-secondary min-h-11">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || complete.length === 0}
              className="btn-primary min-h-11 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Confirming…" : `Confirm ${complete.length} shift${complete.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
