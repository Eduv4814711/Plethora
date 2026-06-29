import { parseISO } from "date-fns";
import type { RosterPeriodGrid, RosterShiftCode } from "./roster-api";
import type { ShiftSheetCellCode, ShiftSheetRow } from "./shift-sheet-matrix";

function splitGuardName(guardName: string): { firstName: string; lastName: string } {
  const trimmed = guardName.trim();
  const space = trimmed.indexOf(" ");
  if (space <= 0) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1) };
}

export function shiftCodeToSheetCell(code: RosterShiftCode): ShiftSheetCellCode {
  if (code === "blank") return "";
  return code;
}

export function buildShiftSheetRowsFromRosterGrid(grid: RosterPeriodGrid): ShiftSheetRow[] {
  const dayKeys = grid.calendarDays;
  return grid.rows.map((row) => {
    const { firstName, lastName } = splitGuardName(row.guardName);
    const cellByDate = new Map(
      row.cells.filter((c) => c.dateKey).map((c) => [c.dateKey!, c.shiftCode])
    );
    const cells = dayKeys.map((dk) => shiftCodeToSheetCell(cellByDate.get(dk) ?? "blank"));
    return {
      employeeId: row.guardId,
      firstName,
      lastName,
      gender: row.gender,
      phone: row.phone,
      cells,
    };
  });
}

export function rosterGridCalendarDays(grid: RosterPeriodGrid): Date[] {
  return grid.calendarDays.map((d) => parseISO(d));
}

export function rosterExportFilename(siteName: string, periodStart: string): string {
  const slug = siteName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `roster-${slug || "site"}-${periodStart}.pdf`;
}

export function downloadPdfBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
