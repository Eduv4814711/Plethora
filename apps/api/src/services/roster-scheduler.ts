import { addDays, differenceInCalendarDays, getDay } from "date-fns";
import { meetsSiteShiftGenderRule, type CustomBlock } from "./rostering.service.js";
import {
  countCoveredDays,
  daysWithAnyCoverage,
  isShiftCoveredOn,
  resolveSiteCoverageDays,
  type SiteCoverageDays,
} from "../lib/site-coverage-days.js";

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

/** Max consecutive day shifts before a rest day or shift-type change is required. */
export const MAX_CONSECUTIVE_DAY_SHIFTS = 3;

/** Max consecutive night shifts before a rest day or shift-type change is required. */
export const MAX_CONSECUTIVE_NIGHT_SHIFTS = 3;

/** Default consecutive same-shift caps used by the fair roster engine. */
export function defaultMaxConsecutiveSameShift(): { day: number; night: number } {
  return { day: MAX_CONSECUTIVE_DAY_SHIFTS, night: MAX_CONSECUTIVE_NIGHT_SHIFTS };
}

const ROSTERABLE_STATUSES = ["active", "training", "hired", "reliever"] as const;

const SCORE_ASSIGNED_TO_POST = -8;
const SCORE_WORKED_PREVIOUS_DAY = 6;
const SCORE_RELIEVER = 10;
/** Penalise extending an existing run of the same shift type (discourages long night blocks). */
const SCORE_CONSECUTIVE_SAME_SHIFT = 5;
/** Prefer guards whose auto-rotation pattern matches this slot. */
const SCORE_PATTERN_MATCH = -14;
/** Penalise assigning when the guard's pattern says off (fallback only). */
const SCORE_PATTERN_OFF_DAY = 10;
/** Penalise assigning the opposite shift type to the pattern. */
const SCORE_PATTERN_WRONG_TYPE = 22;

/**
 * Fairness weights (lower score = preferred guard).
 * - W_DAY / W_NIGHT: distance from the per-guard demand target for that shift type.
 * - W_DAY_NIGHT_BALANCE: penalises guards already heavy on the slot shift type vs the other.
 * - W_TOTAL: distance from the per-guard total workload target.
 * - W_OFF / W_SUNDAY / W_WEEKEND: spread rest and weekend work evenly.
 */
const W_DAY = 16;
const W_NIGHT = 16;
const W_TOTAL = 8;
const W_OFF = 4;
const W_SUNDAY = 12;
const W_WEEKEND = 6;
const W_DAY_NIGHT_BALANCE = 24;
const PREFERENCE_BONUS = 2;

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

/** Build required day/night demand slots from posts, staffing, gender rules, and weekday cover. */
export function buildSiteDemandSlots(params: {
  siteId: string;
  calendarDays: Date[];
  dayPosts: { id: string }[];
  nightPosts: { id: string }[];
  staffing: ShiftStaffingRequirements;
  siteGenderRules: SiteGenderRules;
  /** Weekdays each shift needs cover. Omit for the legacy seven-day-a-week behaviour. */
  coverageDays?: SiteCoverageDays;
}): { slots: RosterDemandSlot[]; warnings: DemandSlotWarning[] } {
  const { siteId, calendarDays, dayPosts, nightPosts, staffing, siteGenderRules } = params;
  const coverageDays = params.coverageDays ?? resolveSiteCoverageDays({});
  const warnings: DemandSlotWarning[] = [];
  const slots: RosterDemandSlot[] = [];

  const requiredDay = coverageDays.day.size > 0 ? staffing.day : 0;
  const requiredNight = coverageDays.night.size > 0 ? staffing.night : 0;

  if (requiredDay > 0 && dayPosts.length === 0) {
    warnings.push({
      code: "MISSING_DAY_POSTS",
      message: "Site has no day post. Add a day post to fill day shift demand slots.",
    });
  }

  if (requiredNight > 0 && nightPosts.length === 0) {
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
    const needsDay = isShiftCoveredOn(coverageDays, "day", day);
    const needsNight = isShiftCoveredOn(coverageDays, "night", day);

    for (let i = 0; needsDay && i < requiredDay; i++) {
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
        difficultyScore:
          slotDifficulty(requiredGender, requiredDay > dayPosts.length) + i * 8,
      });
    }

    for (let i = 0; needsNight && i < requiredNight; i++) {
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
        difficultyScore:
          slotDifficulty(requiredGender, requiredNight > nightPosts.length) + i * 8,
      });
    }
  }

  return { slots, warnings };
}

function shiftsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Longest day and night blocks in the selected pattern (e.g. 3D3N3O → 3 each). */
export function maxConsecutiveShiftTypeInPattern(
  pattern: RosterDualPattern,
  customBlocks?: CustomBlock[]
): { day: number; night: number } {
  const blocks = patternBlocks(pattern, customBlocks);
  let maxDay = 0;
  let maxNight = 0;
  let curDay = 0;
  let curNight = 0;
  for (const block of blocks) {
    if (block.type === "day") {
      curDay += block.count;
      maxDay = Math.max(maxDay, curDay);
      curNight = 0;
    } else if (block.type === "night") {
      curNight += block.count;
      maxNight = Math.max(maxNight, curNight);
      curDay = 0;
    } else {
      curDay = 0;
      curNight = 0;
    }
  }
  return { day: Math.max(maxDay, 1), night: Math.max(maxNight, 1) };
}

/** Count consecutive calendar days of the same shift type immediately before dayIndex. */
export function getConsecutiveSameShiftTypeBefore(
  shiftTypeByDateKey: Map<string, "day" | "night">,
  calendarDays: Date[],
  dayIndex: number,
  shiftType: "day" | "night"
): number {
  let count = 0;
  for (let i = dayIndex - 1; i >= 0; i--) {
    if (shiftTypeByDateKey.get(formatDateKey(calendarDays[i]!)) !== shiftType) break;
    count++;
  }
  return count;
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

/** Shift date key (yyyy-MM-dd) plus or minus calendar days (UTC calendar). */
export function addCalendarDayToDateKey(dateKey: string, deltaDays: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  return formatDateKey(addDays(d, deltaDays));
}

/**
 * Adjacent-day rest rules between day and night shifts.
 * - No day + night on the same calendar day.
 * - No day shift immediately after a night shift (night ends ~06:00, day starts ~06:00).
 * Day → night on consecutive days is allowed (needed for 3D-3N-3O block transitions; full rest between).
 */
export function violatesAdjacentShiftRestRules(
  assignmentsByDate: Map<string, "day" | "night">,
  candidate: { dateKey: string; shiftType: "day" | "night" }
): boolean {
  const { dateKey, shiftType } = candidate;

  const existingSameDay = assignmentsByDate.get(dateKey);
  if (existingSameDay != null && existingSameDay !== shiftType) {
    return true;
  }

  const prevDateKey = addCalendarDayToDateKey(dateKey, -1);
  if (shiftType === "day" && assignmentsByDate.get(prevDateKey) === "night") {
    return true;
  }

  const nextDateKey = addCalendarDayToDateKey(dateKey, 1);
  if (shiftType === "night" && assignmentsByDate.get(nextDateKey) === "day") {
    return true;
  }

  return false;
}

/** Human-readable label for rotation blocks, e.g. 3D-3N-3O. */
export function formatRotationPatternLabel(blocks: CustomBlock[]): string {
  return blocks
    .map((b) => {
      const letter = b.type === "day" ? "D" : b.type === "night" ? "N" : "O";
      return `${b.count}${letter}`;
    })
    .join("-");
}

/**
 * Derive repeating day/night/off blocks from guard count and site staffing.
 * Equal staffing with few guards → block rotation (3D-3N-3O for 3 guards).
 * Unequal staffing → proportional mini-cycle (e.g. 1D-2N-2O for 5 guards at 1+2/day).
 */
export function deriveSiteRotationBlocks(
  guardCount: number,
  staffing: ShiftStaffingRequirements
): CustomBlock[] {
  if (guardCount <= 0) return [];

  const hasDay = staffing.day > 0;
  const hasNight = staffing.night > 0;

  if (hasDay && hasNight) {
    const workersPerDay = staffing.day + staffing.night;
    if (guardCount > workersPerDay) {
      if (staffing.day === staffing.night) {
        const block = guardCount <= 6 ? guardCount : 3;
        return [
          { type: "day", count: block },
          { type: "night", count: block },
          { type: "off", count: block },
        ];
      }
      const offPerCycle = guardCount - workersPerDay;
      const blocks: CustomBlock[] = [];
      if (staffing.day > 0) blocks.push({ type: "day", count: staffing.day });
      if (staffing.night > 0) blocks.push({ type: "night", count: staffing.night });
      if (offPerCycle > 0) blocks.push({ type: "off", count: offPerCycle });
      return blocks;
    }
    const block = Math.max(1, Math.min(3, guardCount));
    const blocks: CustomBlock[] = [
      { type: "day", count: block },
      { type: "night", count: block },
    ];
    if (guardCount > workersPerDay) {
      blocks.push({ type: "off", count: block });
    }
    return blocks;
  }

  if (hasDay) {
    const block = Math.max(1, Math.min(guardCount, 3));
    return [
      { type: "day", count: block },
      { type: "off", count: block },
    ];
  }

  if (hasNight) {
    const block = Math.max(1, Math.min(guardCount, 3));
    return [
      { type: "night", count: block },
      { type: "off", count: block },
    ];
  }

  return [];
}

export type SiteRotationPlan = {
  blocks: CustomBlock[];
  patternLabel: string;
  staggerOffsets: Map<string, number>;
  preferenceGrid: Map<string, Map<string, ShiftPreference>>;
  targets: FairnessTargets;
  maxConsecutiveSameShift: { day: number; night: number };
};

/** Build staggered preference grid and fairness targets for a site's auto-rotation. */
export function buildSiteRotationPlan(params: {
  guardIds: string[];
  calendarDays: Date[];
  staffing: ShiftStaffingRequirements;
  blocks: CustomBlock[];
  coreGuardIds?: string[];
}): SiteRotationPlan | null {
  const { guardIds, calendarDays, staffing, blocks, coreGuardIds } = params;
  if (guardIds.length === 0 || calendarDays.length === 0 || blocks.length === 0) return null;

  const rotatingIds =
    coreGuardIds && coreGuardIds.length > 0
      ? coreGuardIds.filter((id) => guardIds.includes(id))
      : guardIds;
  if (rotatingIds.length === 0) return null;

  const cycleLength = blocks.reduce((sum, b) => sum + b.count, 0);
  if (cycleLength <= 0) return null;

  const blockCounts = blocks.map((b) => b.count);
  const equalBlockRotation =
    blockCounts.length >= 2 && blockCounts.every((c) => c === blockCounts[0]);
  const offsetList =
    equalBlockRotation && staffing.day === staffing.night
      ? Array.from({ length: rotatingIds.length }, (_, i) =>
          Math.floor((i * cycleLength) / rotatingIds.length)
        )
      : computeStaggerOffsets(rotatingIds.length, cycleLength, {
          pattern: "custom_builder",
          customBlocks: blocks,
          staffing,
        });
  const staggerOffsets = new Map<string, number>();
  for (const id of guardIds) {
    const idx = rotatingIds.indexOf(id);
    staggerOffsets.set(id, idx >= 0 ? (offsetList[idx] ?? 0) : 0);
  }
  const preferenceGrid = buildPatternPreferenceGrid({
    guardIds: rotatingIds,
    calendarDays,
    patternStartDate: calendarDays[0]!,
    pattern: "custom_builder",
    customBlocks: blocks,
    staggerOffsets,
  });

  return {
    blocks,
    patternLabel: formatRotationPatternLabel(blocks),
    staggerOffsets,
    preferenceGrid,
    targets: computePatternFairnessTargets(rotatingIds, calendarDays, preferenceGrid),
    maxConsecutiveSameShift: maxConsecutiveShiftTypeInPattern("custom_builder", blocks),
  };
}

function scorePatternPreference(
  preference: ShiftPreference | undefined,
  shiftType: "day" | "night"
): number {
  if (preference === shiftType) return SCORE_PATTERN_MATCH;
  if (preference === "off") return SCORE_PATTERN_OFF_DAY;
  if (preference === "day" || preference === "night") return SCORE_PATTERN_WRONG_TYPE;
  return 0;
}

/** True if assigning slot.shiftType on dateKey would break human rest rules. */
export function wouldViolateRestRules(params: {
  slot: Pick<RosterDemandSlot, "dateKey" | "shiftType">;
  runtime: GuardRuntimeState;
  prevDateKey: string | null;
  calendarDays: Date[];
  dayIndex: number;
  /** From pattern blocks; caps consecutive day/night runs (e.g. 3 for 3D3N3O). */
  maxConsecutiveSameShift?: { day: number; night: number };
}): boolean {
  const { slot, runtime, calendarDays, dayIndex, maxConsecutiveSameShift } = params;
  const { dateKey, shiftType } = slot;

  if (
    violatesAdjacentShiftRestRules(runtime.shiftTypeByDateKey, {
      dateKey,
      shiftType,
    })
  ) {
    return true;
  }

  if (
    getConsecutiveWorkDaysBefore(runtime.workedDateKeys, calendarDays, dayIndex) >=
    MAX_CONSECUTIVE_WORK_DAYS
  ) {
    return true;
  }

  const defaults = defaultMaxConsecutiveSameShift();
  const maxSame =
    shiftType === "day"
      ? (maxConsecutiveSameShift?.day ?? defaults.day)
      : (maxConsecutiveSameShift?.night ?? defaults.night);
  if (
    getConsecutiveSameShiftTypeBefore(
      runtime.shiftTypeByDateKey,
      calendarDays,
      dayIndex,
      shiftType
    ) >= maxSame
  ) {
    return true;
  }

  return false;
}

/** Human-readable reasons why a guard cannot take a demand slot (empty = eligible). */
export function explainGuardIneligibilityForSlot(params: {
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
  maxConsecutiveSameShift?: { day: number; night: number };
  assignedEmployeeIdsForDate?: Set<string>;
  /** yyyy-MM-dd keys when the guard is on approved leave (not available for work). */
  leaveDateKeysByEmployee?: Map<string, Set<string>>;
}): string[] {
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
    maxConsecutiveSameShift,
    assignedEmployeeIdsForDate,
    leaveDateKeysByEmployee,
  } = params;
  const reasons: string[] = [];

  if (leaveDateKeysByEmployee?.get(guard.id)?.has(slot.dateKey)) {
    reasons.push("on leave (not available for work)");
  }
  if (assignedEmployeeIdsForDate?.has(guard.id)) {
    reasons.push("already assigned a shift on this date");
  }
  if ((guard.employeeType ?? "security") !== "security") {
    reasons.push("not a security employee");
  }
  if (!ROSTERABLE_STATUSES.includes(guard.status as (typeof ROSTERABLE_STATUSES)[number])) {
    reasons.push(`status is ${guard.status}`);
  }
  if (!siteAssignedGuardIds.has(guard.id)) {
    reasons.push("not assigned to this site");
  }

  const postKind = (postShiftType ?? "day").toLowerCase() === "night" ? "night" : "day";
  if (postKind !== slot.shiftType) {
    reasons.push(`post is ${postKind} but slot needs ${slot.shiftType}`);
  }

  if (!meetsSiteShiftGenderRule(guard.gender, siteGenderRules, postShiftType)) {
    reasons.push("does not meet site gender rule for this shift");
  }

  if (
    existingShifts.some(
      (s) =>
        s.employeeId === guard.id &&
        shiftsOverlap(shiftStart, shiftEnd, s.startTime, s.endTime)
    )
  ) {
    reasons.push("overlaps an existing shift at another site");
  }

  if (runtime.planned.some((p) => shiftsOverlap(shiftStart, shiftEnd, p.start, p.end))) {
    reasons.push("overlaps another shift in this plan");
  }

  const restMap = runtime.shiftTypeByDateKey;
  if (restMap.get(slot.dateKey) != null && restMap.get(slot.dateKey) !== slot.shiftType) {
    reasons.push("rest: cannot work day and night on the same date");
  }
  const prevKey = addCalendarDayToDateKey(slot.dateKey, -1);
  if (slot.shiftType === "day" && restMap.get(prevKey) === "night") {
    reasons.push("rest: cannot work day immediately after a night shift");
  }
  const nextKey = addCalendarDayToDateKey(slot.dateKey, 1);
  if (slot.shiftType === "night" && restMap.get(nextKey) === "day") {
    reasons.push("rest: cannot work night when the next day is already a day shift");
  }

  if (
    getConsecutiveWorkDaysBefore(runtime.workedDateKeys, calendarDays, dayIndex) >=
    MAX_CONSECUTIVE_WORK_DAYS
  ) {
    reasons.push(`rest: ${MAX_CONSECUTIVE_WORK_DAYS} consecutive work days reached`);
  }

  const defaults = defaultMaxConsecutiveSameShift();
  const maxSame =
    slot.shiftType === "day"
      ? (maxConsecutiveSameShift?.day ?? defaults.day)
      : (maxConsecutiveSameShift?.night ?? defaults.night);
  const consecutiveSame = getConsecutiveSameShiftTypeBefore(
    restMap,
    calendarDays,
    dayIndex,
    slot.shiftType
  );
  if (consecutiveSame >= maxSame) {
    reasons.push(`rest: ${maxSame} consecutive ${slot.shiftType} shifts reached`);
  }

  return reasons;
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
  maxConsecutiveSameShift?: { day: number; night: number };
  /** Guards already assigned any shift on this calendar day (one shift per guard per day). */
  assignedEmployeeIdsForDate?: Set<string>;
  /** yyyy-MM-dd keys when the guard is on approved leave (not available for work). */
  leaveDateKeysByEmployee?: Map<string, Set<string>>;
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
    maxConsecutiveSameShift,
    assignedEmployeeIdsForDate,
    leaveDateKeysByEmployee,
  } = params;

  if (leaveDateKeysByEmployee?.get(guard.id)?.has(slot.dateKey)) return false;
  if (assignedEmployeeIdsForDate?.has(guard.id)) return false;

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

  if (
    wouldViolateRestRules({
      slot,
      runtime,
      prevDateKey,
      calendarDays,
      dayIndex,
      maxConsecutiveSameShift,
    })
  ) {
    return false;
  }

  return true;
}

/**
 * How far assigning shiftType would widen this guard's day/night gap.
 * Lower is better — the engine aims for roughly equal day and night counts per guard.
 */
export function dayNightBalanceDelta(
  stats: GuardStats,
  shiftType: "day" | "night"
): number {
  const imbalance = stats.dayCount - stats.nightCount;
  return shiftType === "day" ? imbalance : -imbalance;
}

/**
 * Fairness score for assigning a guard to a demand slot (lower is better).
 *
 * The engine picks the eligible guard with the lowest score. Terms:
 * 1. Shift-type target — (currentCount − target) × W_DAY|W_NIGHT for the slot type.
 * 2. Day/night balance — dayNightBalanceDelta × W_DAY_NIGHT_BALANCE (equal day/night per guard).
 * 3. Total workload — (dayCount + nightCount − targetDay − targetNight) × W_TOTAL.
 * 4. Rest/weekend spread — off, Sunday, and weekend distance from targets.
 * 5. Safety — worked previous day, consecutive same-shift run.
 * 6. Pattern — bonus when slot matches the guard's auto-rotation preference.
 * 7. Operations — post assignment bonus, reliever penalty.
 */
export function scoreGuardFairness(params: {
  guard: GuardCandidate;
  slot: RosterDemandSlot;
  date: Date;
  stats: GuardStats;
  targets: FairnessTargets;
  assignedToPost: boolean;
  workedPreviousDay: boolean;
  staffing: ShiftStaffingRequirements;
  consecutiveSameShiftBefore: number;
  patternPreference?: ShiftPreference;
}): number {
  const {
    guard,
    slot,
    date,
    stats,
    targets,
    assignedToPost,
    workedPreviousDay,
    consecutiveSameShiftBefore,
    patternPreference,
  } = params;

  let score = 0;

  if (slot.shiftType === "day") {
    score += (stats.dayCount - targets.targetDay) * W_DAY;
  } else {
    score += (stats.nightCount - targets.targetNight) * W_NIGHT;
  }

  score += dayNightBalanceDelta(stats, slot.shiftType) * W_DAY_NIGHT_BALANCE;

  const totalWorked = stats.dayCount + stats.nightCount;
  const targetTotal = targets.targetDay + targets.targetNight;
  score += (totalWorked - targetTotal) * W_TOTAL;

  score += (targets.targetOff - stats.offCount) * W_OFF;

  const dow = getDay(date);
  if (dow === 0) {
    score += (stats.sundayCount - targets.targetSunday) * W_SUNDAY;
  }
  if (dow === 0 || dow === 6) {
    score += (stats.weekendCount - targets.targetWeekend) * W_WEEKEND;
  }

  if (assignedToPost) score += SCORE_ASSIGNED_TO_POST;
  if (workedPreviousDay) score += SCORE_WORKED_PREVIOUS_DAY;
  if (guard.status === "reliever") score += SCORE_RELIEVER;
  score += consecutiveSameShiftBefore * SCORE_CONSECUTIVE_SAME_SHIFT;
  score += scorePatternPreference(patternPreference, slot.shiftType);

  return score;
}

/** @deprecated Use scoreGuardFairness. Kept for legacy single-guard pattern tests. */
export function scoreGuardForDemandSlot(params: {
  guard: GuardCandidate;
  slot: RosterDemandSlot;
  date: Date;
  stats: GuardStats;
  targets: FairnessTargets;
  preference: ShiftPreference;
  assignedToPost: boolean;
  workedPreviousDay: boolean;
  staffing: ShiftStaffingRequirements;
  consecutiveSameShiftBefore: number;
}): number {
  return scoreGuardFairness({
    guard: params.guard,
    slot: params.slot,
    date: params.date,
    stats: params.stats,
    targets: params.targets,
    assignedToPost: params.assignedToPost,
    workedPreviousDay: params.workedPreviousDay,
    staffing: params.staffing,
    consecutiveSameShiftBefore: params.consecutiveSameShiftBefore,
    patternPreference: params.preference,
  });
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
  } else if (staffing.day > 0) {
    diagnostics.push({
      code: "ERROR_MISSING_DAY_POSTS",
      level: "error",
      message: "No day post on this site. Day demand slots cannot be filled.",
    });
  }

  if (nightPostCount > 0) {
    diagnostics.push({
      code: "OK_NIGHT_POSTS_EXIST",
      level: "ok",
      message: `${nightPostCount} night post(s) configured.`,
    });
  } else if (staffing.night > 0) {
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

/**
 * Pick the fairest eligible guard for a demand slot.
 * Narrows to guards within +1 of the minimum count for the slot shift type, then scores by fairness.
 */
export function pickBestGuardForDemandSlot(params: {
  candidates: GuardCandidate[];
  slot: RosterDemandSlot;
  date: Date;
  dayIndex: number;
  statsByGuard: Map<string, GuardStats>;
  runtimeByGuard: Map<string, GuardRuntimeState>;
  targets: FairnessTargets;
  postAssignedGuardIds: Set<string>;
  prevDateKey: string | null;
  staffing: ShiftStaffingRequirements;
  calendarDays: Date[];
  preferenceGrid?: Map<string, Map<string, ShiftPreference>>;
}): GuardCandidate | null {
  const {
    candidates,
    slot,
    date,
    dayIndex,
    statsByGuard,
    runtimeByGuard,
    targets,
    postAssignedGuardIds,
    prevDateKey,
    staffing,
    calendarDays,
    preferenceGrid,
  } = params;

  if (candidates.length === 0) return null;

  const dateKey = formatDateKey(date);
  let pool = [...candidates];

  if (preferenceGrid && pool.length > 1) {
    const patternAligned = pool.filter(
      (g) => preferenceGrid.get(g.id)?.get(dateKey) === slot.shiftType
    );
    if (patternAligned.length > 0) pool = patternAligned;
  }

  if (pool.length > 1) {
    const typeKey = slot.shiftType === "day" ? "dayCount" : "nightCount";
    const counts = pool.map((g) => statsByGuard.get(g.id)?.[typeKey] ?? 0);
    const minCount = Math.min(...counts);
    const narrowed = pool.filter(
      (g) => (statsByGuard.get(g.id)?.[typeKey] ?? 0) <= minCount + 1
    );
    if (narrowed.length > 0) pool = narrowed;
  }

  if (pool.length > 1) {
    const balanceScores = pool.map((g) =>
      dayNightBalanceDelta(statsByGuard.get(g.id)!, slot.shiftType)
    );
    const minBalance = Math.min(...balanceScores);
    const narrowedByBalance = pool.filter(
      (_, i) => balanceScores[i]! <= minBalance + 1
    );
    if (narrowedByBalance.length > 0) pool = narrowedByBalance;
  }

  const rotationIndex = new Map(pool.map((g, i) => [g.id, i]));

  const ranked = [...pool].sort((a, b) => {
    const statsA = statsByGuard.get(a.id)!;
    const statsB = statsByGuard.get(b.id)!;
    const runtimeA = runtimeByGuard.get(a.id)!;
    const runtimeB = runtimeByGuard.get(b.id)!;
    const workedPrevA = prevDateKey != null && runtimeA.workedDateKeys.has(prevDateKey);
    const workedPrevB = prevDateKey != null && runtimeB.workedDateKeys.has(prevDateKey);
    const consecA = getConsecutiveSameShiftTypeBefore(
      runtimeA.shiftTypeByDateKey,
      calendarDays,
      dayIndex,
      slot.shiftType
    );
    const consecB = getConsecutiveSameShiftTypeBefore(
      runtimeB.shiftTypeByDateKey,
      calendarDays,
      dayIndex,
      slot.shiftType
    );
    const scoreA = scoreGuardFairness({
      guard: a,
      slot,
      date,
      stats: statsA,
      targets,
      assignedToPost: postAssignedGuardIds.has(a.id),
      workedPreviousDay: workedPrevA,
      staffing,
      consecutiveSameShiftBefore: consecA,
      patternPreference: preferenceGrid?.get(a.id)?.get(dateKey),
    });
    const scoreB = scoreGuardFairness({
      guard: b,
      slot,
      date,
      stats: statsB,
      targets,
      assignedToPost: postAssignedGuardIds.has(b.id),
      workedPreviousDay: workedPrevB,
      staffing,
      consecutiveSameShiftBefore: consecB,
      patternPreference: preferenceGrid?.get(b.id)?.get(dateKey),
    });
    if (scoreA !== scoreB) return scoreA - scoreB;

    const balA = dayNightBalanceDelta(statsA, slot.shiftType);
    const balB = dayNightBalanceDelta(statsB, slot.shiftType);
    if (balA !== balB) return balA - balB;

    const typeCountA = slot.shiftType === "day" ? statsA.dayCount : statsA.nightCount;
    const typeCountB = slot.shiftType === "day" ? statsB.dayCount : statsB.nightCount;
    if (typeCountA !== typeCountB) return typeCountA - typeCountB;

    const totalA = statsA.dayCount + statsA.nightCount;
    const totalB = statsB.dayCount + statsB.nightCount;
    if (totalA !== totalB) return totalA - totalB;

    const rotA = ((rotationIndex.get(a.id) ?? 0) + dayIndex) % pool.length;
    const rotB = ((rotationIndex.get(b.id) ?? 0) + dayIndex) % pool.length;
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
  /** Max |dayCount − nightCount| across guards. */
  maxDayNightImbalance: number;
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

/** Evenly space guard phase offsets (legacy fallback). */
function defaultStaggerOffsets(guardCount: number, cycleLength: number): number[] {
  if (guardCount <= 0 || cycleLength <= 0) return [];
  return Array.from({ length: guardCount }, (_, i) =>
    Math.floor((i * cycleLength) / guardCount)
  );
}

function phaseCountsForOffsets(
  offsets: number[],
  cycleLength: number,
  pattern: RosterDualPattern,
  customBlocks?: CustomBlock[]
): { minDay: number; minNight: number; nightPerGuard: number[] } {
  let minDay = Infinity;
  let minNight = Infinity;
  const nightPerGuard = offsets.map(() => 0);
  for (let t = 0; t < cycleLength; t++) {
    let day = 0;
    let night = 0;
    for (let i = 0; i < offsets.length; i++) {
      const pref = getPatternShiftAtOffset(t + offsets[i]!, pattern, customBlocks);
      if (pref === "day") day++;
      else if (pref === "night") {
        night++;
        nightPerGuard[i]!++;
      }
    }
    minDay = Math.min(minDay, day);
    minNight = Math.min(minNight, night);
  }
  return {
    minDay: minDay === Infinity ? 0 : minDay,
    minNight: minNight === Infinity ? 0 : minNight,
    nightPerGuard,
  };
}

function scoreStaggerAssignment(
  offsets: number[],
  cycleLength: number,
  pattern: RosterDualPattern,
  customBlocks: CustomBlock[] | undefined,
  staffing: ShiftStaffingRequirements
): number {
  const { minDay, minNight, nightPerGuard } = phaseCountsForOffsets(
    offsets,
    cycleLength,
    pattern,
    customBlocks
  );
  let score = minNight * 100 + minDay * 10;
  if (minNight < staffing.night) score -= (staffing.night - minNight) * 1000;
  if (minDay < staffing.day) score -= (staffing.day - minDay) * 1000;
  if (nightPerGuard.length > 0) {
    score -= Math.max(...nightPerGuard) - Math.min(...nightPerGuard);
  }
  return score;
}

/** Search distinct phase offsets when staffing-aware options are provided (guardCount ≤ 12). */
function searchStaggerOffsets(
  guardCount: number,
  cycleLength: number,
  pattern: RosterDualPattern,
  customBlocks: CustomBlock[] | undefined,
  staffing: ShiftStaffingRequirements
): number[] {
  let best = defaultStaggerOffsets(guardCount, cycleLength);
  let bestScore = scoreStaggerAssignment(best, cycleLength, pattern, customBlocks, staffing);

  const chosen: number[] = [];
  function dfs(depth: number, start: number) {
    if (depth === guardCount) {
      const score = scoreStaggerAssignment(chosen, cycleLength, pattern, customBlocks, staffing);
      if (score > bestScore) {
        bestScore = score;
        best = [...chosen];
      }
      return;
    }
    for (let o = start; o < cycleLength; o++) {
      chosen.push(o);
      dfs(depth + 1, o + 1);
      chosen.pop();
    }
  }
  dfs(0, 0);
  return best;
}

export type StaggerOffsetOptions = {
  pattern: RosterDualPattern;
  customBlocks?: CustomBlock[];
  staffing?: ShiftStaffingRequirements;
};

/**
 * Spread guard phases across the pattern cycle.
 * With staffing options, searches distinct offsets to maximise daily phase coverage.
 */
export function computeStaggerOffsets(
  guardCount: number,
  cycleLength: number,
  options?: StaggerOffsetOptions
): number[] {
  if (guardCount <= 0 || cycleLength <= 0) return [];
  if (!options?.pattern || guardCount > 12) {
    return defaultStaggerOffsets(guardCount, cycleLength);
  }
  const staffing = options.staffing ?? { day: 1, night: 1 };
  if (guardCount > cycleLength) {
    return defaultStaggerOffsets(guardCount, cycleLength);
  }
  return searchStaggerOffsets(
    guardCount,
    cycleLength,
    options.pattern,
    options.customBlocks,
    staffing
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
    const byDate = new Map<string, ShiftPreference>();

    for (const day of calendarDays) {
      const dateKey = formatDateKey(day);
      const daysSincePatternStart = differenceInCalendarDays(day, patternStartDate);
      // Offset rotates phase within the shared pattern timeline (e.g. 0/3/6 → day/night/off on same day).
      byDate.set(
        dateKey,
        getPatternShiftAtOffset(daysSincePatternStart + offsetDays, pattern, customBlocks)
      );
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

/** Expected day/night/off counts per guard from the staggered pattern grid. */
export function computePatternFairnessTargets(
  guardIds: string[],
  calendarDays: Date[],
  preferenceGrid: Map<string, Map<string, ShiftPreference>>
): FairnessTargets {
  const g = Math.max(guardIds.length, 1);
  let totalDay = 0;
  let totalNight = 0;
  let totalOff = 0;
  let totalSunday = 0;
  let totalWeekend = 0;

  for (const guardId of guardIds) {
    const prefs = preferenceGrid.get(guardId);
    if (!prefs) continue;
    for (const day of calendarDays) {
      const pref = prefs.get(formatDateKey(day)) ?? "off";
      if (pref === "day") totalDay++;
      else if (pref === "night") totalNight++;
      else totalOff++;

      const dow = getDay(day);
      if (pref !== "off") {
        if (dow === 0) totalSunday++;
        if (dow === 0 || dow === 6) totalWeekend++;
      }
    }
  }

  return {
    targetDay: totalDay / g,
    targetNight: totalNight / g,
    targetOff: totalOff / g,
    targetSunday: totalSunday / g,
    targetWeekend: totalWeekend / g,
  };
}

/** Per-guard fairness targets from site demand and roster period length. */
export function computeFairnessTargets(
  guardCount: number,
  calendarDays: Date[],
  staffing?: ShiftStaffingRequirements,
  /** Weekdays each shift needs cover. Omit for the legacy seven-day-a-week behaviour. */
  coverageDays?: SiteCoverageDays
): FairnessTargets {
  const numDays = calendarDays.length;
  const g = Math.max(guardCount, 1);
  const st = staffing ?? { day: 1, night: 1 };
  const coverage = coverageDays ?? resolveSiteCoverageDays({});

  // Sunday/weekend fairness only counts days the site is actually worked — on a Mon–Fri
  // site nobody works a Sunday, so a non-zero Sunday target would skew every guard's score.
  const { sundayCount, weekendCount } = countSundaysAndWeekends(
    daysWithAnyCoverage(coverage, calendarDays)
  );

  const totalDemand =
    countCoveredDays(coverage, "day", calendarDays) * st.day +
    countCoveredDays(coverage, "night", calendarDays) * st.night;
  const shiftsPerGuard = totalDemand / g;
  const equalTypeTarget = shiftsPerGuard / 2;
  const targetOff = Math.max(0, numDays - shiftsPerGuard);

  return {
    targetDay: equalTypeTarget,
    targetNight: equalTypeTarget,
    targetOff,
    targetSunday: sundayCount / g,
    targetWeekend: weekendCount / g,
  };
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
  preference: ShiftPreference,
  staffing: ShiftStaffingRequirements = { day: 1, night: 1 }
): number {
  let score = 0;

  if (shiftType === "day") {
    score += (stats.dayCount - targets.targetDay) * W_DAY;
  } else {
    score += (stats.nightCount - targets.targetNight) * W_NIGHT;
  }

  score += dayNightBalanceDelta(stats, shiftType) * W_DAY_NIGHT_BALANCE;

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

export function computeFairnessSpread(
  statsByGuard: Map<string, GuardStats>,
  staffing: ShiftStaffingRequirements = { day: 1, night: 1 }
): FairnessSpread {
  const stats = [...statsByGuard.values()];
  if (stats.length === 0) {
    return {
      maxDayMinusMinDay: 0,
      maxNightMinusMinNight: 0,
      maxSundayMinusMinSunday: 0,
      maxDayNightImbalance: 0,
    };
  }

  const dayCounts = stats.map((s) => s.dayCount);
  const nightCounts = stats.map((s) => s.nightCount);
  const sundayCounts = stats.map((s) => s.sundayCount);
  const imbalances = stats.map((s) => Math.abs(s.dayCount - s.nightCount));

  return {
    maxDayMinusMinDay: Math.max(...dayCounts) - Math.min(...dayCounts),
    maxNightMinusMinNight: Math.max(...nightCounts) - Math.min(...nightCounts),
    maxSundayMinusMinSunday: Math.max(...sundayCounts) - Math.min(...sundayCounts),
    maxDayNightImbalance: Math.max(...imbalances),
  };
}

export function validateDailyCoverage(
  entries: CoverageEntry[],
  calendarDays: Date[],
  staffing: ShiftStaffingRequirements = { day: 1, night: 1 },
  /** Weekdays each shift needs cover. Omit for the legacy seven-day-a-week behaviour. */
  coverageDays?: SiteCoverageDays
): UncoveredDay[] {
  const coverage = coverageDays ?? resolveSiteCoverageDays({});
  const requiredDay = staffing.day;
  const requiredNight = staffing.night;

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
    // A weekday the site does not need covered is not a gap. Reporting the required
    // count as 0 keeps downstream warning copy honest about what was actually expected.
    const needDay = isShiftCoveredOn(coverage, "day", day) ? requiredDay : 0;
    const needNight = isShiftCoveredOn(coverage, "night", day) ? requiredNight : 0;
    const missing: ("day" | "night")[] = [];
    if (counts.day < needDay) missing.push("day");
    if (counts.night < needNight) missing.push("night");
    if (missing.length > 0) {
      uncovered.push({
        date: dateKey,
        missing,
        counts: { day: counts.day, night: counts.night },
        required: { day: needDay, night: needNight },
      });
    }
  }
  return uncovered;
}
