import type { RosterShiftCode } from "./roster-api";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

const VALID_CODES = new Set<RosterShiftCode>([
  "D",
  "N",
  "O",
  "L",
  "SL",
  "TR",
  "SB",
  "AWOL",
  "R",
  "blank",
]);

export type PatternPreset = {
  id: string;
  label: string;
  description: string;
  sequence: RosterShiftCode[];
};

export const PATTERN_PRESETS: PatternPreset[] = [
  {
    id: "3on3off-day",
    label: "3 on / 3 off (day)",
    description: "Three day shifts, three off",
    sequence: ["D", "D", "D", "O", "O", "O"],
  },
  {
    id: "4on4off-day",
    label: "4 on / 4 off (day)",
    description: "Four day shifts, four off",
    sequence: ["D", "D", "D", "D", "O", "O", "O", "O"],
  },
  {
    id: "day-night-alt",
    label: "Day / night alternate",
    description: "Alternating day and night",
    sequence: ["D", "N"],
  },
  {
    id: "nights-only",
    label: "Nights only",
    description: "Night shift every working day",
    sequence: ["N"],
  },
  {
    id: "days-only",
    label: "Days only",
    description: "Day shift every working day",
    sequence: ["D"],
  },
  {
    id: "all-off",
    label: "All off",
    description: "Clear to off days",
    sequence: ["O"],
  },
];

/** Parse "D,D,N,O" or "D N O" into shift codes. */
export function parsePatternNotation(raw: string): RosterShiftCode[] {
  const tokens = raw
    .split(/[\s,;/]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const result: RosterShiftCode[] = [];
  for (const token of tokens) {
    if (token === "-" || token === "—" || token === "_") {
      result.push("blank");
      continue;
    }
    const code = (token === "BLANK" ? "blank" : token) as RosterShiftCode;
    if (VALID_CODES.has(code)) result.push(code);
  }
  return result;
}

/** Repeat a sequence to fill exactly `cycleLength` days (pattern day indices 0..n-1). */
export function expandPatternToCycle(
  sequence: RosterShiftCode[],
  cycleLength: number
): RosterShiftCode[] {
  if (sequence.length === 0 || cycleLength <= 0) {
    return Array.from({ length: cycleLength }, () => "blank" as RosterShiftCode);
  }
  return Array.from({ length: cycleLength }, (_, i) => sequence[i % sequence.length]!);
}

export function periodDayCount(start: string, end: string): number {
  return differenceInCalendarDays(parseISO(end.slice(0, 10)), parseISO(start.slice(0, 10))) + 1;
}

export function listCalendarDays(start: string, end: string): string[] {
  const days: string[] = [];
  let d = parseISO(start.slice(0, 10));
  const endDate = parseISO(end.slice(0, 10));
  while (d <= endDate) {
    days.push(format(d, "yyyy-MM-dd"));
    d = addDays(d, 1);
  }
  return days;
}

export function dayIndexFromAnchor(anchor: string, date: string): number {
  return differenceInCalendarDays(parseISO(date.slice(0, 10)), parseISO(anchor.slice(0, 10)));
}

export function patternDayIndexForDate(anchor: string, date: string, cycleLength: number): number {
  const diff = differenceInCalendarDays(parseISO(date.slice(0, 10)), parseISO(anchor.slice(0, 10)));
  const mod = ((diff % cycleLength) + cycleLength) % cycleLength;
  return mod;
}

/** Collapse calendar edits into unique (guard, pattern-day) cells for saving a repeating cycle. */
export function buildCellsForPatternSave(
  rows: { guardId: string; cells: { dateKey?: string; shiftCode: RosterShiftCode; isLocked?: boolean; patternDayIndex?: number }[] }[],
  anchorDate: string,
  cycleLengthDays: number,
  lockedCells: Set<string>
): { guardId: string; patternDayIndex: number; shiftCode: RosterShiftCode; isLocked: boolean }[] {
  const byKey = new Map<string, { guardId: string; patternDayIndex: number; shiftCode: RosterShiftCode; isLocked: boolean }>();
  for (const row of rows) {
    for (const cell of row.cells) {
      const patternDayIndex =
        cell.dateKey != null
          ? patternDayIndexForDate(anchorDate, cell.dateKey, cycleLengthDays)
          : cell.patternDayIndex;
      if (patternDayIndex === undefined) continue;
      const key = `${row.guardId}:${patternDayIndex}`;
      byKey.set(key, {
        guardId: row.guardId,
        patternDayIndex,
        shiftCode: cell.shiftCode,
        isLocked: cell.isLocked ?? lockedCells.has(`${row.guardId}:${cell.dateKey ?? patternDayIndex}`),
      });
    }
  }
  return Array.from(byKey.values());
}

/** Keep local cell edits when the calendar date range is refreshed. */
export function mergeGridEdits<T extends { guardId: string; cells: { dateKey?: string; shiftCode: RosterShiftCode }[] }>(
  fresh: { rows: T[]; calendarDays: string[]; periodStart: string; periodEnd: string },
  previous: { rows: T[] } | null
): { rows: T[] } {
  if (!previous) return fresh;
  const edits = new Map<string, RosterShiftCode>();
  for (const row of previous.rows) {
    for (const cell of row.cells) {
      if (cell.dateKey) edits.set(`${row.guardId}:${cell.dateKey}`, cell.shiftCode);
    }
  }
  const rows = fresh.rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      if (!cell.dateKey) return cell;
      const edited = edits.get(`${row.guardId}:${cell.dateKey}`);
      return edited !== undefined ? { ...cell, shiftCode: edited } : cell;
    }),
  }));
  return { ...fresh, rows };
}

export function formatCalendarColumnLabel(dateKey: string): { weekday: string; day: string; month: string } {
  const d = parseISO(dateKey.slice(0, 10));
  return {
    weekday: format(d, "EEE"),
    day: format(d, "d"),
    month: format(d, "MMM"),
  };
}

export function isDateColumnKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key);
}

export function formatPatternPreview(sequence: RosterShiftCode[], cycleLength: number): string {
  return expandPatternToCycle(sequence, cycleLength)
    .slice(0, Math.min(cycleLength, 14))
    .map((c) => (c === "blank" ? "—" : c))
    .join(" ");
}
