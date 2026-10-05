"use client";

import { useState } from "react";
import { Badge, Button, Spinner } from "@/components/ui";
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

interface GuardRowProps {
  guard: GuardAttendanceItem;
  token: string;
  onRefresh: () => void;
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
      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
        WhatsApp
      </span>
    );
  }
  if (method === "manual") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
        Manual
      </span>
    );
  }
  return null;
}

export function ControllerGuardRow({ guard, token, onRefresh }: GuardRowProps) {
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
    setReplaceModalOpen(true);
    setLoadingGuards(true);
    try {
      const guards = await fetchAvailableGuards(token);
      // Filter out the currently assigned guard
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
          ? "border-amber-300 bg-amber-50/40 dark:border-amber-700/60 dark:bg-amber-950/20"
          : isCompleted
          ? "border-security-navy-100 bg-white opacity-85 hover:opacity-100 dark:border-security-navy-800 dark:bg-security-navy-900"
          : "border-security-navy-100 bg-white dark:border-security-navy-800 dark:bg-security-navy-900"
      }`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="pt-0.5">
          {statusBadge(guard.status)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-security-navy-950 text-sm dark:text-security-navy-50">
              {guard.guardName}
            </span>
            {guard.isReplacement && (
              <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
                🔄 Replacement {guard.originalGuardName ? `for ${guard.originalGuardName}` : ""}
              </span>
            )}
            {guard.postName && (
              <span className="text-xs text-security-navy-500 bg-security-navy-50 px-2 py-0.5 rounded dark:bg-security-navy-800">
                {guard.postName}
              </span>
            )}
            {methodBadge(guard.captureMethod)}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-security-navy-600 dark:text-security-navy-400 flex-wrap">
            <span>
              Sched: <strong>{guard.scheduledStartTime} – {guard.scheduledEndTime}</strong>
            </span>
            {guard.clockInTime && (
              <span>
                In: <strong className="text-emerald-700 dark:text-emerald-400">{guard.clockInTime}</strong>
              </span>
            )}
            {guard.clockOutTime && (
              <span>
                Out: <strong className="text-security-navy-800 dark:text-security-navy-200">{guard.clockOutTime}</strong>
              </span>
            )}
            {guard.late && (
              <span className="text-amber-700 dark:text-amber-400 font-medium">
                ({guard.minutesLate}m late)
              </span>
            )}
            {guard.hoursWorked != null && (
              <span>{guard.hoursWorked.toFixed(1)} hrs</span>
            )}
          </div>
          {guard.exceptionDescription && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
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
              className="text-red-700 hover:bg-red-50 dark:text-red-400 min-h-9 text-xs"
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
      {replaceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-security-lg border border-security-navy-200 bg-white p-6 shadow-xl dark:border-security-navy-700 dark:bg-security-navy-900">
            <div className="flex items-center justify-between border-b border-security-navy-100 pb-3 dark:border-security-navy-800">
              <div>
                <h3 className="text-base font-bold text-security-navy-950 dark:text-security-navy-50">
                  Assign Replacement Guard
                </h3>
                <p className="mt-0.5 text-xs text-security-navy-500 dark:text-security-navy-400">
                  Replacing <strong>{guard.guardName}</strong> for shift ({guard.scheduledStartTime} – {guard.scheduledEndTime})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReplaceModalOpen(false)}
                className="text-security-navy-400 hover:text-security-navy-700 text-lg leading-none p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleReplaceSubmit} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-security-navy-800 dark:text-security-navy-200">
                  Search & Select Replacement Guard <span className="text-red-500">*</span>
                </label>
                <input
                  type="search"
                  value={guardSearch}
                  onChange={(e) => setGuardSearch(e.target.value)}
                  placeholder="Filter by name or employee number..."
                  className="input-modern mt-1 w-full text-xs"
                />

                <div className="mt-2 max-h-48 overflow-y-auto rounded border border-security-navy-200 bg-security-navy-50/50 p-1 divide-y divide-security-navy-100 dark:border-security-navy-800 dark:bg-security-navy-950">
                  {loadingGuards ? (
                    <div className="p-4 text-center">
                      <Spinner className="h-5 w-5 mx-auto text-security-navy-600 mb-1" />
                      <p className="text-xs text-security-navy-500">Loading active guards...</p>
                    </div>
                  ) : filteredReplacementGuards.length === 0 ? (
                    <p className="p-4 text-center text-xs text-security-navy-500">
                      No active replacement guards found matching your search.
                    </p>
                  ) : (
                    filteredReplacementGuards.map((g) => (
                      <label
                        key={g.id}
                        className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors text-xs ${
                          selectedReplacementId === g.id
                            ? "bg-security-navy-800 text-white font-semibold"
                            : "hover:bg-white dark:hover:bg-security-navy-900 text-security-navy-800 dark:text-security-navy-200"
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
                            className={`text-[10px] px-1.5 py-0.5 rounded ${
                              selectedReplacementId === g.id
                                ? "bg-security-navy-700 text-white"
                                : "bg-security-navy-100 text-security-navy-600 dark:bg-security-navy-800 dark:text-security-navy-400"
                            }`}
                          >
                            #{g.employeeNumber}
                          </span>
                        </div>
                        {g.phone && (
                          <span className="text-[11px] opacity-80">{g.phone}</span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-security-navy-800 dark:text-security-navy-200">
                  Reason for Replacement <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={replacementReason}
                  onChange={(e) => setReplacementReason(e.target.value)}
                  placeholder="e.g. Original guard reported sick / AWOL no-show on morning roll call"
                  required
                  className="input-modern mt-1 w-full text-xs"
                />
              </div>

              {errorMsg && (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 font-medium">
                  {errorMsg}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-security-navy-100 dark:border-security-navy-800">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setReplaceModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  disabled={!selectedReplacementId || !replacementReason.trim()}
                  loading={loadingAction === "replace"}
                  className="bg-security-navy-800 text-white"
                >
                  Confirm & Assign Reliever
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Correction Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-security-lg border border-security-navy-200 bg-white p-6 shadow-xl dark:border-security-navy-700 dark:bg-security-navy-900">
            <h3 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-50">
              Adjust Guard Attendance
            </h3>
            <p className="mt-1 text-xs text-security-navy-600 dark:text-security-navy-400">
              Manual modifications are permanently recorded in the audit ledger and synchronize to payroll timesheets.
            </p>

            <form onSubmit={handleAdjustSubmit} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-security-navy-700 dark:text-security-navy-300">
                  Clock-In (HH:MM)
                </label>
                <input
                  type="time"
                  value={customIn}
                  onChange={(e) => setCustomIn(e.target.value)}
                  className="input-modern mt-1 w-full"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-security-navy-700 dark:text-security-navy-300">
                  Clock-Out (HH:MM)
                </label>
                <input
                  type="time"
                  value={customOut}
                  onChange={(e) => setCustomOut(e.target.value)}
                  className="input-modern mt-1 w-full"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-security-navy-700 dark:text-security-navy-300">
                  Reason for Adjustment <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Guard battery died, confirmed on radio by controller"
                  required
                  className="input-modern mt-1 w-full text-xs"
                />
              </div>

              {errorMsg && (
                <p className="text-xs text-red-600 font-medium">{errorMsg}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  type="submit"
                  loading={loadingAction === "adjust"}
                  className="bg-security-navy-800 text-white"
                >
                  Save & Log
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mark Absent Modal */}
      {absentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-security-lg border border-security-navy-200 bg-white p-6 shadow-xl dark:border-security-navy-700 dark:bg-security-navy-900">
            <h3 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-50">
              Mark Guard Absent
            </h3>
            <p className="mt-1 text-xs text-security-navy-600 dark:text-security-navy-400">
              Confirm absence for {guard.guardName}. This will record 0 hours and flag the shift in payroll.
            </p>

            <form onSubmit={handleMarkAbsentSubmit} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-security-navy-700 dark:text-security-navy-300">
                  Reason for Absence <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={absentReason}
                  onChange={(e) => setAbsentReason(e.target.value)}
                  placeholder="e.g. No-show, no prior notice given to control room"
                  required
                  className="input-modern mt-1 w-full text-xs"
                />
              </div>

              {errorMsg && (
                <p className="text-xs text-red-600 font-medium">{errorMsg}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAbsentModalOpen(false)}
                >
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
          </div>
        </div>
      )}
    </div>
  );
}
