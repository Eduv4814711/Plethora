"use client";

import { useState } from "react";
import { AlertBanner, Badge, Button, Field, Input, Modal, SearchInput, Spinner, Textarea } from "@/components/ui";
import {
  type GuardAttendanceItem,
  type ControllerAttendanceStatus,
  type AvailableGuardOption,
  quickClockIn,
  quickClockOut,
  markAbsent,
  adjustAttendance,
  replaceGuard,
  fetchAvailableGuards,
} from "@/lib/attendance-today-api";
import {
  getAttendanceReplacementSuggestions,
  type RankedReplacementCandidate,
} from "@/lib/roster-api";

interface GuardRowProps {
  guard: GuardAttendanceItem;
  token: string;
  onRefresh: () => void;
  onViewMap?: (lat: number, lng: number) => void;
}

function statusBadge(status: ControllerAttendanceStatus) {
  switch (status) {
    case "clocked_in":
      return <Badge variant="success">✓ Clocked In</Badge>;
    case "clocked_out":
      return <Badge variant="neutral">✓ Clocked Out</Badge>;
    case "scheduled":
      return <Badge variant="neutral">Scheduled</Badge>;
    case "late":
      return <Badge variant="warning">⚠ Late</Badge>;
    case "early_departure":
      return <Badge variant="warning">⚠ Left Early</Badge>;
    case "missing_clock_in":
      return <Badge variant="error">⚠ Missing In</Badge>;
    case "missing_clock_out":
      return <Badge variant="error">⚠ Missing Out</Badge>;
    case "absent":
      return <Badge variant="error">Absent</Badge>;
    case "requires_review":
      return <Badge variant="warning">⚠ Review</Badge>;
    case "manually_adjusted":
      return <Badge variant="neutral">Adjusted</Badge>;
    default:
      return <Badge variant="neutral">{status}</Badge>;
  }
}

function methodBadge(method: string) {
  if (method === "whatsapp") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
        WhatsApp
      </span>
    );
  }
  if (method === "manual") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
        Manual
      </span>
    );
  }
  return null;
}

export function ControllerGuardRow({ guard, token, onRefresh, onViewMap }: GuardRowProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [absentModalOpen, setAbsentModalOpen] = useState(false);
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);

  const [absentReason, setAbsentReason] = useState("");
  const [customIn, setCustomIn] = useState(guard.clockInTime || "");
  const [customOut, setCustomOut] = useState(guard.clockOutTime || "");
  const [adjustReason, setAdjustReason] = useState("");

  // Replacement modal state
  const [availableGuards, setAvailableGuards] = useState<AvailableGuardOption[]>([]);
  const [rankedCandidates, setRankedCandidates] = useState<RankedReplacementCandidate[]>([]);
  const [loadingGuards, setLoadingGuards] = useState(false);
  const [selectedReplacementId, setSelectedReplacementId] = useState("");
  const [replacementReason, setReplacementReason] = useState("");
  const [guardSearch, setGuardSearch] = useState("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleClockIn = async () => {
    try {
      setLoadingAction("in");
      setErrorMsg(null);
      await quickClockIn(token, {
        shiftId: guard.shiftId,
        reason: "Controller control-room clock-in",
      });
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to clock in");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleClockOut = async () => {
    try {
      setLoadingAction("out");
      setErrorMsg(null);
      await quickClockOut(token, {
        shiftId: guard.shiftId,
        reason: "Controller control-room clock-out",
      });
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to clock out");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleMarkAbsentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!absentReason.trim() || absentReason.trim().length < 3) {
      setErrorMsg("Reason must be at least 3 characters.");
      return;
    }
    try {
      setLoadingAction("absent");
      setErrorMsg(null);
      await markAbsent(token, {
        shiftId: guard.shiftId,
        reason: absentReason.trim(),
      });
      setAbsentModalOpen(false);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to mark absent");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guard.attendanceId) {
      setErrorMsg("No attendance record exists to adjust yet. Use Clock In first.");
      return;
    }
    if (!adjustReason.trim() || adjustReason.trim().length < 3) {
      setErrorMsg("Please provide an audit reason (at least 3 characters).");
      return;
    }

    try {
      setLoadingAction("adjust");
      setErrorMsg(null);
      await adjustAttendance(token, guard.attendanceId, {
        clockIn: customIn ? new Date(`${new Date().toISOString().slice(0, 10)}T${customIn}:00`).toISOString() : null,
        clockOut: customOut ? new Date(`${new Date().toISOString().slice(0, 10)}T${customOut}:00`).toISOString() : null,
        reason: adjustReason.trim(),
      });
      setModalOpen(false);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to adjust attendance");
    } finally {
      setLoadingAction(null);
    }
  };

  const openReplaceModal = async () => {
    setErrorMsg(null);
    setReplacementReason("");
    setSelectedReplacementId("");
    setGuardSearch("");
    setRankedCandidates([]);
    setReplaceModalOpen(true);
    setLoadingGuards(true);
    try {
      const [rankedRes, guards] = await Promise.all([
        getAttendanceReplacementSuggestions(token, guard.shiftId).catch(() => null),
        fetchAvailableGuards(token),
      ]);
      if (rankedRes?.candidates) {
        setRankedCandidates(rankedRes.candidates);
      }
      setAvailableGuards(guards.filter((g) => g.id !== guard.employeeId));
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to load active guards");
    } finally {
      setLoadingGuards(false);
    }
  };

  const handleReplaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReplacementId) {
      setErrorMsg("Please select a replacement guard.");
      return;
    }
    if (!replacementReason.trim() || replacementReason.trim().length < 3) {
      setErrorMsg("Please provide a reason for the replacement (at least 3 characters).");
      return;
    }

    try {
      setLoadingAction("replace");
      setErrorMsg(null);
      await replaceGuard(token, {
        shiftId: guard.shiftId,
        replacementEmployeeId: selectedReplacementId,
        reason: replacementReason.trim(),
      });
      setReplaceModalOpen(false);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to replace guard");
    } finally {
      setLoadingAction(null);
    }
  };

  const isClockedIn = guard.status === "clocked_in" || (guard.clockInTime && !guard.clockOutTime);
  const isCompleted = guard.status === "clocked_out" || (guard.clockInTime && guard.clockOutTime);
  const isAbsent = guard.status === "absent";

  const filteredReplacementGuards = availableGuards.filter((g) => {
    if (!guardSearch.trim()) return true;
    const term = guardSearch.toLowerCase();
    return (
      g.firstName.toLowerCase().includes(term) ||
      g.lastName.toLowerCase().includes(term) ||
      g.employeeNumber.toLowerCase().includes(term)
    );
  });

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-lg border transition-all ${
        guard.needsAction
          ? "border-amber-300 bg-amber-50/40"
          : isCompleted
          ? "border-security-navy-100 bg-white opacity-85 hover:opacity-100"
          : "border-security-navy-100 bg-white"
      }`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="pt-0.5">
          {statusBadge(guard.status)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-security-navy-950 text-sm">
              {guard.guardName}
            </span>
            {guard.isReplacement && (
              <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                🔄 Replacement {guard.originalGuardName ? `for ${guard.originalGuardName}` : ""}
              </span>
            )}
            {guard.postName && (
              <span className="text-xs text-security-navy-500 bg-security-navy-50 px-2 py-0.5 rounded">
                {guard.postName}
              </span>
            )}
            {methodBadge(guard.captureMethod)}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-security-navy-600 flex-wrap">
            <span>
              Sched: <strong>{guard.scheduledStartTime} – {guard.scheduledEndTime}</strong>
            </span>
            {guard.clockInTime && (
              <span>
                In: <strong className="text-emerald-700">{guard.clockInTime}</strong>
              </span>
            )}
            {guard.clockOutTime && (
              <span>
                Out: <strong className="text-security-navy-800">{guard.clockOutTime}</strong>
              </span>
            )}
            {guard.late && (
              <span className="text-amber-700 font-medium">
                ({guard.minutesLate}m late)
              </span>
            )}
            {guard.hoursWorked != null && (
              <span>{guard.hoursWorked.toFixed(1)} hrs</span>
            )}
            {guard.clockInLat != null && guard.clockInLng != null && (
              <button
                type="button"
                onClick={() => onViewMap?.(guard.clockInLat!, guard.clockInLng!)}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors ${
                  guard.withinGeofence
                    ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    : guard.validationStatus === "REJECTED_GEOFENCE"
                      ? "bg-red-50 text-red-700 hover:bg-red-100"
                      : "bg-security-navy-100 text-security-navy-700 hover:bg-security-navy-200"
                }`}
                title="View exact clock-in pin on map"
              >
                📍 Map{guard.distanceMeters != null ? ` (${guard.distanceMeters}m)` : ""}
              </button>
            )}
          </div>
          {guard.exceptionDescription && (
            <p className="mt-1 text-xs text-red-600">
              ⚠ {guard.exceptionDescription}
            </p>
          )}
          {errorMsg && (
            <p className="mt-1 text-xs text-red-600 font-medium">{errorMsg}</p>
          )}
        </div>
      </div>

      <div className="mt-3 sm:mt-0 flex items-center gap-2 shrink-0 self-end sm:self-center">
        {!isClockedIn && !isCompleted && !isAbsent && (
          <>
            <Button
              variant="primary"
              size="sm"
              loading={loadingAction === "in"}
              onClick={handleClockIn}
              className="bg-emerald-700 hover:bg-emerald-800 text-white min-h-9"
            >
              Clock In
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={openReplaceModal}
              className="text-security-navy-800 hover:bg-security-navy-100 min-h-9 text-xs"
            >
              🔄 Replace
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={loadingAction === "absent"}
              onClick={() => {
                setAbsentReason("");
                setErrorMsg(null);
                setAbsentModalOpen(true);
              }}
              className="text-red-700 hover:bg-red-50 min-h-9 text-xs"
            >
              Absent
            </Button>
          </>
        )}

        {isAbsent && (
          <Button
            variant="secondary"
            size="sm"
            onClick={openReplaceModal}
            className="text-security-navy-800 hover:bg-security-navy-100 min-h-9 text-xs"
          >
            🔄 Assign Replacement
          </Button>
        )}

        {isClockedIn && !isCompleted && (
          <Button
            variant="primary"
            size="sm"
            loading={loadingAction === "out"}
            onClick={handleClockOut}
            className="bg-blue-700 hover:bg-blue-800 text-white min-h-9"
          >
            Clock Out
          </Button>
        )}

        {guard.attendanceId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCustomIn(guard.clockInTime || "");
              setCustomOut(guard.clockOutTime || "");
              setAdjustReason("");
              setErrorMsg(null);
              setModalOpen(true);
            }}
            className="text-xs text-security-navy-600 hover:text-security-navy-900 min-h-9"
          >
            Adjust
          </Button>
        )}
      </div>

      {/* Replacement Guard Modal */}
      <Modal
        open={replaceModalOpen}
        onClose={() => setReplaceModalOpen(false)}
        title="Assign Replacement Guard"
        description={`Replacing ${guard.guardName} for shift (${guard.scheduledStartTime} – ${guard.scheduledEndTime})`}
        size="md"
      >
        <form onSubmit={handleReplaceSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="label-text block">
              Search &amp; Select Replacement Guard <span className="text-red-500">*</span>
            </label>
            <SearchInput
              value={guardSearch}
              onChange={setGuardSearch}
              placeholder="Filter by name or employee number..."
            />

            <div className="mt-2 max-h-56 divide-y divide-security-navy-100 overflow-y-auto rounded-security border border-security-navy-200 bg-security-navy-50/50 p-1">
              {loadingGuards ? (
                <div className="p-4 text-center">
                  <Spinner className="mx-auto mb-1 h-5 w-5 text-security-navy-600" />
                  <p className="text-xs text-security-navy-500">Ranking guards by SA overtime &amp; PSIRA…</p>
                </div>
              ) : rankedCandidates.length > 0 ? (
                rankedCandidates
                  .filter((c) => {
                    if (!guardSearch.trim()) return true;
                    const term = guardSearch.toLowerCase();
                    return `${c.fullName} ${c.employeeNumber}`.toLowerCase().includes(term);
                  })
                  .map((c) => (
                    <label
                      key={c.employeeId}
                      className={`flex flex-col gap-1 rounded p-2.5 text-xs transition-colors ${
                        !c.eligible
                          ? "cursor-not-allowed opacity-45"
                          : selectedReplacementId === c.employeeId
                            ? "cursor-pointer bg-security-navy-800 font-semibold text-white"
                            : "cursor-pointer text-security-navy-800 hover:bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="replacementGuard"
                            value={c.employeeId}
                            disabled={!c.eligible}
                            checked={selectedReplacementId === c.employeeId}
                            onChange={() => setSelectedReplacementId(c.employeeId)}
                            className="sr-only"
                          />
                          <span>{c.fullName}</span>
                          <span className="text-[10px] opacity-75">#{c.employeeNumber}</span>
                        </div>
                        <span className="text-[10px] tabular-nums opacity-85">
                          {c.weekHoursBefore}h → {c.weekHoursAfter}h
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {c.eligible ? (
                          c.badges.map((b) => (
                            <span
                              key={b}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                selectedReplacementId === c.employeeId
                                  ? "bg-white/20 text-white"
                                  : b === "Zero OT"
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
                          <span className="text-[10px] text-red-600">{c.ineligibleReason}</span>
                        )}
                      </div>
                    </label>
                  ))
              ) : filteredReplacementGuards.length === 0 ? (
                <p className="p-4 text-center text-xs text-security-navy-500">
                  No active replacement guards found matching your search.
                </p>
              ) : (
                filteredReplacementGuards.map((g) => (
                  <label
                    key={g.id}
                    className={`flex cursor-pointer items-center justify-between rounded p-2 text-xs transition-colors ${
                      selectedReplacementId === g.id
                        ? "bg-security-navy-800 font-semibold text-white"
                        : "text-security-navy-800 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="replacementGuard"
                        value={g.id}
                        checked={selectedReplacementId === g.id}
                        onChange={() => setSelectedReplacementId(g.id)}
                        className="sr-only"
                      />
                      <span>
                        {g.firstName} {g.lastName}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          selectedReplacementId === g.id
                            ? "bg-security-navy-700 text-white"
                            : "bg-security-navy-100 text-security-navy-600"
                        }`}
                      >
                        #{g.employeeNumber}
                      </span>
                    </div>
                    {g.phone && <span className="text-[11px] opacity-80">{g.phone}</span>}
                  </label>
                ))
              )}
            </div>
          </div>

          <Field label="Reason for Replacement *">
            <Textarea
              rows={2}
              density="compact"
              value={replacementReason}
              onChange={(e) => setReplacementReason(e.target.value)}
              placeholder="e.g. Original guard reported sick / AWOL no-show on morning roll call"
              required
            />
          </Field>

          {errorMsg && <AlertBanner variant="error">{errorMsg}</AlertBanner>}

          <div className="flex justify-end gap-2 border-t border-security-navy-100 pt-3">
            <Button variant="ghost" size="sm" onClick={() => setReplaceModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={!selectedReplacementId || !replacementReason.trim()}
              loading={loadingAction === "replace"}
            >
              Confirm &amp; Assign Reliever
            </Button>
          </div>
        </form>
      </Modal>

      {/* Manual Correction Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Adjust Guard Attendance"
        description="Manual modifications are permanently recorded in the audit ledger and synchronize to payroll timesheets."
        size="sm"
      >
        <form onSubmit={handleAdjustSubmit} className="space-y-3">
          <Field label="Clock-In (HH:MM)">
            <Input
              type="time"
              value={customIn}
              onChange={(e) => setCustomIn(e.target.value)}
            />
          </Field>

          <Field label="Clock-Out (HH:MM)">
            <Input
              type="time"
              value={customOut}
              onChange={(e) => setCustomOut(e.target.value)}
            />
          </Field>

          <Field label="Reason for Adjustment *">
            <Textarea
              rows={2}
              density="compact"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="e.g. Guard battery died, confirmed on radio by controller"
              required
            />
          </Field>

          {errorMsg && <AlertBanner variant="error">{errorMsg}</AlertBanner>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              loading={loadingAction === "adjust"}
            >
              Save &amp; Log
            </Button>
          </div>
        </form>
      </Modal>

      {/* Mark Absent Modal */}
      <Modal
        open={absentModalOpen}
        onClose={() => setAbsentModalOpen(false)}
        title="Mark Guard Absent"
        description={`Confirm absence for ${guard.guardName}. This will record 0 hours and flag the shift in payroll.`}
        size="sm"
      >
        <form onSubmit={handleMarkAbsentSubmit} className="space-y-3">
          <Field label="Reason for Absence *">
            <Textarea
              rows={2}
              density="compact"
              value={absentReason}
              onChange={(e) => setAbsentReason(e.target.value)}
              placeholder="e.g. No-show, no prior notice given to control room"
              required
            />
          </Field>

          {errorMsg && <AlertBanner variant="error">{errorMsg}</AlertBanner>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setAbsentModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              type="submit"
              loading={loadingAction === "absent"}
            >
              Confirm Absent
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
