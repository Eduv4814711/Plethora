"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  applyManualOverride,
  fetchLiveRoster,
  type RosterPeriodGrid,
  type RosterShiftCode,
} from "@/lib/roster-api";
import { AlertBanner, Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";

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

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={`Change one day at ${siteName}`}
      description="One-day exception · This will not change the normal repeating schedule."
      size="lg"
      closeOnBackdrop={!saving}
      footer={
        !reviewing ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setReviewing(true)} disabled={!canReview}>
              Review change
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setReviewing(false)} disabled={saving}>
              Back
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={saving}>
              Confirm and publish
            </Button>
          </>
        )
      }
    >
      {error && <AlertBanner variant="error" className="mb-4">{error}</AlertBanner>}

      {!reviewing ? (
        <div className="space-y-4">
          <Field label="1. Date">
            <Input type="date" value={rosterDate} onChange={(event) => setRosterDate(event.target.value)} />
          </Field>

          <Field label="2. Guard">
            <Select
              value={guardId}
              onChange={(event) => {
                const nextId = event.target.value;
                setGuardId(nextId);
                const row = grid?.rows.find((item) => item.guardId === nextId);
                const current = row?.cells.find((cell) => cell.dateKey === rosterDate)?.shiftCode;
                setShiftCode(current === "N" ? "D" : "N");
              }}
              disabled={loading || !grid}
            >
              <option value="">{loading ? "Loading roster…" : "Select guard…"}</option>
              {grid?.rows.filter((row) => !row.isPlaceholder).map((row) => (
                <option key={row.guardId} value={row.guardId}>{row.guardName}</option>
              ))}
            </Select>
          </Field>

          {selectedRow && currentCell && (
            <div className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 p-4">
              <p className="text-xs text-security-navy-500">Current assignment</p>
              <p className="mt-1 font-semibold text-security-navy-900">{ALL_SHIFT_LABELS[currentCell.shiftCode]}</p>
              {leaveProtected && (
                <AlertBanner variant="info" className="mt-3">
                  Approved leave is protected and cannot be changed here.{" "}
                  <Link href="/employees/leave" className="font-semibold underline">Open Leave</Link>.
                </AlertBanner>
              )}
            </div>
          )}

          {selectedRow && !leaveProtected && (
            <fieldset>
              <legend className="label-text">3. New assignment</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {EDITABLE_SHIFTS.map((option) => (
                  <label
                    key={option.code}
                    className={`cursor-pointer rounded-security-lg border p-3 transition-colors ${
                      shiftCode === option.code
                        ? "border-security-amber-400 bg-security-amber-50 ring-2 ring-security-amber-100"
                        : "border-security-navy-100 hover:border-security-navy-200"
                    }`}
                  >
                    <input
                      type="radio"
                      name="one-day-shift"
                      value={option.code}
                      checked={shiftCode === option.code}
                      onChange={() => setShiftCode(option.code)}
                      className="sr-only"
                    />
                    <span className="block text-sm font-semibold text-security-navy-900">{option.label}</span>
                    <span className="mt-1 block text-xs text-security-navy-500">{option.help}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {selectedRow && !leaveProtected && (
            <Field label="4. Reason" helperText="Required for the roster audit history.">
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                placeholder="Explain why this date is changing"
              />
            </Field>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 p-4">
            <h2 className="font-semibold text-security-navy-900">Confirm this one-day change</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-security-navy-500">Date</dt>
                <dd className="font-medium text-security-navy-900">
                  {new Date(`${rosterDate}T00:00:00Z`).toLocaleDateString("en-ZA", { dateStyle: "long", timeZone: "UTC" })}
                </dd>
              </div>
              <div>
                <dt className="text-security-navy-500">Guard</dt>
                <dd className="font-medium text-security-navy-900">{selectedRow?.guardName}</dd>
              </div>
              <div>
                <dt className="text-security-navy-500">From</dt>
                <dd className="font-medium text-security-navy-900">
                  {currentCell ? ALL_SHIFT_LABELS[currentCell.shiftCode] : "Unassigned"}
                </dd>
              </div>
              <div>
                <dt className="text-security-navy-500">To</dt>
                <dd className="font-medium text-security-navy-900">{ALL_SHIFT_LABELS[shiftCode]}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-security-navy-500">Reason</dt>
                <dd className="font-medium text-security-navy-900">{reason.trim()}</dd>
              </div>
            </dl>
          </div>
          <AlertBanner variant="info">
            The change will be applied and published immediately. Future dates continue using the normal schedule.
          </AlertBanner>
        </div>
      )}
    </Modal>
  );
}
