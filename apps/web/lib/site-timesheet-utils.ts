import type { SiteTimesheetRow } from "@/lib/roster-api";

function normalizeShiftType(value: string | null | undefined): "day" | "night" | null {
  if (!value) return null;
  if (value === "day" || value === "D") return "day";
  if (value === "night" || value === "N") return "night";
  return null;
}

/** Day shifts sort above night; unknown shift types sort last. */
export function rowShiftSortOrder(row: SiteTimesheetRow): number {
  const shift =
    normalizeShiftType(row.plannedShiftType ?? row.plannedShiftCode) ??
    normalizeShiftType(row.actualShiftType ?? row.actualShiftCode);
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
