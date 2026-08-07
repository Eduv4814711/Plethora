import type { SiteTimesheetAttendance, SiteTimesheetRow } from "@/lib/roster-api";

export type AttendanceShiftTypeFilter = "day" | "night" | "all";

export function normalizeShiftType(value: string | null | undefined): "day" | "night" | null {
  if (!value) return null;
  if (value === "day" || value === "D") return "day";
  if (value === "night" || value === "N") return "night";
  return null;
}

/** Working shifts need Duty ON and Duty OFF before full row review. */
export function rowNeedsObNumbers(attendanceStatus: SiteTimesheetAttendance | string): boolean {
  if (attendanceStatus === "off") return false;
  if (attendanceStatus === "leave" || attendanceStatus === "sick_leave") return false;
  return true;
}

export function isRowPendingReview(approvalStatus: string): boolean {
  return approvalStatus === "pending" || approvalStatus === "partially_reviewed";
}

export function isRowFullyReviewed(approvalStatus: string): boolean {
  return approvalStatus === "reviewed" || approvalStatus === "approved";
}

export function resolveDutyOnFromRow(row: {
  dutyOnObNumber?: string | null;
  occurrenceBookNumber?: string | null;
}): string {
  return (row.dutyOnObNumber ?? row.occurrenceBookNumber ?? "").trim();
}

export function resolveDutyOffFromRow(row: { dutyOffObNumber?: string | null }): string {
  return (row.dutyOffObNumber ?? "").trim();
}

/** Human-readable attendance status for read-only display. */
export function formatAttendanceStatus(value: string | null | undefined): string {
  if (!value) return "Not set";
  return value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export function formatApprovalStatus(value: string | null | undefined): string {
  if (!value) return "Pending";
  if (value === "partially_reviewed") return "Partial";
  return value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Derive attendance status when the controller approves a row.
 * Controllers confirm who worked / shift / times; status is not chosen manually.
 */
export function resolveAttendanceStatusOnApprove(input: {
  plannedGuardId: string | null;
  actualGuardId: string | null;
  plannedShiftCode: string | null;
  actualShiftCode: string | null;
  actualShiftType: string | null;
  clockIn: string | null;
  clockOut: string | null;
}): SiteTimesheetAttendance {
  if (input.actualShiftCode === "R") return "reliever";
  if (input.actualShiftCode === "L") return "leave";
  if (input.actualShiftCode === "SL") return "sick_leave";
  if (input.actualShiftCode === "TR") return "training";
  if (input.actualShiftCode === "O" || input.actualShiftCode === "blank") return "off";

  if (
    (input.plannedShiftCode === "O" || input.plannedShiftCode === "blank") &&
    input.actualGuardId === null &&
    (input.actualShiftType === null || input.actualShiftType === "") &&
    !input.clockIn &&
    !input.clockOut
  ) {
    return "off";
  }

  if (
    input.plannedGuardId &&
    input.actualGuardId &&
    input.plannedGuardId !== input.actualGuardId
  ) {
    return "shift_swapped";
  }

  if (
    input.actualGuardId === null &&
    (input.actualShiftType === null || input.actualShiftType === "") &&
    !input.clockIn &&
    !input.clockOut
  ) {
    return "absent";
  }

  if (input.clockIn || input.clockOut) return "present";
  return "present";
}

/**
 * Suggest the next occurrence book number in a sequence, preserving any prefix and the
 * original zero padding ("1042" -> "1043", "OB-0099" -> "OB-0100").
 *
 * Returns null when there is no numeric tail to advance. Suggestions only ever prefill an
 * input the controller can overwrite — nothing is stored until they confirm the row.
 */
export function suggestNextObNumber(previous: string | null | undefined): string | null {
  const trimmed = (previous ?? "").trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (!match) return null;

  const [, prefix, digits] = match;
  const next = String(Number.parseInt(digits, 10) + 1);
  if (!Number.isFinite(Number(next))) return null;

  // Keep the original width when it was zero-padded, but never truncate on roll-over.
  const padded = next.padStart(digits.length, "0");
  return `${prefix}${padded}`;
}

export function rowMatchesShiftTypeFilter(
  row: Pick<
    SiteTimesheetRow,
    "plannedShiftType" | "plannedShiftCode" | "actualShiftType" | "actualShiftCode"
  >,
  shiftType: AttendanceShiftTypeFilter
): boolean {
  if (shiftType === "all") return true;
  const plannedType = normalizeShiftType(row.plannedShiftType ?? row.plannedShiftCode);
  const actualType = normalizeShiftType(row.actualShiftType ?? row.actualShiftCode);
  // A changed shift remains visible under both its scheduled and actual shift so
  // filtering can never hide an attendance entry that still needs confirmation.
  return plannedType === shiftType || actualType === shiftType;
}

const SHIFT_SORT_ORDER: Record<string, number> = { day: 0, night: 1 };

function rowShiftSortOrder(row: SiteTimesheetRow): number {
  const type = normalizeShiftType(
    row.plannedShiftType ?? row.plannedShiftCode ?? row.actualShiftType ?? row.actualShiftCode
  );
  return type ? (SHIFT_SORT_ORDER[type] ?? 2) : 2;
}

export function sortSiteTimesheetRows(rows: SiteTimesheetRow[]): SiteTimesheetRow[] {
  return [...rows].sort((a, b) => {
    if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
    const shiftDiff = rowShiftSortOrder(a) - rowShiftSortOrder(b);
    if (shiftDiff !== 0) return shiftDiff;
    return a.id.localeCompare(b.id);
  });
}
