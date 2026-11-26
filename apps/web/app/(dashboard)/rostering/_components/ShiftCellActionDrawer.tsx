"use client";

import { useEffect, useRef, useState } from "react";
import {
  getSmartReplacements,
  quickEditRosterCell,
  type RankedReplacementCandidate,
} from "@/lib/roster-api";

export interface ShiftCellTarget {
  guardId: string;
  guardName: string;
  employeeNumber: string;
  dateKey: string;
  currentCode: string;
  currentShiftType: "day" | "night" | "off";
}

export interface ShiftCellActionDrawerProps {
  open: boolean;
  onClose: () => void;
  token: string;
  siteId: string;
  cell: ShiftCellTarget | null;
  onSaved: () => void;
}

export function ShiftCellActionDrawer({
  open,
  onClose,
  token,
  siteId,
  cell,
  onSaved,
}: ShiftCellActionDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [shiftMode, setShiftMode] = useState<"D" | "N" | "O">("D");
  const [swapWithReliever, setSwapWithReliever] = useState(false);
  const [selectedReplacementId, setSelectedReplacementId] = useState("");
  const [reason, setReason] = useState("");
  const [candidates, setCandidates] = useState<RankedReplacementCandidate[]>([]);
  const [loadingRelievers, setLoadingRelievers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    if (!open || !cell) return;
    const initCode: "D" | "N" | "O" =
      cell.currentCode === "N" ? "N" : cell.currentCode === "D" ? "D" : "O";
    setShiftMode(initCode);
    setSwapWithReliever(false);
    setSelectedReplacementId("");
    setReason("");
    setError(null);
    setWarnings([]);
  }, [open, cell]);

  useEffect(() => {
    if (!open || !cell || !swapWithReliever || !token) return;
    setLoadingRelievers(true);
    const targetShiftType = shiftMode === "N" ? "night" : "day";
    getSmartReplacements(token, siteId, {
      workDate: cell.dateKey,
      shiftType: targetShiftType,
      excludeEmployeeId: cell.guardId,
    })
      .then((res) => setCandidates(res.candidates))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load relievers"))
      .finally(() => setLoadingRelievers(false));
  }, [open, cell, swapWithReliever, shiftMode, siteId, token]);

  const handleSave = async (overrideCode?: "D" | "N" | "O") => {
    if (!cell) return;
    const finalCode = overrideCode ?? shiftMode;
    if (swapWithReliever && finalCode !== "O" && !selectedReplacementId) {
      setError("Pick a replacement guard from the list first.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await quickEditRosterCell(token, siteId, {
        rosterDate: cell.dateKey,
        guardId: cell.guardId,
        replacementGuardId: swapWithReliever && finalCode !== "O" ? selectedReplacementId : undefined,
        shiftCode: swapWithReliever && finalCode !== "O" ? finalCode : finalCode,
        reason: reason.trim() || undefined,
        syncPublishedShift: true,
      });
      if (res.warnings?.length) setWarnings(res.warnings);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update shift");
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-auto w-full max-w-lg rounded-2xl border border-security-navy-200 bg-white p-0 text-security-navy-900 shadow-2xl"
    >
      {cell && (
        <>
          <div className="flex items-center justify-between border-b border-security-navy-200 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">
                {cell.guardName} · {cell.dateKey}
              </h2>
              <p className="text-xs text-security-navy-500">
                ID {cell.employeeNumber} · Current: {cell.currentCode || "Off"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-xs text-security-navy-500 hover:bg-security-navy-100 min-h-[38px]"
            >
              Close
            </button>
          </div>

          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                {error}
              </div>
            )}
            {warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {warnings.join(" ")}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-security-navy-500 mb-2">
                Quick 1-Click Shift Assignment
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { code: "D", label: "Day Shift", cls: "border-amber-300 bg-amber-50 text-amber-950" },
                    { code: "N", label: "Night Shift", cls: "border-indigo-300 bg-indigo-50 text-indigo-950" },
                    { code: "O", label: "Off / Clear", cls: "border-security-navy-200 bg-security-navy-50 text-security-navy-700" },
                  ] as const
                ).map((opt) => {
                  const active = shiftMode === opt.code;
                  return (
                    <button
                      key={opt.code}
                      type="button"
                      onClick={() => setShiftMode(opt.code)}
                      className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition-all min-h-[44px] ${
                        active
                          ? "ring-2 ring-[var(--accent-primary)] " + opt.cls
                          : "border-security-navy-200 hover:bg-security-navy-50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {shiftMode !== "O" && (
              <div className="rounded-xl border border-security-navy-200 p-3.5 space-y-3">
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={swapWithReliever}
                    onChange={(e) => setSwapWithReliever(e.target.checked)}
                    className="rounded border-security-navy-300"
                  />
                  Swap this shift to a Recommended Reliever (checks OT &amp; PSIRA)
                </label>

                {swapWithReliever && (
                  <div className="space-y-2">
                    {loadingRelievers ? (
                      <p className="text-xs text-security-navy-500 py-2">
                        Ranking available guards by 48h/week overtime &amp; PSIRA credentials…
                      </p>
                    ) : candidates.length === 0 ? (
                      <p className="text-xs text-security-navy-500 py-2">No other guards found.</p>
                    ) : (
                      <div className="max-h-52 overflow-y-auto space-y-1.5">
                        {candidates.map((c) => {
                          const picked = selectedReplacementId === c.employeeId;
                          return (
                            <button
                              key={c.employeeId}
                              type="button"
                              disabled={!c.eligible}
                              onClick={() => setSelectedReplacementId(c.employeeId)}
                              className={`w-full text-left rounded-lg border p-2.5 text-xs transition-colors min-h-[44px] ${
                                !c.eligible
                                  ? "opacity-50 cursor-not-allowed border-security-navy-200 bg-security-navy-50"
                                  : picked
                                    ? "border-[var(--accent-primary)] bg-amber-50/70"
                                    : "border-security-navy-200 hover:border-security-navy-400"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold">
                                  {c.fullName}{" "}
                                  <span className="font-normal text-security-navy-500">
                                    ({c.employeeNumber})
                                  </span>
                                </span>
                                <span className="text-[11px] font-medium text-security-navy-500">
                                  {c.weekHoursBefore}h → {c.weekHoursAfter}h/wk
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {c.eligible ? (
                                  c.badges.map((b) => (
                                    <span
                                      key={b}
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                        b === "Zero OT"
                                          ? "bg-emerald-100 text-emerald-900"
                                          : b.startsWith("+")
                                            ? "bg-amber-100 text-amber-900"
                                            : "bg-security-navy-100 text-security-navy-700"
                                      }`}
                                    >
                                      {b}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[11px] text-red-600">
                                    Unavailable: {c.ineligibleReason}
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1">Optional Note</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Guard requested swap / Annual leave cover"
                className="input-modern w-full text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-security-navy-200 px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-security-navy-300 px-4 py-2 text-xs font-semibold min-h-[40px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={saving}
              className="btn-primary text-xs min-h-[40px]"
            >
              {saving ? "Saving…" : swapWithReliever && shiftMode !== "O" ? "Swap & Update Shift" : "Save Change"}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
