"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  applyManualOverride,
  fetchLiveRoster,
  type RosterPeriodGrid,
  type RosterShiftCode,
} from "@/lib/roster-api";

const EDITABLE_SHIFTS: Array<{ code: RosterShiftCode; label: string; help: string }> = [
  { code: "D", label: "Day shift", help: "Schedule this guard for the site day shift." },
  { code: "N", label: "Night shift", help: "Schedule this guard for the site night shift." },
  { code: "O", label: "Off", help: "The guard will not work at this site on this date." },
  { code: "TR", label: "Training", help: "The guard is attending training instead of this shift." },
  { code: "blank", label: "Unassigned", help: "Leave this guard without a roster assignment for the date." },
];

const ALL_SHIFT_LABELS: Record<RosterShiftCode, string> = {
  D: "Day shift", N: "Night shift", O: "Off", L: "Approved leave", SL: "Sick leave",
  TR: "Training", SB: "Standby", AWOL: "Absent", R: "Replacement", blank: "Unassigned",
};

export function OneDayChangeModal({
  open,
  siteId,
  siteName,
  onClose,
  onSaved,
}: {
  open: boolean;
  siteId: string;
  siteName: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { token } = useAuth();
  const [rosterDate, setRosterDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [grid, setGrid] = useState<RosterPeriodGrid | null>(null);
  const [guardId, setGuardId] = useState("");
  const [shiftCode, setShiftCode] = useState<RosterShiftCode>("D");
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);

  useEffect(() => { savingRef.current = saving; }, [saving]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    window.setTimeout(() => headingRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !token || !rosterDate) return;
    let active = true;
    setLoading(true); setError(null); setGrid(null); setGuardId(""); setReviewing(false);
    fetchLiveRoster(token, siteId, rosterDate, rosterDate, true)
      .then((next) => { if (active) setGrid(next); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load this date."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, rosterDate, siteId, token]);

  const selectedRow = useMemo(() => grid?.rows.find((row) => row.guardId === guardId) ?? null, [grid?.rows, guardId]);
  const currentCell = selectedRow?.cells.find((cell) => cell.dateKey === rosterDate);
  const leaveProtected = currentCell?.shiftCode === "L" || currentCell?.shiftCode === "SL" || currentCell?.source === "leave";
  const canReview = Boolean(guardId && reason.trim() && currentCell && currentCell.shiftCode !== shiftCode && !leaveProtected);

  const save = async () => {
    if (!token || !selectedRow || !canReview) return;
    setSaving(true); setError(null);
    try {
      await applyManualOverride(token, {
        siteId,
        guardId: selectedRow.guardId,
        rosterDate,
        overrideShiftCode: shiftCode,
        reason: reason.trim(),
        doesChangeBasePattern: false,
      });
      await onSaved();
      setReason(""); setReviewing(false); onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply the one-day change.");
    } finally { setSaving(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-security-navy-900/50 sm:items-center sm:p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="one-day-title" className="max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-security-navy-900 sm:max-w-xl sm:rounded-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-wider text-security-amber-700 dark:text-security-amber-300">One-day exception</p><h2 ref={headingRef} tabIndex={-1} id="one-day-title" className="mt-1 text-xl font-semibold text-security-navy-900 outline-none dark:text-white">Change one day at {siteName}</h2><p className="mt-1 text-sm text-security-navy-500">This will not change the normal repeating schedule.</p></div>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary px-3 py-1.5">Close</button>
        </div>

        {error && <div role="alert" className="mt-4 rounded-security-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">{error}</div>}

        {!reviewing ? <div className="mt-5 space-y-4">
          <label className="block"><span className="text-sm font-semibold text-security-navy-900 dark:text-security-navy-200">1. Date</span><input type="date" value={rosterDate} onChange={(event) => setRosterDate(event.target.value)} className="input-modern mt-2 w-full" /></label>
          <label className="block"><span className="text-sm font-semibold text-security-navy-900 dark:text-security-navy-200">2. Guard</span><select value={guardId} onChange={(event) => { const nextId = event.target.value; setGuardId(nextId); const row = grid?.rows.find((item) => item.guardId === nextId); const current = row?.cells.find((cell) => cell.dateKey === rosterDate)?.shiftCode; setShiftCode(current === "N" ? "D" : "N"); }} disabled={loading || !grid} className="input-modern mt-2 w-full"><option value="">{loading ? "Loading roster…" : "Select guard…"}</option>{grid?.rows.filter((row) => !row.isPlaceholder).map((row) => <option key={row.guardId} value={row.guardId}>{row.guardName}</option>)}</select></label>

          {selectedRow && currentCell && <div className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 p-4 dark:border-security-navy-700 dark:bg-security-navy-800/50"><p className="text-xs text-security-navy-500">Current assignment</p><p className="mt-1 font-semibold text-security-navy-900 dark:text-white">{ALL_SHIFT_LABELS[currentCell.shiftCode]}</p>{leaveProtected && <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">Approved leave is protected and cannot be changed here. <Link href="/employees/leave" className="font-semibold underline">Open Leave</Link>.</div>}</div>}

          {selectedRow && !leaveProtected && <fieldset><legend className="text-sm font-semibold text-security-navy-900 dark:text-security-navy-200">3. New assignment</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{EDITABLE_SHIFTS.map((option) => <label key={option.code} className={`cursor-pointer rounded-security-lg border p-3 ${shiftCode === option.code ? "border-security-amber-400 bg-security-amber-50 ring-2 ring-security-amber-100 dark:border-security-amber-700 dark:bg-security-amber-950/30 dark:ring-security-amber-900/40" : "border-security-navy-100 dark:border-security-navy-700"}`}><input type="radio" name="one-day-shift" value={option.code} checked={shiftCode === option.code} onChange={() => setShiftCode(option.code)} className="sr-only" /><span className="block text-sm font-semibold text-security-navy-900 dark:text-white">{option.label}</span><span className="mt-1 block text-xs text-security-navy-500">{option.help}</span></label>)}</div></fieldset>}

          {selectedRow && !leaveProtected && <label className="block"><span className="text-sm font-semibold text-security-navy-900 dark:text-security-navy-200">4. Reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Explain why this date is changing" className="input-modern mt-2 w-full" /><span className="mt-1 block text-xs text-security-navy-500">Required for the roster audit history.</span></label>}
          <div className="flex flex-col-reverse gap-2 border-t border-security-navy-100 pt-4 dark:border-security-navy-700 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="btn-secondary">Cancel</button><button type="button" onClick={() => setReviewing(true)} disabled={!canReview} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">Review change</button></div>
        </div> : <div className="mt-5 space-y-4"><div className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 p-4 dark:border-security-navy-700 dark:bg-security-navy-800/50"><h3 className="font-semibold text-security-navy-900 dark:text-white">Confirm this one-day change</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-security-navy-500">Date</dt><dd className="font-medium">{new Date(`${rosterDate}T00:00:00Z`).toLocaleDateString("en-ZA", { dateStyle: "long", timeZone: "UTC" })}</dd></div><div><dt className="text-security-navy-500">Guard</dt><dd className="font-medium">{selectedRow?.guardName}</dd></div><div><dt className="text-security-navy-500">From</dt><dd className="font-medium">{currentCell ? ALL_SHIFT_LABELS[currentCell.shiftCode] : "Unassigned"}</dd></div><div><dt className="text-security-navy-500">To</dt><dd className="font-medium">{ALL_SHIFT_LABELS[shiftCode]}</dd></div><div className="sm:col-span-2"><dt className="text-security-navy-500">Reason</dt><dd className="font-medium">{reason.trim()}</dd></div></dl></div><p className="rounded-security-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">The change will be applied and published immediately. Future dates continue using the normal schedule.</p><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setReviewing(false)} disabled={saving} className="btn-secondary">Back</button><button type="button" onClick={() => void save()} disabled={saving} className="btn-primary">{saving ? "Applying…" : "Confirm and publish"}</button></div></div>}
      </div>
    </div>
  );
}
