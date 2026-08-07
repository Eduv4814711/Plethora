import type { StaffAttendanceRow } from "./staff-attendance-api";

/** Fallback office day when an employee has no parseable ordinary hours recorded. */
export const DEFAULT_OFFICE_START = "08:00";
export const DEFAULT_OFFICE_END = "17:00";

export function formatStaffName(row: Pick<StaffAttendanceRow, "firstName" | "lastName">): string {
  return `${row.firstName} ${row.lastName}`.trim();
}

/**
 * Default start/end times for a "Present" tap.
 *
 * `Employee.ordinaryHours` is free text ("45 hours/week", "08:00-16:30"), so only an
 * explicit time range is trusted; anything else falls back to a standard office day. The
 * controller can always adjust the times afterwards.
 */
export function defaultOfficeTimes(
  ordinaryHours: string | null | undefined
): { timeIn: string; timeOut: string } {
  const match = (ordinaryHours ?? "").match(/(\d{1,2}):(\d{2})\s*(?:-|–|to)\s*(\d{1,2}):(\d{2})/);
  if (!match) return { timeIn: DEFAULT_OFFICE_START, timeOut: DEFAULT_OFFICE_END };

  const [, startHour, startMinute, endHour, endMinute] = match;
  const timeIn = `${startHour.padStart(2, "0")}:${startMinute}`;
  const timeOut = `${endHour.padStart(2, "0")}:${endMinute}`;
  if (Number(startHour) > 23 || Number(endHour) > 23) {
    return { timeIn: DEFAULT_OFFICE_START, timeOut: DEFAULT_OFFICE_END };
  }
  // A range that does not move forward is not a working day.
  if (timeOut <= timeIn) return { timeIn: DEFAULT_OFFICE_START, timeOut: DEFAULT_OFFICE_END };
  return { timeIn, timeOut };
}

export type RollCallState = "present" | "absent" | "leave" | "other" | "not_captured";

/** How one person's line should render: what has been captured, and whether it is locked. */
export function rollCallState(row: StaffAttendanceRow): RollCallState {
  // Approved leave wins over anything captured — the leave record is the source of truth.
  if (row.onApprovedLeave) return "leave";
  if (row.status === null) return "not_captured";
  if (row.status === "present") return "present";
  if (row.status === "absent") return "absent";
  if (row.status === "leave" || row.status === "sick_leave") return "leave";
  return "other";
}

/** People an office roll call can still act on — used by "Mark all remaining present". */
export function remainingToCapture(rows: StaffAttendanceRow[]): StaffAttendanceRow[] {
  return rows.filter((row) => rollCallState(row) === "not_captured");
}

export function formatTimeOfDay(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}
