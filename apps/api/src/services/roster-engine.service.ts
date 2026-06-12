import type { Post } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getCompanyTimezone, getShiftTimes } from "../lib/timezone.js";
import { meetsSiteShiftGenderRule, normalizeEmployeeGenderForRoster, type CustomBlock } from "./rostering.service.js";
import { auditRosterGeneration } from "../lib/roster-audit.js";
import {
  buildCalendarDays,
  buildPatternPreferenceGrid,
  buildRosterReadinessDiagnostics,
  buildSiteDemandSlots,
  computeFairnessSpread,
  computeFairnessTargets,
  computeStaggerOffsets,
  countPatternBreaksForEntries,
  createInitialGuardStats,
  dualPatternCycleLength,
  formatDateKey,
  isGuardEligibleForSlot,
  patternBlocks,
  pickBestGuardForDemandSlot,
  recordShiftInStats,
  seedOffDaysFromPattern,
  validateDailyCoverage,
  type FairnessSpread,
  type GuardCandidate,
  type GuardRuntimeState,
  type RosterReadinessDiagnostic,
  type ShiftStaffingRequirements,
} from "./roster-scheduler.js";
import {
  minRosterableGuardsForStaffing,
  resolveSiteShiftStaffing,
} from "./site-shift-staffing.js";

const ROSTERABLE_STATUSES = ["active", "training", "hired", "reliever"] as const;
const MAX_PLAN_ENTRIES = 1000;

export type RosterDualPattern = "3_on_3_off" | "custom_builder";

export type RosterPlanEntry = {
  employeeId: string;
  postId: string;
  startTime: string;
  endTime: string;
  shiftType: "day" | "night";
};

export type RosterPlanWarning = {
  code: string;
  message: string;
  employeeId?: string;
  postId?: string;
  date?: string;
};

export type RosterPlanConflict = {
  employeeId: string;
  date: string;
  reason: string;
};

export type RosterPlanGuardOffset = {
  employeeId: string;
  offsetDays: number;
};

export type RosterPlanGuardStat = {
  employeeId: string;
  dayCount: number;
  nightCount: number;
  offCount: number;
  sundayCount: number;
  weekendCount: number;
};

export type RosterPlan = {
  siteId: string;
  pattern: RosterDualPattern;
  startDate: string;
  endDate: string;
  entries: RosterPlanEntry[];
  summary: {
    guardsConsidered: number;
    shiftsPlanned: number;
    postsUsed: number;
    skippedGuardDays: number;
    uncoveredDays: number;
    fairnessSpread: FairnessSpread;
    demandSlotsTotal?: number;
    uncoveredSlots?: number;
    coveragePercent?: number;
    relieversUsed?: number;
    patternBreaks?: number;
  };
  guardCycleOffsets: RosterPlanGuardOffset[];
  guardStats?: RosterPlanGuardStat[];
  readiness?: RosterReadinessDiagnostic[];
  warnings: RosterPlanWarning[];
  conflicts: RosterPlanConflict[];
};

const EMPTY_FAIRNESS_SPREAD: FairnessSpread = {
  maxDayMinusMinDay: 0,
  maxNightMinusMinNight: 0,
  maxSundayMinusMinSunday: 0,
};

export type PostWithAssignments = Post & {
  assignedGuards: { employeeId: string }[];
};

export type EmployeePostPools = {
  day: Post[];
  night: Post[];
};

/** Map each employee to day/night posts they are explicitly assigned to (PostAssignment). */
export function buildEmployeePostAssignmentMap(
  posts: PostWithAssignments[]
): Map<string, EmployeePostPools> {
  const map = new Map<string, EmployeePostPools>();
  for (const post of posts) {
    const kind = (post.shiftType ?? "day").toLowerCase() === "night" ? "night" : "day";
    for (const { employeeId } of post.assignedGuards ?? []) {
      let pools = map.get(employeeId);
      if (!pools) {
        pools = { day: [], night: [] };
        map.set(employeeId, pools);
      }
      pools[kind].push(post);
    }
  }
  return map;
}

/**
 * Prefer PostAssignment for this guard and shift type; otherwise round-robin site posts of that type.
 */
export function resolvePostForShiftSlot(params: {
  employeeId: string;
  shiftType: "day" | "night";
  dayPosts: Post[];
  nightPosts: Post[];
  assignmentByEmployee: Map<string, EmployeePostPools>;
  roundRobin: { day: number; night: number };
}): Post {
  const { employeeId, shiftType, dayPosts, nightPosts, assignmentByEmployee, roundRobin } = params;
  const sitePool = shiftType === "day" ? dayPosts : nightPosts;
  const assignedPool = assignmentByEmployee.get(employeeId)?.[shiftType] ?? [];

  if (assignedPool.length > 0) {
    const idx = shiftType === "day" ? roundRobin.day++ : roundRobin.night++;
    return assignedPool[idx % assignedPool.length]!;
  }

  const idx = shiftType === "day" ? roundRobin.day++ : roundRobin.night++;
  return sitePool[idx % sitePool.length]!;
}

export type GenerateRosterPlanInput = {
  companyId: string;
  siteId: string;
  startDate: Date;
  endDate: Date;
  pattern: RosterDualPattern;
  customBlocks?: CustomBlock[];
};

function shiftsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function buildPatternCoverageHints(params: {
  pattern: RosterDualPattern;
  guardCount: number;
  cycleLength: number;
  customBlocks?: CustomBlock[];
  staffing: ShiftStaffingRequirements;
}): RosterPlanWarning[] {
  const { pattern, guardCount, cycleLength, customBlocks, staffing } = params;
  const hints: RosterPlanWarning[] = [];

  const minGuardsForStaffing = minRosterableGuardsForStaffing(staffing);
  if (guardCount < minGuardsForStaffing) {
    hints.push({
      code: "PATTERN_COVERAGE_HINT",
      message: `This site requires ${staffing.day} day and ${staffing.night} night guard(s) per day. Assign at least ${minGuardsForStaffing} rosterable guards to the site.`,
    });
  }

  if ((staffing.day > 1 || staffing.night > 1) && guardCount > 0 && guardCount < staffing.day + staffing.night) {
    hints.push({
      code: "PATTERN_COVERAGE_HINT",
      message:
        "Multiple guards per shift need enough team members on staggered cycle phases. Add guards so pattern day/night blocks can fill each shift slot.",
    });
  }

  if (pattern === "3_on_3_off") {
    if (guardCount < 3) {
      hints.push({
        code: "PATTERN_COVERAGE_HINT",
        message:
          "3D3N3O needs at least 3 rosterable guards on this site so day and night blocks align across the team (automatic phase spreading).",
      });
    }
    return hints;
  }

  if (pattern === "custom_builder") {
    const hasDay = customBlocks?.some((b) => b.type === "day");
    const hasNight = customBlocks?.some((b) => b.type === "night");
    if (hasDay && hasNight) {
      if (guardCount < 2) {
        hints.push({
          code: "PATTERN_COVERAGE_HINT",
          message:
            "This custom pattern includes day and night blocks. Assign at least 2 guards for daily coverage.",
        });
      } else if (guardCount < cycleLength) {
        hints.push({
          code: "PATTERN_COVERAGE_HINT",
          message: `For reliable daily coverage with a ${cycleLength}-day cycle, consider at least ${cycleLength} guards (phases spread automatically).`,
        });
      }
    }
  }

  return hints;
}

/**
 * Build a roster plan for site-assigned guards using dual patterns (preview only; no DB writes).
 */
export async function generateRosterPlan(input: GenerateRosterPlanInput): Promise<RosterPlan> {
  const {
    companyId,
    siteId,
    startDate,
    endDate,
    pattern,
    customBlocks,
  } = input;

  const startDateStr = formatDateKey(startDate);
  const endDateStr = formatDateKey(endDate);

  const emptyPlan = (warnings: RosterPlanWarning[], guardsConsidered = 0): RosterPlan => ({
    siteId,
    pattern,
    startDate: startDateStr,
    endDate: endDateStr,
    entries: [],
    summary: {
      guardsConsidered,
      shiftsPlanned: 0,
      postsUsed: 0,
      skippedGuardDays: 0,
      uncoveredDays: 0,
      fairnessSpread: EMPTY_FAIRNESS_SPREAD,
    },
    guardCycleOffsets: [],
    warnings,
    conflicts: [],
  });

  const site = await prisma.site.findFirst({
    where: { id: siteId, companyId },
    include: {
      posts: {
        include: {
          assignedGuards: { select: { employeeId: true } },
        },
      },
      assignedGuards: {
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              status: true,
              gender: true,
              employeeType: true,
            },
          },
        },
      },
    },
  });

  if (!site) {
    throw new Error("SITE_NOT_FOUND");
  }

  const siteGenderRules = {
    rosterDayShiftGender: site.rosterDayShiftGender,
    rosterNightShiftGender: site.rosterNightShiftGender,
  };
  const shiftStaffing = resolveSiteShiftStaffing(
    site as {
      rosterDayShiftGuardsRequired?: number | null;
      rosterNightShiftGuardsRequired?: number | null;
    }
  );

  const postsWithAssignments = site.posts as PostWithAssignments[];
  const dayPosts = postsWithAssignments.filter((p) => (p.shiftType ?? "day") === "day");
  const nightPosts = postsWithAssignments.filter((p) => p.shiftType === "night");
  if (dayPosts.length === 0 || nightPosts.length === 0) {
    return emptyPlan([
      {
        code: "MISSING_POSTS",
        message:
          dayPosts.length === 0
            ? "Site has no day post. Add a day post to use dual-pattern rostering."
            : "Site has no night post. Add a night post to use dual-pattern rostering.",
      },
    ]);
  }

  const rosterableGuards = site.assignedGuards
    .map((a) => a.employee)
    .filter(
      (e) =>
        (e.employeeType ?? "security") === "security" &&
        ROSTERABLE_STATUSES.includes(e.status as (typeof ROSTERABLE_STATUSES)[number])
    );

  if (rosterableGuards.length === 0) {
    return emptyPlan([
      {
        code: "NO_SITE_GUARDS",
        message: "Assign guards to this site in Sites first.",
      },
    ]);
  }

  if (pattern === "custom_builder") {
    const hasWork = customBlocks?.some((b) => b.type === "day" || b.type === "night");
    if (!hasWork) {
      return emptyPlan([
        {
          code: "EMPTY_PATTERN",
          message: "Pattern must include at least one day or night block.",
        },
      ]);
    }
  }

  const warnings: RosterPlanWarning[] = [];
  const minGuardsNeeded = minRosterableGuardsForStaffing(shiftStaffing);
  if (rosterableGuards.length < minGuardsNeeded) {
    warnings.push({
      code: "INSUFFICIENT_GUARDS",
      message: `This site requires ${shiftStaffing.day} day and ${shiftStaffing.night} night guard(s) per day. Assign at least ${minGuardsNeeded} rosterable guards to the site.`,
    });
  }

  const postIds = site.posts.map((p) => p.id);
  const guardIds = rosterableGuards.map((g) => g.id);

  const [blockingExistingShifts, sameSiteShiftsInPeriod] = await Promise.all([
    prisma.shift.findMany({
      where: {
        companyId,
        employeeId: { in: guardIds },
        postId: { notIn: postIds },
        startTime: { lt: endDate },
        endTime: { gt: startDate },
      },
      select: { employeeId: true, startTime: true, endTime: true },
    }),
    prisma.shift.count({
      where: {
        companyId,
        postId: { in: postIds },
        status: { in: ["created", "assigned"] },
        startTime: { lt: endDate },
        endTime: { gt: startDate },
      },
    }),
  ]);
  const existingShifts = blockingExistingShifts;

  if (sameSiteShiftsInPeriod > 0) {
    warnings.push({
      code: "REPLAN_REPLACES_EXISTING",
      message: `${sameSiteShiftsInPeriod} existing shift(s) on this site in the period will be replaced when you apply this plan.`,
    });
  }

  const timeZone = await getCompanyTimezone(companyId);
  const blocks = patternBlocks(pattern, customBlocks);
  const cycleLength = dualPatternCycleLength(pattern, customBlocks);
  const calendarDays = buildCalendarDays(startDate, endDate);

  const sortedGuards = [...rosterableGuards].sort((a, b) => a.id.localeCompare(b.id));
  const staggerOffsetList = computeStaggerOffsets(sortedGuards.length, cycleLength);

  const guardCycleOffsets: RosterPlanGuardOffset[] = sortedGuards.map((guard, i) => ({
    employeeId: guard.id,
    offsetDays: staggerOffsetList[i] ?? 0,
  }));

  const { slots: demandSlots, warnings: demandWarnings } = buildSiteDemandSlots({
    siteId,
    calendarDays,
    dayPosts,
    nightPosts,
    staffing: shiftStaffing,
    siteGenderRules,
  });
  for (const w of demandWarnings) {
    warnings.push(w);
  }

  const fairnessTargets = computeFairnessTargets(rosterableGuards.length, calendarDays);
  const staggerOffsetsByGuard = new Map<string, number>();
  for (let i = 0; i < sortedGuards.length; i++) {
    staggerOffsetsByGuard.set(sortedGuards[i]!.id, staggerOffsetList[i] ?? 0);
  }
  const preferenceGrid = buildPatternPreferenceGrid({
    guardIds,
    calendarDays,
    patternStartDate: startDate,
    pattern,
    customBlocks,
    staggerOffsets: staggerOffsetsByGuard,
  });

  const postById = new Map(postsWithAssignments.map((p) => [p.id, p]));
  const postAssignedGuardIdsByPost = new Map<string, Set<string>>();
  for (const post of postsWithAssignments) {
    postAssignedGuardIdsByPost.set(
      post.id,
      new Set((post.assignedGuards ?? []).map((a) => a.employeeId))
    );
  }

  const siteAssignedGuardIds = new Set(guardIds);
  const candidates: GuardCandidate[] = rosterableGuards.map((g) => ({
    id: g.id,
    gender: g.gender,
    status: g.status,
    employeeType: g.employeeType,
  }));

  const statsByGuard = createInitialGuardStats(guardIds);
  const runtimeByGuard = new Map<string, GuardRuntimeState>();
  for (const id of guardIds) {
    runtimeByGuard.set(id, {
      stats: statsByGuard.get(id)!,
      planned: [],
      workedDateKeys: new Set(),
      shiftTypeByDateKey: new Map(),
    });
  }

  const entries: RosterPlanEntry[] = [];
  const conflicts: RosterPlanConflict[] = [];
  const postsUsedSet = new Set<string>();
  let skippedGuardDays = 0;
  let uncoveredSlots = 0;

  seedOffDaysFromPattern(guardIds, calendarDays, preferenceGrid, statsByGuard);

  const sortedDemandSlots = [...demandSlots].sort(
    (a, b) =>
      b.difficultyScore - a.difficultyScore ||
      a.dateKey.localeCompare(b.dateKey) ||
      a.shiftType.localeCompare(b.shiftType)
  );

  const dayIndexByDateKey = new Map(calendarDays.map((d, i) => [formatDateKey(d), i]));

  type UnfilledSlot = {
    slot: (typeof sortedDemandSlots)[number];
    post: PostWithAssignments;
    shiftStart: Date;
    shiftEnd: Date;
    dayIndex: number;
    prevDateKey: string | null;
    reason: string;
  };

  const unfilledSlots: UnfilledSlot[] = [];

  const tryAssignSlot = (
    slot: (typeof sortedDemandSlots)[number],
    post: PostWithAssignments,
    shiftStart: Date,
    shiftEnd: Date,
    dayIndex: number,
    prevDateKey: string | null,
    requirePatternMatch: boolean
  ): boolean => {
    const eligible = candidates.filter((guard) =>
      isGuardEligibleForSlot({
        guard,
        slot,
        siteGenderRules,
        postShiftType: post.shiftType,
        siteAssignedGuardIds,
        existingShifts,
        runtime: runtimeByGuard.get(guard.id)!,
        shiftStart,
        shiftEnd,
        calendarDays,
        dayIndex,
        prevDateKey,
      })
    );

    const best = pickBestGuardForDemandSlot({
      candidates: eligible,
      slot,
      date: slot.date,
      dayIndex,
      statsByGuard,
      runtimeByGuard,
      targets: fairnessTargets,
      preferenceGrid,
      postAssignedGuardIds: postAssignedGuardIdsByPost.get(slot.postId) ?? new Set(),
      prevDateKey,
      requirePatternMatch,
    });

    if (!best) return false;

    entries.push({
      employeeId: best.id,
      postId: slot.postId,
      startTime: shiftStart.toISOString(),
      endTime: shiftEnd.toISOString(),
      shiftType: slot.shiftType,
    });
    postsUsedSet.add(slot.postId);

    const runtime = runtimeByGuard.get(best.id)!;
    runtime.planned.push({ start: shiftStart, end: shiftEnd });
    runtime.workedDateKeys.add(slot.dateKey);
    runtime.shiftTypeByDateKey.set(slot.dateKey, slot.shiftType);
    recordShiftInStats(runtime.stats, slot.shiftType, slot.date);
    return true;
  };

  for (const slot of sortedDemandSlots) {
    const post = postById.get(slot.postId);
    if (!post) continue;

    const { shiftStart, shiftEnd } = getShiftTimes(slot.date, slot.shiftType, timeZone);
    const dayIndex = dayIndexByDateKey.get(slot.dateKey) ?? 0;
    const prevDateKey =
      dayIndex > 0 ? formatDateKey(calendarDays[dayIndex - 1]!) : null;

    if (tryAssignSlot(slot, post, shiftStart, shiftEnd, dayIndex, prevDateKey, true)) {
      continue;
    }

    const patternAligned = candidates.filter(
      (g) => (preferenceGrid.get(g.id)?.get(slot.dateKey) ?? "off") === slot.shiftType
    );
    let reason: string;
    if (patternAligned.length === 0) {
      reason = `No guard on ${slot.shiftType} pattern phase for post ${post.name}`;
    } else {
      reason = `Pattern-aligned guards blocked by rest, gender, or overlap rules for post ${post.name}`;
    }

    unfilledSlots.push({
      slot,
      post,
      shiftStart,
      shiftEnd,
      dayIndex,
      prevDateKey,
      reason,
    });
  }

  // Second pass: fill remaining slots with pattern-relaxed assignment (rest/gender/overlap still enforced).
  let gapFillCount = 0;
  for (const unfilled of unfilledSlots) {
    const { slot, post, shiftStart, shiftEnd, dayIndex, prevDateKey, reason } = unfilled;
    if (tryAssignSlot(slot, post, shiftStart, shiftEnd, dayIndex, prevDateKey, false)) {
      gapFillCount++;
      warnings.push({
        code: "PATTERN_BREAK_FILL",
        date: slot.dateKey,
        postId: slot.postId,
        employeeId: entries[entries.length - 1]?.employeeId,
        message: `${slot.dateKey}: Filled ${slot.shiftType} at ${post.name} with a guard off-pattern (${reason}).`,
      });
    } else {
      uncoveredSlots++;
      warnings.push({
        code: "UNCOVERED_SLOT",
        date: slot.dateKey,
        postId: slot.postId,
        message: `${slot.dateKey}: ${reason}.`,
      });
      conflicts.push({
        employeeId: "",
        date: slot.dateKey,
        reason: `${slot.shiftType} · ${post.name}: ${reason}`,
      });
    }
  }

  if (gapFillCount > 0) {
    warnings.push({
      code: "GAP_FILL_SUMMARY",
      message: `${gapFillCount} slot(s) filled by relaxing pattern rules (guards assigned on off-phase days). Review pattern breaks before applying.`,
    });
  }

  for (const guardId of guardIds) {
    const stats = statsByGuard.get(guardId)!;
    const worked = runtimeByGuard.get(guardId)!.workedDateKeys;
    stats.offCount = calendarDays.length - worked.size;
  }

  const datesWithUncoveredSlots = new Set(
    warnings.filter((w) => w.code === "UNCOVERED_SLOT" && w.date).map((w) => w.date!)
  );
  for (const guardId of guardIds) {
    for (const day of calendarDays) {
      const dateKey = formatDateKey(day);
      if (!datesWithUncoveredSlots.has(dateKey)) continue;
      const pref = preferenceGrid.get(guardId)?.get(dateKey) ?? "off";
      if (pref === "off") {
        skippedGuardDays++;
      }
    }
  }

  const relieversUsed = new Set(
    entries
      .filter((e) => candidates.find((c) => c.id === e.employeeId)?.status === "reliever")
      .map((e) => e.employeeId)
  ).size;

  const patternBreaks = countPatternBreaksForEntries(entries, preferenceGrid);
  const demandSlotsTotal = demandSlots.length;
  const coveragePercent =
    demandSlotsTotal > 0
      ? Math.round((entries.length / demandSlotsTotal) * 100)
      : 100;

  const guardsMissingGender = rosterableGuards.filter(
    (g) => normalizeEmployeeGenderForRoster(g.gender) === null
  ).length;

  const readiness = buildRosterReadinessDiagnostics({
    dayPostCount: dayPosts.length,
    nightPostCount: nightPosts.length,
    staffing: shiftStaffing,
    rosterableGuardCount: rosterableGuards.length,
    relieverCount: rosterableGuards.filter((g) => g.status === "reliever").length,
    guardsMissingGender,
    hasRestrictiveGenderRules:
      siteGenderRules.rosterDayShiftGender === "male" ||
      siteGenderRules.rosterDayShiftGender === "female" ||
      siteGenderRules.rosterNightShiftGender === "male" ||
      siteGenderRules.rosterNightShiftGender === "female",
  });

  warnings.push(
    ...buildPatternCoverageHints({
      pattern,
      guardCount: rosterableGuards.length,
      cycleLength,
      customBlocks,
      staffing: shiftStaffing,
    })
  );

  const uncovered = validateDailyCoverage(entries, calendarDays, shiftStaffing);
  for (const u of uncovered) {
    const alreadyWarned = warnings.some(
      (w) => w.code === "UNCOVERED_DAY" && w.date === u.date
    );
    if (!alreadyWarned) {
      for (const missing of u.missing) {
        const have = u.counts?.[missing] ?? 0;
        const need = u.required?.[missing] ?? 1;
        warnings.push({
          code: "UNCOVERED_DAY",
          date: u.date,
          message: `Only ${have} of ${need} required ${missing} shift(s) on ${u.date}.`,
        });
      }
    }
  }

  const fairnessSpread = computeFairnessSpread(statsByGuard);
  const guardStats: RosterPlanGuardStat[] = guardIds.map((id) => {
    const s = statsByGuard.get(id)!;
    return {
      employeeId: id,
      dayCount: s.dayCount,
      nightCount: s.nightCount,
      offCount: s.offCount,
      sundayCount: s.sundayCount,
      weekendCount: s.weekendCount,
    };
  });

  return {
    siteId,
    pattern,
    startDate: startDateStr,
    endDate: endDateStr,
    entries,
    summary: {
      guardsConsidered: rosterableGuards.length,
      shiftsPlanned: entries.length,
      postsUsed: postsUsedSet.size,
      skippedGuardDays,
      uncoveredDays: uncovered.length,
      fairnessSpread,
      demandSlotsTotal,
      uncoveredSlots,
      coveragePercent,
      relieversUsed,
      patternBreaks,
    },
    guardCycleOffsets,
    guardStats,
    readiness,
    warnings,
    conflicts,
  };
}

export type ApplyRosterPlanInput = {
  companyId: string;
  userId: string;
  plan: RosterPlan;
  options?: {
    replaceExisting?: boolean;
  };
};

export type ApplyRosterPlanResult = {
  deleted: number;
  created: number;
  skipped: number;
  errors?: string[];
};

type ApplyValidationContext = {
  employeeById: Map<string, { id: string; status: string; gender: string | null }>;
  postById: Map<
    string,
    {
      id: string;
      siteId: string;
      shiftType: string | null;
      site: {
        companyId: string;
        rosterDayShiftGender: string | null;
        rosterNightShiftGender: string | null;
      };
    }
  >;
  siteAssignedEmployeeIds: Set<string>;
  existingShiftsByEmployee: Map<string, { startTime: Date; endTime: Date }[]>;
};

async function loadApplyValidationContext(
  companyId: string,
  siteId: string,
  plan: RosterPlan,
  rangeStart: Date,
  rangeEnd: Date,
  sitePostIds: string[],
  replaceExisting: boolean
): Promise<ApplyValidationContext> {
  const employeeIds = [...new Set(plan.entries.map((e) => e.employeeId))];
  const postIds = [...new Set(plan.entries.map((e) => e.postId))];

  const [employees, posts, siteAssignments, existingShifts] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId, id: { in: employeeIds } },
      select: { id: true, status: true, gender: true },
    }),
    prisma.post.findMany({
      where: { id: { in: postIds } },
      include: {
        site: {
          select: {
            companyId: true,
            rosterDayShiftGender: true,
            rosterNightShiftGender: true,
          },
        },
      },
    }),
    prisma.siteAssignment.findMany({
      where: { siteId, employeeId: { in: employeeIds } },
      select: { employeeId: true },
    }),
    prisma.shift.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        startTime: { lt: rangeEnd },
        endTime: { gt: rangeStart },
        ...(replaceExisting
          ? {
              NOT: {
                postId: { in: sitePostIds },
                status: { in: ["created", "assigned"] },
              },
            }
          : {}),
      },
      select: { employeeId: true, startTime: true, endTime: true },
    }),
  ]);

  const existingShiftsByEmployee = new Map<string, { startTime: Date; endTime: Date }[]>();
  for (const shift of existingShifts) {
    const list = existingShiftsByEmployee.get(shift.employeeId) ?? [];
    list.push({ startTime: shift.startTime, endTime: shift.endTime });
    existingShiftsByEmployee.set(shift.employeeId, list);
  }

  return {
    employeeById: new Map(employees.map((e) => [e.id, e])),
    postById: new Map(posts.map((p) => [p.id, p])),
    siteAssignedEmployeeIds: new Set(siteAssignments.map((a) => a.employeeId)),
    existingShiftsByEmployee,
  };
}

function validateApplyEntryInMemory(
  companyId: string,
  siteId: string,
  employeeId: string,
  postId: string,
  startTime: Date,
  endTime: Date,
  ctx: ApplyValidationContext
): string | null {
  const employee = ctx.employeeById.get(employeeId);
  if (!employee) return "Employee not found";
  if (!ROSTERABLE_STATUSES.includes(employee.status as (typeof ROSTERABLE_STATUSES)[number])) {
    return `Employee must be active, training, hired, or reliever to be assigned. Current status: ${employee.status}`;
  }

  const post = ctx.postById.get(postId);
  if (!post) return "Post not found";
  if (post.site.companyId !== companyId) return "Post does not belong to company";
  if (post.siteId !== siteId) return "Post does not belong to this site";

  if (!ctx.siteAssignedEmployeeIds.has(employeeId)) {
    return "Employee is not assigned to this site. Assign the guard to the site in Sites first.";
  }

  if (!meetsSiteShiftGenderRule(employee.gender, post.site, post.shiftType)) {
    const kind = (post.shiftType ?? "day").toLowerCase() === "night" ? "night" : "day";
    return `Does not meet site ${kind} shift staffing rules`;
  }

  const existing = ctx.existingShiftsByEmployee.get(employeeId) ?? [];
  if (existing.some((s) => shiftsOverlap(startTime, endTime, s.startTime, s.endTime))) {
    return "Employee has an overlapping shift in this time range";
  }

  return null;
}

/**
 * Apply a previewed roster plan: optionally replace shifts in range, then create planned entries.
 */
export async function applyRosterPlan(input: ApplyRosterPlanInput): Promise<ApplyRosterPlanResult> {
  const { companyId, userId, plan, options = {} } = input;
  const replaceExisting = options.replaceExisting !== false;

  if (plan.entries.length === 0) {
    throw new Error("PLAN_EMPTY");
  }

  if (plan.entries.length > MAX_PLAN_ENTRIES) {
    throw new Error("PLAN_TOO_LARGE");
  }

  const site = await prisma.site.findFirst({
    where: { id: plan.siteId, companyId },
    include: { posts: { select: { id: true } } },
  });

  if (!site) {
    throw new Error("SITE_NOT_FOUND");
  }

  const sitePostIds = new Set(site.posts.map((p) => p.id));
  for (const entry of plan.entries) {
    if (!sitePostIds.has(entry.postId)) {
      throw new Error("INVALID_POST");
    }
  }

  const start = new Date(`${plan.startDate.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${plan.endDate.slice(0, 10)}T23:59:59.999Z`);

  let deleted = 0;
  let created = 0;
  const errors: string[] = [];
  const plannedByEmployee = new Map<string, { start: Date; end: Date }[]>();

  const validationCtx = await loadApplyValidationContext(
    companyId,
    plan.siteId,
    plan,
    start,
    end,
    [...sitePostIds],
    replaceExisting
  );
  const shiftsToCreate: {
    companyId: string;
    employeeId: string;
    postId: string;
    startTime: Date;
    endTime: Date;
    status: "assigned";
  }[] = [];

  for (const entry of plan.entries) {
    const startTime = new Date(entry.startTime);
    const endTime = new Date(entry.endTime);

    const employeePlanned = plannedByEmployee.get(entry.employeeId) ?? [];
    const overlapsBatch = employeePlanned.some((p) =>
      shiftsOverlap(startTime, endTime, p.start, p.end)
    );
    if (overlapsBatch) {
      errors.push(`${entry.startTime.slice(0, 10)}: Overlaps another shift in this roster plan`);
      continue;
    }

    const validationError = validateApplyEntryInMemory(
      companyId,
      plan.siteId,
      entry.employeeId,
      entry.postId,
      startTime,
      endTime,
      validationCtx
    );
    if (validationError) {
      errors.push(`${entry.startTime.slice(0, 10)}: ${validationError}`);
      continue;
    }

    shiftsToCreate.push({
      companyId,
      employeeId: entry.employeeId,
      postId: entry.postId,
      startTime,
      endTime,
      status: "assigned",
    });
    employeePlanned.push({ start: startTime, end: endTime });
    plannedByEmployee.set(entry.employeeId, employeePlanned);
  }

  await prisma.$transaction(
    async (tx) => {
      if (replaceExisting) {
        const del = await tx.shift.deleteMany({
          where: {
            companyId,
            postId: { in: [...sitePostIds] },
            status: { in: ["created", "assigned"] },
            startTime: { lt: end },
            endTime: { gt: start },
          },
        });
        deleted = del.count;
      }

      if (shiftsToCreate.length > 0) {
        const result = await tx.shift.createMany({ data: shiftsToCreate });
        created = result.count;
      }
    },
    {
      maxWait: 10_000,
      timeout: Math.min(120_000, 15_000 + shiftsToCreate.length * 50),
    }
  );

  if (created > 0) {
    await auditRosterGeneration({
      userId,
      companyId,
      siteId: plan.siteId,
      plan,
      created,
      deleted,
    });
  }

  return {
    deleted,
    created,
    skipped: plan.entries.length - created,
    errors: errors.length > 0 ? errors : undefined,
  };
}
