import { defaultShiftTime, displayShiftTime } from "@/lib/shift-times";
import type { SiteTimesheetRow } from "@/lib/roster-api";
import { normalizeShiftType, resolveAttendanceStatusOnApprove } from "@/lib/site-timesheet-utils";

/**
 * Row patch helpers for the site timesheet capture screen. Extracted from
 * SiteTimesheetsSection so they can be unit tested and shared with the table and card
 * views.
 *
 * The server holds the authoritative copy of this derivation in
 * apps/api/src/modules/rosters/site-timesheet-derive.ts — that is what bulk confirmation
 * uses. Keep the two in step; the API parity test pins the shared cases.
 */

export function humanizeCode(value: string | null | undefined): string {
  return value ? value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "Not set";
}

export function rowShiftType(row: SiteTimesheetRow): "day" | "night" | null {
  return normalizeShiftType(
    row.actualShiftType ?? row.plannedShiftType ?? row.actualShiftCode ?? row.plannedShiftCode
  );
}

/** Combine a work date (yyyy-MM-dd) with an HH:mm time into a local-time ISO string. */
export function combineDateTime(workDate: string, time: string): string | null {
  if (!time) return null;
  const d = new Date(`${workDate}T${time}:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function combineClockOut(
  workDate: string,
  time: string,
  clockIn: string | null
): string | null {
  const out = combineDateTime(workDate, time);
  if (!out || !clockIn) return out;
  if (new Date(out).getTime() <= new Date(clockIn).getTime()) {
    const next = new Date(`${workDate}T00:00:00`);
    next.setDate(next.getDate() + 1);
    const nextDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    return combineDateTime(nextDate, time);
  }
  return out;
}

export function hoursBetween(clockIn: string | null, clockOut: string | null): number | null {
  if (!clockIn || !clockOut) return null;
  const start = new Date(clockIn).getTime();
  let end = new Date(clockOut).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  // Night shifts: an end at/earlier than the start rolls over to the next day.
  if (end <= start) end += 24 * 60 * 60 * 1000;
  return Math.round(((end - start) / (1000 * 60 * 60)) * 100) / 100;
}

export function shiftTypeTimesPatch(
  workDate: string,
  shiftType: "day" | "night" | null
): { clockIn: string | null; clockOut: string | null; hoursWorked: number | null } {
  if (!shiftType) return { clockIn: null, clockOut: null, hoursWorked: null };
  const clockIn = combineDateTime(workDate, defaultShiftTime(shiftType, "start"));
  const clockOut = combineClockOut(workDate, defaultShiftTime(shiftType, "end"), clockIn);
  return { clockIn, clockOut, hoursWorked: hoursBetween(clockIn, clockOut) };
}

export function buildRowApprovalPatch(
  row: SiteTimesheetRow,
  dutyOnObNumber: string,
  dutyOffObNumber: string
): Partial<SiteTimesheetRow> {
  const plannedShiftType = normalizeShiftType(row.plannedShiftType ?? row.plannedShiftCode);
  const explicitNotWorked =
    row.actualGuardId === null &&
    (row.actualShiftType === null || row.actualShiftType === "") &&
    !row.clockIn &&
    !row.clockOut;

  // If the controller cleared who worked / shift, keep that and mark absent.
  // Otherwise default missing fields from the rostered plan when approving.
  const actualGuardId = explicitNotWorked ? null : (row.actualGuardId ?? row.plannedGuardId);
  const shiftType = explicitNotWorked
    ? null
    : normalizeShiftType(row.actualShiftType ?? row.actualShiftCode) ?? plannedShiftType;
  const actualShiftType = explicitNotWorked ? null : (row.actualShiftType ?? shiftType);
  const actualShiftCode = explicitNotWorked
    ? null
    : (row.actualShiftCode ?? (shiftType === "night" ? "N" : shiftType === "day" ? "D" : null));

  const startTime = displayShiftTime(row.clockIn, shiftType, "start");
  const endTime = displayShiftTime(row.clockOut, shiftType, "end");
  const clockIn = explicitNotWorked
    ? null
    : (row.clockIn ?? (startTime ? combineDateTime(row.workDate, startTime) : null));
  const clockOut = explicitNotWorked
    ? null
    : (row.clockOut ?? (endTime ? combineClockOut(row.workDate, endTime, clockIn) : null));

  return {
    actualGuardId,
    clockIn,
    clockOut,
    hoursWorked: explicitNotWorked ? null : (row.hoursWorked ?? hoursBetween(clockIn, clockOut)),
    attendanceStatus: resolveAttendanceStatusOnApprove({
      plannedGuardId: row.plannedGuardId,
      actualGuardId,
      plannedShiftCode: row.plannedShiftCode,
      actualShiftCode,
      actualShiftType,
      clockIn,
      clockOut,
    }),
    actualShiftType,
    actualShiftCode,
    dutyOnObNumber,
    dutyOffObNumber,
    occurrenceBookNumber: dutyOnObNumber,
  };
}

/**
 * Rows that can be confirmed in bulk as "worked exactly as scheduled".
 *
 * This mirrors the server's eligibility rules so the button count matches what the API
 * will accept, but the server recomputes everything — a stale page can never widen the
 * set. Date-level coverage shortfalls are ignored here for the same reason as the API:
 * one absent colleague must not block everyone who did turn up.
 */
export function isBulkConfirmable(row: SiteTimesheetRow): boolean {
  if (row.approvalStatus === "reviewed" || row.approvalStatus === "approved") return false;
  if (!row.plannedGuardId) return false;
  if (row.actualGuardId && row.actualGuardId !== row.plannedGuardId) return false;
  if (!normalizeShiftType(row.plannedShiftType ?? row.plannedShiftCode)) return false;
  return row.discrepancyCodes.every(
    (code) => code === "DAY_COVERAGE_SHORT" || code === "NIGHT_COVERAGE_SHORT"
  );
}
