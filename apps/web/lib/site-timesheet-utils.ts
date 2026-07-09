import type { SiteTimesheetAttendance, SiteTimesheetRow } from "@/lib/roster-api";

export type AttendanceShiftTypeFilter = "day" | "night" | "all";

const WORKING_SHIFT_CODES = new Set(["D", "N", "R"]);

/** Case-insensitive OB match after trim. */
export function occurrenceBookNumbersMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Find another row on the same timesheet that already uses this OB number.
 * Used for client-side validation before save/approve.
 */
export function findDuplicateOccurrenceBookRow(
  rows: Array<{ id: string; workDate: string; occurrenceBookNumber?: string | null }>,
  occurrenceBookNumber: string,
  excludeRowId?: string
): { id: string; workDate: string } | null {
  const needle = occurrenceBookNumber.trim();
  if (!needle) return null;
  const match = rows.find(
    (r) =>
      r.id !== excludeRowId &&
      r.occurrenceBookNumber != null &&
      r.occurrenceBookNumber.trim().length > 0 &&
      occurrenceBookNumbersMatch(r.occurrenceBookNumber, needle)
  );
  return match ? { id: match.id, workDate: match.workDate } : null;
}

export function normalizeShiftType(value: string | null | undefined): "day" | "night" | null {
  if (!value) return null;
  if (value === "day" || value === "D") return "day";
  if (value === "night" || value === "N") return "night";
  return null;
}

/** Human-readable attendance status for read-only display. */
export function formatAttendanceStatus(value: string | null | undefined): string {
  if (!value) return "Not set";
  return value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Derive attendance status when the controller approves a row.
 * Controllers confirm who worked / shift / times; status is not chosen manually.
 */
export function resolveAttendanceStatusOnApprove(input: {
  plannedGuardId?: string | null;
  actualGuardId?: string | null;
  plannedShiftCode?: string | null;
  actualShiftCode?: string | null;
  actualShiftType?: string | null;
  clockIn?: string | null;
  clockOut?: string | null;
}): SiteTimesheetAttendance {
  const actualCode = input.actualShiftCode ?? null;
  const plannedCode = input.plannedShiftCode ?? null;
  const code = actualCode ?? plannedCode;

  if (code === "L") return "leave";
  if (code === "SL") return "sick_leave";
  if (code === "TR") return "training";
  if (code === "O" || code === "blank") return "off";

  const workedShift =
    input.actualShiftType === "day" ||
    input.actualShiftType === "night" ||
    actualCode === "D" ||
    actualCode === "N" ||
    actualCode === "R";
  const hasClocks = Boolean(input.clockIn || input.clockOut);
  const plannedWorking = WORKING_SHIFT_CODES.has(plannedCode ?? "");

  if (!input.actualGuardId && !workedShift && !hasClocks) {
    return plannedWorking ? "absent" : "off";
  }

  if (actualCode === "R") return "reliever";

  if (
    input.plannedGuardId &&
    input.actualGuardId &&
    input.plannedGuardId !== input.actualGuardId
  ) {
    return "shift_swapped";
  }

  if (input.actualGuardId || workedShift || hasClocks) {
    return "present";
  }

  return plannedWorking ? "absent" : "off";
}

/** Prefer planned shift so uncaptured rostered rows still classify correctly. */
export function resolveRowShiftType(row: {
  plannedShiftType?: string | null;
  plannedShiftCode?: string | null;
  actualShiftType?: string | null;
  actualShiftCode?: string | null;
}): "day" | "night" | null {
  return (
    normalizeShiftType(row.plannedShiftType ?? row.plannedShiftCode) ??
    normalizeShiftType(row.actualShiftType ?? row.actualShiftCode)
  );
}

export function rowMatchesShiftTypeFilter(
  row: {
    plannedShiftType?: string | null;
    plannedShiftCode?: string | null;
    actualShiftType?: string | null;
    actualShiftCode?: string | null;
  },
  shiftType: AttendanceShiftTypeFilter
): boolean {
  if (shiftType === "all") return true;
  return resolveRowShiftType(row) === shiftType;
}

/** Day shifts sort above night; unknown shift types sort last. */
export function rowShiftSortOrder(row: SiteTimesheetRow): number {
  const shift = resolveRowShiftType(row);
  if (shift === "day") return 0;
  if (shift === "night") return 1;
  return 2;
}

export function compareSiteTimesheetRows(a: SiteTimesheetRow, b: SiteTimesheetRow): number {
  if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
  const shiftDiff = rowShiftSortOrder(a) - rowShiftSortOrder(b);
  if (shiftDiff !== 0) return shiftDiff;
  return a.id.localeCompare(b.id);
}

export function sortSiteTimesheetRows(rows: SiteTimesheetRow[]): SiteTimesheetRow[] {
  return [...rows].sort(compareSiteTimesheetRows);
}
