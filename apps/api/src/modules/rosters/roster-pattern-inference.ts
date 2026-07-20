import type { SiteRosterShiftCode } from "@prisma/client";
import type { RosterPeriodCalendarConfig } from "../../lib/payroll-calendar-settings.js";

export type RosterObservation = {
  guardId: string;
  dateKey: string;
  shiftCode: SiteRosterShiftCode;
};

export type InferredPatternCell = {
  guardId: string;
  patternDayIndex: number;
  shiftCode: SiteRosterShiftCode;
};

export type PatternInferenceResult = {
  cycleLengthDays: number;
  anchorDate: string;
  sourceStart: string;
  sourceEnd: string;
  confidencePercent: number;
  guardsEvaluated: number;
  observationsEvaluated: number;
  cells: InferredPatternCell[];
};

const DAY_MS = 86_400_000;

function utcDate(key: string): Date {
  return new Date(`${key.slice(0, 10)}T00:00:00.000Z`);
}

function dayDifference(from: string, to: string): number {
  return Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / DAY_MS);
}

function latestContiguousDateKeys(observations: RosterObservation[], maxDays: number): Set<string> {
  const keys = [...new Set(observations.map((row) => row.dateKey.slice(0, 10)))].sort();
  if (keys.length === 0) return new Set();

  const selected: string[] = [keys[keys.length - 1]!];
  for (let index = keys.length - 2; index >= 0 && selected.length < maxDays; index -= 1) {
    const candidate = keys[index]!;
    const next = selected[selected.length - 1]!;
    if (dayDifference(candidate, next) !== 1) break;
    selected.push(candidate);
  }
  return new Set(selected);
}

function modalCode(rows: RosterObservation[]): SiteRosterShiftCode {
  const counts = new Map<SiteRosterShiftCode, number>();
  for (const row of rows) counts.set(row.shiftCode, (counts.get(row.shiftCode) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "blank";
}

/**
 * Finds the shortest, high-quality repeating cycle in the most recent contiguous roster data.
 * A cycle must be observed at least twice to avoid turning a single period into an overfit pattern.
 */
export function inferRepeatingRosterPattern(
  observations: RosterObservation[],
  options: { minCycleDays?: number; maxCycleDays?: number; maxHistoryDays?: number } = {}
): PatternInferenceResult | null {
  const minCycle = options.minCycleDays ?? 2;
  const maxCycle = options.maxCycleDays ?? 14;
  const contiguousKeys = latestContiguousDateKeys(observations, options.maxHistoryDays ?? 62);
  const rows = observations
    .filter((row) => contiguousKeys.has(row.dateKey.slice(0, 10)))
    .map((row) => ({ ...row, dateKey: row.dateKey.slice(0, 10) }));

  const dateKeys = [...contiguousKeys].sort();
  if (dateKeys.length < minCycle * 2 || rows.length === 0) return null;
  const anchorDate = dateKeys[0]!;
  const guardIds = [...new Set(rows.map((row) => row.guardId))].sort();
  if (guardIds.length === 0) return null;

  const candidates: {
    cycleLengthDays: number;
    accuracy: number;
    cells: InferredPatternCell[];
  }[] = [];

  for (let cycleLengthDays = minCycle; cycleLengthDays <= maxCycle; cycleLengthDays += 1) {
    if (dateKeys.length < cycleLengthDays * 2) continue;
    const buckets = new Map<string, RosterObservation[]>();
    for (const row of rows) {
      const patternDayIndex = ((dayDifference(anchorDate, row.dateKey) % cycleLengthDays) + cycleLengthDays) % cycleLengthDays;
      const key = `${row.guardId}:${patternDayIndex}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(row);
      buckets.set(key, bucket);
    }

    const cells: InferredPatternCell[] = [];
    const codeByBucket = new Map<string, SiteRosterShiftCode>();
    for (const guardId of guardIds) {
      for (let patternDayIndex = 0; patternDayIndex < cycleLengthDays; patternDayIndex += 1) {
        const key = `${guardId}:${patternDayIndex}`;
        const code = modalCode(buckets.get(key) ?? []);
        codeByBucket.set(key, code);
        cells.push({ guardId, patternDayIndex, shiftCode: code });
      }
    }

    const matching = rows.filter((row) => {
      const patternDayIndex = ((dayDifference(anchorDate, row.dateKey) % cycleLengthDays) + cycleLengthDays) % cycleLengthDays;
      return codeByBucket.get(`${row.guardId}:${patternDayIndex}`) === row.shiftCode;
    }).length;
    candidates.push({ cycleLengthDays, accuracy: matching / rows.length, cells });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.accuracy - a.accuracy || a.cycleLengthDays - b.cycleLengthDays);
  const bestAccuracy = candidates[0]!.accuracy;
  if (bestAccuracy < 0.75) return null;
  const selected = candidates
    .filter((candidate) => candidate.accuracy >= bestAccuracy - 0.02)
    .sort((a, b) => a.cycleLengthDays - b.cycleLengthDays)[0]!;

  return {
    cycleLengthDays: selected.cycleLengthDays,
    anchorDate,
    sourceStart: anchorDate,
    sourceEnd: dateKeys[dateKeys.length - 1]!,
    confidencePercent: Math.round(selected.accuracy * 100),
    guardsEvaluated: guardIds.length,
    observationsEvaluated: rows.length,
    cells: selected.cells,
  };
}

function clampedMonthDay(year: number, month: number, requested: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.min(requested, last);
}

export function inferRosterCalendarId(
  sourceStart: string,
  sourceEnd: string,
  calendars: RosterPeriodCalendarConfig[],
  defaultCalendarId: string
): { calendarId: string; confidence: "high" | "fallback" } {
  const start = utcDate(sourceStart);
  const end = utcDate(sourceEnd);
  const exact = calendars.find((calendar) => {
    const expectedEnd = clampedMonthDay(end.getUTCFullYear(), end.getUTCMonth(), calendar.endDay);
    return start.getUTCDate() === calendar.startDay && end.getUTCDate() === expectedEnd;
  });
  if (exact) return { calendarId: exact.id, confidence: "high" };

  const startMatch = calendars.find((calendar) => start.getUTCDate() === calendar.startDay);
  if (startMatch) return { calendarId: startMatch.id, confidence: "fallback" };
  return { calendarId: defaultCalendarId, confidence: "fallback" };
}
