import { addDays, differenceInCalendarDays, getDay } from "date-fns";
import { meetsSiteShiftGenderRule, type CustomBlock } from "./rostering.service.js";

export type RosterDualPattern = "3_on_3_off" | "custom_builder";

export type SiteGenderRules = {
  rosterDayShiftGender: string | null;
  rosterNightShiftGender: string | null;
};

export type RosterDemandSlot = {
  siteId: string;
  postId: string;
  date: Date;
  dateKey: string;
  shiftType: "day" | "night";
  requiredGender: "male" | "female" | "any" | null;
  difficultyScore: number;
};

export type DemandSlotWarning = {
  code: string;
  message: string;
  date?: string;
};

export type GuardCandidate = {
  id: string;
  gender: string | null;
  status: string;
  employeeType: string | null;
};

export type GuardRuntimeState = {
  stats: GuardStats;
  planned: { start: Date; end: Date }[];
  workedDateKeys: Set<string>;
  /** At most one shift type per calendar day (enforces rest rules). */
  shiftTypeByDateKey: Map<string, "day" | "night">;
};

/** Max calendar work days in a row before a rest day is required. */
export const MAX_CONSECUTIVE_WORK_DAYS = 6;

const ROSTERABLE_STATUSES = ["active", "training", "hired", "reliever"] as const;

const SCORE_ASSIGNED_TO_POST = -8;
const SCORE_PREFERENCE_MATCH = -4;
const SCORE_WORKED_PREVIOUS_DAY = 6;
const SCORE_RELIEVER = 10;

function normalizeRequiredGender(
  siteGenderRules: SiteGenderRules,
  shiftType: "day" | "night"
): "male" | "female" | "any" | null {
  const raw =
    shiftType === "night"
      ? siteGenderRules.rosterNightShiftGender
      : siteGenderRules.rosterDayShiftGender;
  if (raw == null || raw === "") return null;
  const s = String(raw).toLowerCase();
  if (s === "male" || s === "female" || s === "any") return s;
  return null;
}

function slotDifficulty(requiredGender: "male" | "female" | "any" | null, staffingExceedsPosts: boolean): number {
  let score = 0;
  if (requiredGender === "male" || requiredGender === "female") score += 10;
  if (staffingExceedsPosts) score += 5;
  return score;
}

/** Build required day/night demand slots from posts, staffing, and gender rules. */
export function buildSiteDemandSlots(params: {
  siteId: string;
  calendarDays: Date[];
  dayPosts: { id: string }[];
  nightPosts: { id: string }[];
  staffing: ShiftStaffingRequirements;
  siteGenderRules: SiteGenderRules;
}): { slots: RosterDemandSlot[]; warnings: DemandSlotWarning[] } {
  const { siteId, calendarDays, dayPosts, nightPosts, staffing, siteGenderRules } = params;
  const warnings: DemandSlotWarning[] = [];
  const slots: RosterDemandSlot[] = [];

  const requiredDay = Math.max(1, staffing.day);
  const requiredNight = Math.max(1, staffing.night);

  if (nightPosts.length === 0) {
    warnings.push({
      code: "MISSING_NIGHT_POSTS",
      message: "Site has no night post. Add a night post to fill night shift demand slots.",
    });
  }

  if (dayPosts.length > 0 && requiredDay > dayPosts.length) {
    warnings.push({
      code: "STAFFING_EXCEEDS_POSTS",
      message: `Day staffing requires ${requiredDay} guard(s) per day but only ${dayPosts.length} day post(s) exist. Posts will be cycled.`,
    });
  }

  if (nightPosts.length > 0 && requiredNight > nightPosts.length) {
    warnings.push({
      code: "STAFFING_EXCEEDS_POSTS",
      message: `Night staffing requires ${requiredNight} guard(s) per day but only ${nightPosts.length} night post(s) exist. Posts will be cycled.`,
    });
  }

  for (const day of calendarDays) {
    const dateKey = formatDateKey(day);

    for (let i = 0; i < requiredDay; i++) {
      if (dayPosts.length === 0) continue;
      const post = dayPosts[i % dayPosts.length]!;
      const requiredGender = normalizeRequiredGender(siteGenderRules, "day");
      slots.push({
        siteId,
        postId: post.id,
        date: new Date(day),
        dateKey,
        shiftType: "day",
        requiredGender,
        difficultyScore: slotDifficulty(requiredGender, requiredDay > dayPosts.length),
      });
    }

    for (let i = 0; i < requiredNight; i++) {
      if (nightPosts.length === 0) continue;
      const post = nightPosts[i % nightPosts.length]!;
      const requiredGender = normalizeRequiredGender(siteGenderRules, "night");
      slots.push({
        siteId,
        postId: post.id,
        date: new Date(day),
        dateKey,
        shiftType: "night",
        requiredGender,
        difficultyScore: slotDifficulty(requiredGender, requiredNight > nightPosts.length),
      });
    }
  }

  return { slots, warnings };
}

function shiftsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Count consecutive calendar days worked immediately before dayIndex. */
export function getConsecutiveWorkDaysBefore(
  workedDateKeys: Set<string>,
  calendarDays: Date[],
  dayIndex: number
): number {
  let count = 0;
  for (let i = dayIndex - 1; i >= 0; i--) {
    if (!workedDateKeys.has(formatDateKey(calendarDays[i]!))) break;
    count++;
  }
  return count;
}

/** True if assigning slot.shiftType on dateKey would break human rest rules. */
export function wouldViolateRestRules(params: {
  slot: Pick<RosterDemandSlot, "dateKey" | "shiftType">;
  runtime: GuardRuntimeState;
  prevDateKey: string | null;
  calendarDays: Date[];
  dayIndex: number;
}): boolean {
  const { slot, runtime, prevDateKey, calendarDays, dayIndex } = params;
  const { dateKey, shiftType } = slot;

  const existingSameDay = runtime.shiftTypeByDateKey.get(dateKey);
  if (existingSameDay != null && existingSameDay !== shiftType) {
    return true;
  }

  if (
    shiftType === "day" &&
    prevDateKey != null &&
    runtime.shiftTypeByDateKey.get(prevDateKey) === "night"
  ) {
    return true;
  }

  if (
    getConsecutiveWorkDaysBefore(runtime.workedDateKeys, calendarDays, dayIndex) >=
    MAX_CONSECUTIVE_WORK_DAYS
  ) {
    return true;
  }

  return false;
}

/** Hard eligibility rules for assigning a guard to a demand slot. */
export function isGuardEligibleForSlot(params: {
  guard: GuardCandidate;
  slot: RosterDemandSlot;
  siteGenderRules: SiteGenderRules;
  postShiftType: string | null | undefined;
  siteAssignedGuardIds: Set<string>;
  existingShifts: { employeeId: string; startTime: Date; endTime: Date }[];
  runtime: GuardRuntimeState;
  shiftStart: Date;
  shiftEnd: Date;
  calendarDays: Date[];
  dayIndex: number;
  prevDateKey: string | null;
}): boolean {
  const {
    guard,
    slot,
    siteGenderRules,
    postShiftType,
    siteAssignedGuardIds,
    existingShifts,
    runtime,
    shiftStart,
    shiftEnd,
    calendarDays,
    dayIndex,
    prevDateKey,
  } = params;

  if ((guard.employeeType ?? "security") !== "security") return false;
  if (!ROSTERABLE_STATUSES.includes(guard.status as (typeof ROSTERABLE_STATUSES)[number])) {
    return false;
  }
  if (!siteAssignedGuardIds.has(guard.id)) return false;

  const postKind = (postShiftType ?? "day").toLowerCase() === "night" ? "night" : "day";
  if (postKind !== slot.shiftType) return false;

  if (!meetsSiteShiftGenderRule(guard.gender, siteGenderRules, postShiftType)) {
    return false;
  }

  if (
    existingShifts.some(
      (s) =>
        s.employeeId === guard.id &&
        shiftsOverlap(shiftStart, shiftEnd, s.startTime, s.endTime)
    )
  ) {
    return false;
  }

  if (runtime.planned.some((p) => shiftsOverlap(shiftStart, shiftEnd, p.start, p.end))) {
    return false;
  }

  if (wouldViolateRestRules({ slot, runtime, prevDateKey, calendarDays, dayIndex })) {
    return false;
  }

  return true;
}

/** Score a guard for a demand slot (lower is better). */
export function scoreGuardForDemandSlot(params: {
  guard: GuardCandidate;
  slot: RosterDemandSlot;
  date: Date;
  stats: GuardStats;
  targets: FairnessTargets;
  preference: ShiftPreference;
  assignedToPost: boolean;
  workedPreviousDay: boolean;
}): number {
  const { guard, slot, date, stats, targets, preference, assignedToPost, workedPreviousDay } =
    params;

  let score = scoreGuardForSlot(stats, slot.shiftType, date, targets, preference);

  if (assignedToPost) score += SCORE_ASSIGNED_TO_POST;
  if (preference === slot.shiftType) score += SCORE_PREFERENCE_MATCH;
  if (workedPreviousDay) score += SCORE_WORKED_PREVIOUS_DAY;
  if (guard.status === "reliever") score += SCORE_RELIEVER;

  return score;
}

export type RosterReadinessDiagnostic = {
  code: string;
  level: "ok" | "warning" | "error";
  message: string;
};

/** Pre-flight readiness from loaded site data (no extra DB). */
export function buildRosterReadinessDiagnostics(params: {
  dayPostCount: number;
  nightPostCount: number;
  staffing: ShiftStaffingRequirements;
  rosterableGuardCount: number;
  relieverCount: number;
  guardsMissingGender: number;
  hasRestrictiveGenderRules: boolean;
}): RosterReadinessDiagnostic[] {
  const {
    dayPostCount,
    nightPostCount,
    staffing,
    rosterableGuardCount,
    relieverCount,
    guardsMissingGender,
    hasRestrictiveGenderRules,
  } = params;
  const diagnostics: RosterReadinessDiagnostic[] = [];
  const minNeeded = Math.max(staffing.day, staffing.night);

  if (dayPostCount > 0) {
    diagnostics.push({
      code: "OK_DAY_POSTS_EXIST",
      level: "ok",
      message: `${dayPostCount} day post(s) configured.`,
    });
  }

  if (nightPostCount === 0) {
    diagnostics.push({
      code: "ERROR_MISSING_NIGHT_POSTS",
      level: "error",
      message: "No night post on this site. Night demand slots cannot be filled.",
    });
  }

  if (staffing.day > dayPostCount && dayPostCount > 0) {
    diagnostics.push({
      code: "WARNING_STAFFING_EXCEEDS_POSTS",
      level: "warning",
      message: `Day staffing (${staffing.day}) exceeds day posts (${dayPostCount}); posts will rotate.`,
    });
  }

  if (nightPostCount > 0 && staffing.night > nightPostCount) {
    diagnostics.push({
      code: "WARNING_STAFFING_EXCEEDS_POSTS",
      level: "warning",
      message: `Night staffing (${staffing.night}) exceeds night posts (${nightPostCount}); posts will rotate.`,
    });
  }

  if (guardsMissingGender > 0 && hasRestrictiveGenderRules) {
    diagnostics.push({
      code: "WARNING_GUARDS_WITH_MISSING_GENDER",
      level: "warning",
      message: `${guardsMissingGender} guard(s) have no gender on profile; may be ineligible under site gender rules.`,
    });
  }

  if (rosterableGuardCount < minNeeded) {
    diagnostics.push({
      code: "ERROR_INSUFFICIENT_ROSTERABLE_GUARDS",
      level: "error",
      message: `Need at least ${minNeeded} rosterable guard(s) for ${staffing.day} day and ${staffing.night} night per day; ${rosterableGuardCount} assigned.`,
    });
  }

  if (staffing.day > 0 && staffing.night > 0 && rosterableGuardCount < staffing.day + staffing.night) {
    diagnostics.push({
      code: "WARNING_STRICT_REST_STAFFING",
      level: "warning",
      message: `Strict rest rules require one guard per shift per day (no day+night same day). For ${staffing.day} day and ${staffing.night} night slots you may need ${staffing.day + staffing.night}+ rosterable guards; ${rosterableGuardCount} assigned.`,
    });
  }

  if (relieverCount > 0) {
    diagnostics.push({
      code: "WARNING_RELIEVERS_WILL_BE_USED",
      level: "warning",
      message: `${relieverCount} reliever(s) on site; regular guards are preferred, relievers used as fallback.`,
    });
  }

  return diagnostics;
}

export function countPatternBreaksForEntries(
  entries: { employeeId: string; startTime: string; shiftType: "day" | "night" }[],
  preferenceGrid: Map<string, Map<string, ShiftPreference>>
): number {
  let breaks = 0;
  for (const entry of entries) {
    const dateKey = entry.startTime.slice(0, 10);
    const pref = preferenceGrid.get(entry.employeeId)?.get(dateKey) ?? "off";
    if (pref !== entry.shiftType) breaks++;
  }
  return breaks;
}

export function pickBestGuardForDemandSlot(params: {
  candidates: GuardCandidate[];
  slot: RosterDemandSlot;
  date: Date;
  dayIndex: number;
  statsByGuard: Map<string, GuardStats>;
  runtimeByGuard: Map<string, GuardRuntimeState>;
  targets: FairnessTargets;
  preferenceGrid: Map<string, Map<string, ShiftPreference>>;
  postAssignedGuardIds: Set<string>;
  prevDateKey: string | null;
}): GuardCandidate | null {
  const {
    candidates,
    slot,
    date,
    dayIndex,
    statsByGuard,
    runtimeByGuard,
    targets,
    preferenceGrid,
    postAssignedGuardIds,
    prevDateKey,
  } = params;

  const dateKey = slot.dateKey;

  const patternAligned = candidates.filter(
    (g) => (preferenceGrid.get(g.id)?.get(dateKey) ?? "off") === slot.shiftType
  );
  if (patternAligned.length === 0) return null;

  const ranked = [...patternAligned].sort((a, b) => {
    const statsA = statsByGuard.get(a.id)!;
    const statsB = statsByGuard.get(b.id)!;
    const prefA = preferenceGrid.get(a.id)?.get(dateKey) ?? "off";
    const prefB = preferenceGrid.get(b.id)?.get(dateKey) ?? "off";
    const runtimeA = runtimeByGuard.get(a.id)!;
    const runtimeB = runtimeByGuard.get(b.id)!;
    const workedPrevA = prevDateKey != null && runtimeA.workedDateKeys.has(prevDateKey);
    const workedPrevB = prevDateKey != null && runtimeB.workedDateKeys.has(prevDateKey);
    const scoreA = scoreGuardForDemandSlot({
      guard: a,
      slot,
      date,
      stats: statsA,
      targets,
      preference: prefA,
      assignedToPost: postAssignedGuardIds.has(a.id),
      workedPreviousDay: workedPrevA,
    });
    const scoreB = scoreGuardForDemandSlot({
      guard: b,
      slot,
      date,
      stats: statsB,
      targets,
      preference: prefB,
      assignedToPost: postAssignedGuardIds.has(b.id),
      workedPreviousDay: workedPrevB,
    });
    if (scoreA !== scoreB) return scoreA - scoreB;
    const rotA = (patternAligned.indexOf(a) + dayIndex) % patternAligned.length;
    const rotB = (patternAligned.indexOf(b) + dayIndex) % patternAligned.length;
    return rotA - rotB;
  });

  return ranked[0] ?? null;
}

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
