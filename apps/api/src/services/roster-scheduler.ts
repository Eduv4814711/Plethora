import { addDays, differenceInCalendarDays, getDay } from "date-fns";
import type { CustomBlock } from "./rostering.service.js";

export type RosterDualPattern = "3_on_3_off" | "custom_builder";

export type CoverageEntry = {
  startTime: string;
  shiftType: "day" | "night";
};

export type ShiftPreference = "day" | "night" | "off";

export type GuardStats = {
  employeeId: string;
  dayCount: number;
  nightCount: number;
  offCount: number;
  sundayCount: number;
  weekendCount: number;
};

export type FairnessTargets = {
  targetDay: number;
  targetNight: number;
  targetOff: number;
  targetSunday: number;
  targetWeekend: number;
};

export type FairnessSpread = {
  maxDayMinusMinDay: number;
  maxNightMinusMinNight: number;
  maxSundayMinusMinSunday: number;
};

export type UncoveredDay = {
  date: string;
  missing: ("day" | "night")[];
  /** Assigned count on that date for each missing shift type. */
  counts?: Partial<Record<"day" | "night", number>>;
  /** Required count from site settings. */
  required?: Partial<Record<"day" | "night", number>>;
};

export type ShiftStaffingRequirements = {
  day: number;
  night: number;
};

const W_DAY = 14;
const W_NIGHT = 14;
const W_OFF = 4;
const W_SUNDAY = 12;
const W_WEEKEND = 6;
const PREFERENCE_BONUS = 2;

export function formatDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dualPatternCycleLength(
  pattern: RosterDualPattern,
  customBlocks?: CustomBlock[]
): number {
  if (pattern === "3_on_3_off") return 9;
  if (!customBlocks?.length) return 1;
  return customBlocks.reduce((sum, b) => sum + b.count, 0) || 1;
}

/** Evenly space guard phase offsets across the pattern cycle (e.g. 3d3n3o / 3 guards → 0, 3, 6). */
export function computeStaggerOffsets(guardCount: number, cycleLength: number): number[] {
  if (guardCount <= 0 || cycleLength <= 0) return [];
  return Array.from({ length: guardCount }, (_, i) =>
    Math.floor((i * cycleLength) / guardCount)
  );
}

export function patternBlocks(
  pattern: RosterDualPattern,
  customBlocks?: CustomBlock[]
): CustomBlock[] {
  if (pattern === "3_on_3_off") {
    return [
      { type: "day", count: 3 },
      { type: "night", count: 3 },
      { type: "off", count: 3 },
    ];
  }
  return customBlocks ?? [];
}

/** Calendar days from start through end (inclusive), normalized to UTC midnight. */
export function buildCalendarDays(startDate: Date, endDate: Date): Date[] {
  const days: Date[] = [];
  let d = new Date(startDate);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(23, 59, 59, 999);
  while (d <= end) {
    days.push(new Date(d));
    d = addDays(d, 1);
  }
  return days;
}

export function getPatternShiftAtOffset(
  offsetDays: number,
  pattern: RosterDualPattern,
  customBlocks?: CustomBlock[]
): ShiftPreference {
  const blocks = patternBlocks(pattern, customBlocks);
  const cycleLen = blocks.reduce((sum, b) => sum + b.count, 0);
  if (cycleLen === 0) return "off";

  const pos = ((offsetDays % cycleLen) + cycleLen) % cycleLen;
  let cursor = 0;
  for (const block of blocks) {
    if (pos < cursor + block.count) {
      return block.type;
    }
    cursor += block.count;
  }
  return "off";
}

export function buildPatternPreferenceGrid(params: {
  guardIds: string[];
  calendarDays: Date[];
  patternStartDate: Date;
  pattern: RosterDualPattern;
  customBlocks?: CustomBlock[];
  staggerOffsets: Map<string, number>;
}): Map<string, Map<string, ShiftPreference>> {
  const { guardIds, calendarDays, patternStartDate, pattern, customBlocks, staggerOffsets } =
    params;
  const grid = new Map<string, Map<string, ShiftPreference>>();

  for (const guardId of guardIds) {
    const offsetDays = staggerOffsets.get(guardId) ?? 0;
    const guardCycleStart = addDays(patternStartDate, offsetDays);
    const byDate = new Map<string, ShiftPreference>();

    for (const day of calendarDays) {
      const dateKey = formatDateKey(day);
      const daysSinceStart = differenceInCalendarDays(day, guardCycleStart);
      if (daysSinceStart < 0) {
        byDate.set(dateKey, "off");
      } else {
        byDate.set(dateKey, getPatternShiftAtOffset(daysSinceStart, pattern, customBlocks));
      }
    }
    grid.set(guardId, byDate);
  }

  return grid;
}

export function countSundaysAndWeekends(calendarDays: Date[]): {
  sundayCount: number;
  weekendCount: number;
} {
  let sundayCount = 0;
  let weekendCount = 0;
  for (const d of calendarDays) {
    const dow = getDay(d);
    if (dow === 0) sundayCount++;
    if (dow === 0 || dow === 6) weekendCount++;
  }
  return { sundayCount, weekendCount };
}

export function computeFairnessTargets(
  guardCount: number,
  calendarDays: Date[]
): FairnessTargets {
  const numDays = calendarDays.length;
  const { sundayCount, weekendCount } = countSundaysAndWeekends(calendarDays);
  const g = Math.max(guardCount, 1);

  const targetDay = numDays / g;
  const targetNight = numDays / g;
  const targetOff = Math.max(0, numDays - targetDay - targetNight);
  const targetSunday = sundayCount / g;
  const targetWeekend = weekendCount / g;

  return { targetDay, targetNight, targetOff, targetSunday, targetWeekend };
}

export function createInitialGuardStats(guardIds: string[]): Map<string, GuardStats> {
  const map = new Map<string, GuardStats>();
  for (const id of guardIds) {
    map.set(id, {
      employeeId: id,
      dayCount: 0,
      nightCount: 0,
      offCount: 0,
      sundayCount: 0,
      weekendCount: 0,
    });
  }
  return map;
}

export function scoreGuardForSlot(
  stats: GuardStats,
  shiftType: "day" | "night",
  date: Date,
  targets: FairnessTargets,
  preference: ShiftPreference
): number {
  let score = 0;

  if (shiftType === "day") {
    score += (stats.dayCount - targets.targetDay) * W_DAY;
  } else {
    score += (stats.nightCount - targets.targetNight) * W_NIGHT;
  }

  score += (targets.targetOff - stats.offCount) * W_OFF;

  const dow = getDay(date);
  if (dow === 0) {
    score += (stats.sundayCount - targets.targetSunday) * W_SUNDAY;
  }
  if (dow === 0 || dow === 6) {
    score += (stats.weekendCount - targets.targetWeekend) * W_WEEKEND;
  }

  if (preference === shiftType) {
    score -= PREFERENCE_BONUS;
  }

  return score;
}

export function selectGuardForSlot(params: {
  candidateIds: string[];
  shiftType: "day" | "night";
  date: Date;
  dayIndex: number;
  statsByGuard: Map<string, GuardStats>;
  targets: FairnessTargets;
  preferenceGrid: Map<string, Map<string, ShiftPreference>>;
}): string | null {
  const { candidateIds, shiftType, date, dayIndex, statsByGuard, targets, preferenceGrid } =
    params;
  const dateKey = formatDateKey(date);
  const sortedIds = [...candidateIds].sort((a, b) => a.localeCompare(b));

  const ranked = sortedIds.sort((a, b) => {
    const statsA = statsByGuard.get(a)!;
    const statsB = statsByGuard.get(b)!;
    const prefA = preferenceGrid.get(a)?.get(dateKey) ?? "off";
    const prefB = preferenceGrid.get(b)?.get(dateKey) ?? "off";
    const scoreA = scoreGuardForSlot(statsA, shiftType, date, targets, prefA);
    const scoreB = scoreGuardForSlot(statsB, shiftType, date, targets, prefB);
    if (scoreA !== scoreB) return scoreA - scoreB;
    const rotA = (sortedIds.indexOf(a) + dayIndex) % sortedIds.length;
    const rotB = (sortedIds.indexOf(b) + dayIndex) % sortedIds.length;
    return rotA - rotB;
  });

  return ranked[0] ?? null;
}

export function recordShiftInStats(stats: GuardStats, shiftType: "day" | "night", date: Date): void {
  if (shiftType === "day") stats.dayCount++;
  else stats.nightCount++;
  const dow = getDay(date);
  if (dow === 0) stats.sundayCount++;
  if (dow === 0 || dow === 6) stats.weekendCount++;
}

export function recordOffDayInStats(stats: GuardStats): void {
  stats.offCount++;
}

export function computeFairnessSpread(statsByGuard: Map<string, GuardStats>): FairnessSpread {
  const stats = [...statsByGuard.values()];
  if (stats.length === 0) {
    return { maxDayMinusMinDay: 0, maxNightMinusMinNight: 0, maxSundayMinusMinSunday: 0 };
  }

  const dayCounts = stats.map((s) => s.dayCount);
  const nightCounts = stats.map((s) => s.nightCount);
  const sundayCounts = stats.map((s) => s.sundayCount);

  return {
    maxDayMinusMinDay: Math.max(...dayCounts) - Math.min(...dayCounts),
    maxNightMinusMinNight: Math.max(...nightCounts) - Math.min(...nightCounts),
    maxSundayMinusMinSunday: Math.max(...sundayCounts) - Math.min(...sundayCounts),
  };
}

export function validateDailyCoverage(
  entries: CoverageEntry[],
  calendarDays: Date[],
  staffing: ShiftStaffingRequirements = { day: 1, night: 1 }
): UncoveredDay[] {
  const requiredDay = Math.max(1, staffing.day);
  const requiredNight = Math.max(1, staffing.night);

  const byDate = new Map<string, { day: number; night: number }>();
  for (const e of entries) {
    const dateKey = e.startTime.slice(0, 10);
    if (!byDate.has(dateKey)) byDate.set(dateKey, { day: 0, night: 0 });
    const row = byDate.get(dateKey)!;
    if (e.shiftType === "day") row.day++;
    else row.night++;
  }

  const uncovered: UncoveredDay[] = [];
  for (const day of calendarDays) {
    const dateKey = formatDateKey(day);
    const counts = byDate.get(dateKey) ?? { day: 0, night: 0 };
    const missing: ("day" | "night")[] = [];
    if (counts.day < requiredDay) missing.push("day");
    if (counts.night < requiredNight) missing.push("night");
    if (missing.length > 0) {
      uncovered.push({
        date: dateKey,
        missing,
        counts: { day: counts.day, night: counts.night },
        required: { day: requiredDay, night: requiredNight },
      });
    }
  }
  return uncovered;
}
