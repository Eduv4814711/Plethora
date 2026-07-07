import { prisma } from "../lib/prisma.js";
import { inferPostShiftType } from "../lib/site-post-api.js";
import { getCompanyTimezone, getShiftTimes, dateKeyInTimeZone } from "../lib/timezone.js";
import { getLeaveDateKeysByEmployee } from "./leave-availability.service.js";
import { meetsSiteShiftGenderRule, normalizeEmployeeGenderForRoster } from "./rostering.service.js";
import { auditRosterGeneration } from "../lib/roster-audit.js";
import {
  buildCalendarDays,
  buildRosterReadinessDiagnostics,
  buildSiteDemandSlots,
  buildSiteRotationPlan,
  computeFairnessSpread,
  computeFairnessTargets,
  createInitialGuardStats,
  defaultMaxConsecutiveSameShift,
  explainGuardIneligibilityForSlot,
  formatDateKey,
  isGuardEligibleForSlot,
  pickBestGuardForDemandSlot,
  recordShiftInStats,
  validateDailyCoverage,
  violatesAdjacentShiftRestRules,
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
import {
  partitionGuardsForRotation,
  recommendSiteRotationPattern,
  type SiteRotationRecommendation,
} from "./roster-pattern-recommendation.js";

const ROSTERABLE_STATUSES = ["active", "training", "hired", "reliever"] as const;
const MAX_PLAN_ENTRIES = 1000;

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

export type RosterPlanGuardStat = {
  employeeId: string;
  dayCount: number;
  nightCount: number;
  offCount: number;
  sundayCount: number;
  weekendCount: number;
};

export type RotationRecommendationSummary = {
  recommendedPatternLabel: string;
  strategy: SiteRotationRecommendation["strategy"];
  reason: string;
  canFullyCover: boolean;
  coreGuardCount: number;
  relieverGuardCount: number;
  warnings: string[];
};

export type RosterPlan = {
  siteId: string;
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
    rotationPattern?: string;
    rotationRecommendation?: RotationRecommendationSummary;
  };
  guardStats?: RosterPlanGuardStat[];
  readiness?: RosterReadinessDiagnostic[];
  warnings: RosterPlanWarning[];
  conflicts: RosterPlanConflict[];
};

const EMPTY_FAIRNESS_SPREAD: FairnessSpread = {
  maxDayMinusMinDay: 0,
  maxNightMinusMinNight: 0,
  maxSundayMinusMinSunday: 0,
  maxDayNightImbalance: 0,
};

export type RosterPost = {
  id: string;
  name: string;
  siteId: string;
  shiftType: string | null;
};

export type PostWithAssignments = RosterPost & {
  assignedGuards: { employeeId: string }[];
};

export type EmployeePostPools = {
  day: RosterPost[];
  night: RosterPost[];
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
  dayPosts: RosterPost[];
  nightPosts: RosterPost[];
  assignmentByEmployee: Map<string, EmployeePostPools>;
  roundRobin: { day: number; night: number };
}): RosterPost {
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
  /** When true, all guards rotate equally instead of core + reliever pool. */
  rotateAllGuards?: boolean;
};

function shiftsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Build a fair monthly roster plan for site-assigned guards (preview only; no DB writes).
 */
export async function generateRosterPlan(input: GenerateRosterPlanInput): Promise<RosterPlan> {
  const {
    companyId,
    siteId,
    startDate,
    endDate,
    rotateAllGuards = false,
  } = input;

  const startDateStr = formatDateKey(startDate);
  const endDateStr = formatDateKey(endDate);

  const emptyPlan = (warnings: RosterPlanWarning[], guardsConsidered = 0): RosterPlan => ({
    siteId,
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
    warnings,
    conflicts: [],
  });

  const site = await prisma.site.findFirst({
    where: { id: siteId, companyId },
    include: {
      posts: {
        include: {
          guardEligibilities: { select: { employeeId: true } },
          coverageRequirements: { where: { isEnabled: true } },
        },
      },
      assignedGuards: {
        where: { isActive: true },
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

  const postsWithAssignments: PostWithAssignments[] = site.posts.map((p) => ({
    id: p.id,
    name: p.name,
    siteId: p.siteId,
    shiftType: inferPostShiftType(p.coverageRequirements),
    assignedGuards: p.guardEligibilities.map((g) => ({ employeeId: g.employeeId })),
  }));
  const dayPosts = postsWithAssignments.filter((p) => (p.shiftType ?? "day") === "day");
  const nightPosts = postsWithAssignments.filter((p) => p.shiftType === "night");
  if (shiftStaffing.day === 0 && shiftStaffing.night === 0) {
    return emptyPlan([
      {
        code: "ZERO_STAFFING",
        message: "At least one shift must require guards for auto-roster.",
      },
    ]);
  }
  if (shiftStaffing.day > 0 && dayPosts.length === 0) {
    return emptyPlan([
      {
        code: "MISSING_POSTS",
        message: "Site has no day post. Add a day post to generate a roster.",
      },
    ]);
  }
  if (shiftStaffing.night > 0 && nightPosts.length === 0) {
    return emptyPlan([
      {
        code: "MISSING_POSTS",
        message: "Site has no night post. Add a night post to generate a roster.",
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

  const warnings: RosterPlanWarning[] = [];
  const minGuardsNeeded = minRosterableGuardsForStaffing(shiftStaffing);
  if (rosterableGuards.length < minGuardsNeeded) {
    warnings.push({
      code: "INSUFFICIENT_GUARDS",
      message: `This site requires ${shiftStaffing.day} day and ${shiftStaffing.night} night guard(s) per day. Assign at least ${minGuardsNeeded} rosterable guards to the site.`,
    });
  }

  const guardIds = rosterableGuards.map((g) => g.id);

  const [blockingExistingShifts, sameSiteShiftsInPeriod, leaveDateKeysByEmployee] = await Promise.all([
    prisma.shift.findMany({
      where: {
        companyId,
        employeeId: { in: guardIds },
        siteId: { not: siteId },
        startTime: { lt: endDate },
        endTime: { gt: startDate },
      },
      select: { employeeId: true, startTime: true, endTime: true },
    }),
    prisma.shift.count({
      where: {
        companyId,
        siteId,
        status: { in: ["created", "assigned"] },
        startTime: { lt: endDate },
        endTime: { gt: startDate },
      },
    }),
    getLeaveDateKeysByEmployee(guardIds, startDate, endDate),
  ]);
  const existingShifts = blockingExistingShifts;
  const guardNameById = new Map(
    rosterableGuards.map((g) => [g.id, `${g.firstName} ${g.lastName}`.trim()])
  );

  if (sameSiteShiftsInPeriod > 0) {
    warnings.push({
      code: "REPLAN_REPLACES_EXISTING",
      message: `${sameSiteShiftsInPeriod} existing shift(s) on this site in the period will be replaced when you apply this plan.`,
    });
  }

  const timeZone = await getCompanyTimezone(companyId);
  const calendarDays = buildCalendarDays(startDate, endDate);

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

  const relieverCount = rosterableGuards.filter((g) => g.status === "reliever").length;
  const rotationRecommendation = recommendSiteRotationPattern({
    guardCount: site.assignedGuards.length,
    rosterableGuardCount: rosterableGuards.length,
    relieverCount,
    dayPostCount: dayPosts.length,
    nightPostCount: nightPosts.length,
    staffing: shiftStaffing,
    rosterPeriodStart: startDate,
    rosterPeriodEnd: endDate,
    rotateAllGuards,
  });

  for (const w of rotationRecommendation.warnings) {
    warnings.push({ code: "ROTATION_RECOMMENDATION", message: w });
  }
  if (!rotationRecommendation.canFullyCover) {
    warnings.push({
      code: "UNDERSTAFFED_ROTATION",
      message: rotationRecommendation.reason,
    });
  }

  const { coreGuardIds } = partitionGuardsForRotation(
    rosterableGuards.map((g) => ({ id: g.id, status: g.status })),
    rotationRecommendation
  );

  const fairnessTargets = computeFairnessTargets(
    rosterableGuards.length,
    calendarDays,
    shiftStaffing
  );
  const rotationPlan =
    rotationRecommendation.blocks.length > 0
      ? buildSiteRotationPlan({
          guardIds,
          calendarDays,
          staffing: shiftStaffing,
          blocks: rotationRecommendation.blocks,
          coreGuardIds,
        })
      : null;
  const planTargets = rotationPlan?.targets ?? fairnessTargets;
  const maxConsecutiveSameShift =
    rotationPlan?.maxConsecutiveSameShift ?? defaultMaxConsecutiveSameShift();

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
  const assignedEmployeeIdsByDateKey = new Map<string, Set<string>>();
  let uncoveredSlots = 0;

  /** Process chronologically (day before night) so pattern coverage stays aligned. */
  const sortedDemandSlots = [...demandSlots].sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey) ||
      (a.shiftType === "day" ? -1 : b.shiftType === "day" ? 1 : 0) ||
      b.difficultyScore - a.difficultyScore
  );

  const dayIndexByDateKey = new Map(calendarDays.map((d, i) => [formatDateKey(d), i]));

  const tryAssignSlot = (
    slot: (typeof sortedDemandSlots)[number],
    post: PostWithAssignments,
    shiftStart: Date,
    shiftEnd: Date,
    dayIndex: number,
    prevDateKey: string | null
  ): boolean => {
    const assignedForDate =
      assignedEmployeeIdsByDateKey.get(slot.dateKey) ?? new Set<string>();

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
        maxConsecutiveSameShift,
        assignedEmployeeIdsForDate: assignedForDate,
        leaveDateKeysByEmployee,
      })
    );

    const best =
      pickBestGuardForDemandSlot({
        candidates: eligible,
        slot,
        date: slot.date,
        dayIndex,
        statsByGuard,
        runtimeByGuard,
        targets: planTargets,
        postAssignedGuardIds: postAssignedGuardIdsByPost.get(slot.postId) ?? new Set(),
        prevDateKey,
        staffing: shiftStaffing,
        calendarDays,
        preferenceGrid: rotationPlan?.preferenceGrid,
      }) ??
      (rotationPlan
        ? pickBestGuardForDemandSlot({
            candidates: eligible,
            slot,
            date: slot.date,
            dayIndex,
            statsByGuard,
            runtimeByGuard,
            targets: planTargets,
            postAssignedGuardIds: postAssignedGuardIdsByPost.get(slot.postId) ?? new Set(),
            prevDateKey,
            staffing: shiftStaffing,
            calendarDays,
          })
        : null);

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

    let dateSet = assignedEmployeeIdsByDateKey.get(slot.dateKey);
    if (!dateSet) {
      dateSet = new Set();
      assignedEmployeeIdsByDateKey.set(slot.dateKey, dateSet);
    }
    dateSet.add(best.id);
    return true;
  };

  for (const slot of sortedDemandSlots) {
    const post = postById.get(slot.postId);
    if (!post) continue;

    const { shiftStart, shiftEnd } = getShiftTimes(slot.date, slot.shiftType, timeZone);
    const dayIndex = dayIndexByDateKey.get(slot.dateKey) ?? 0;
    const prevDateKey =
      dayIndex > 0 ? formatDateKey(calendarDays[dayIndex - 1]!) : null;

    if (tryAssignSlot(slot, post, shiftStart, shiftEnd, dayIndex, prevDateKey)) {
      continue;
    }

    uncoveredSlots++;
    const slotLabel = `${slot.shiftType} · ${post.name}`;
    const guardBlocks = candidates
      .map((guard) => {
        const reasons = explainGuardIneligibilityForSlot({
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
          maxConsecutiveSameShift,
          assignedEmployeeIdsForDate: assignedEmployeeIdsByDateKey.get(slot.dateKey),
          leaveDateKeysByEmployee,
        });
        if (reasons.length === 0) return null;
        const name = guardNameById.get(guard.id) ?? guard.id;
        return `${name}: ${reasons.join("; ")}`;
      })
      .filter((line): line is string => line != null);
    const reason =
      guardBlocks.length > 0
        ? `No eligible guard for ${slotLabel}. Blocked — ${guardBlocks.join(" | ")}`
        : `No eligible guard for ${slotLabel}`;
    warnings.push({
      code: "UNCOVERED_SLOT",
      date: slot.dateKey,
      postId: slot.postId,
      message: `${slot.dateKey}: ${reason}.`,
    });
    conflicts.push({
      employeeId: "",
      date: slot.dateKey,
      reason: `${slotLabel}: ${reason}`,
    });
  }

  for (const guardId of guardIds) {
    const stats = statsByGuard.get(guardId)!;
    const worked = runtimeByGuard.get(guardId)!.workedDateKeys;
    stats.offCount = calendarDays.length - worked.size;
  }

  const relieversUsed = new Set(
    entries
      .filter((e) => candidates.find((c) => c.id === e.employeeId)?.status === "reliever")
      .map((e) => e.employeeId)
  ).size;

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

  const fairnessSpread = computeFairnessSpread(statsByGuard, shiftStaffing);
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
    startDate: startDateStr,
    endDate: endDateStr,
    entries,
    summary: {
      guardsConsidered: rosterableGuards.length,
      shiftsPlanned: entries.length,
      postsUsed: postsUsedSet.size,
      skippedGuardDays: 0,
      uncoveredDays: uncovered.length,
      fairnessSpread,
      demandSlotsTotal,
      uncoveredSlots,
      coveragePercent,
      relieversUsed,
      rotationPattern: rotationRecommendation.recommendedPatternLabel,
      rotationRecommendation: {
        recommendedPatternLabel: rotationRecommendation.recommendedPatternLabel,
        strategy: rotationRecommendation.strategy,
        reason: rotationRecommendation.reason,
        canFullyCover: rotationRecommendation.canFullyCover,
        coreGuardCount: rotationRecommendation.coreGuardCount,
        relieverGuardCount: rotationRecommendation.relieverGuardCount,
        warnings: rotationRecommendation.warnings,
      },
    },
    guardStats,
    readiness,
    warnings,
    conflicts,
  };
}

export type ApplyRosterPlanInput = {
  companyId: string;
  userId?: string;
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
      name: string;
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
  existingRestByEmployee: Map<string, Map<string, "day" | "night">>;
};

async function loadApplyValidationContext(
  companyId: string,
  siteId: string,
  plan: RosterPlan,
  rangeStart: Date,
  rangeEnd: Date,
  sitePostIds: string[],
  replaceExisting: boolean,
  timeZone: string
): Promise<ApplyValidationContext> {
  const employeeIds = [...new Set(plan.entries.map((e) => e.employeeId))];
  const postIds = [...new Set(plan.entries.map((e) => e.postId))];

  const [employees, posts, siteAssignments, existingShifts] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId, id: { in: employeeIds } },
      select: { id: true, status: true, gender: true },
    }),
    prisma.sitePost.findMany({
      where: { id: { in: postIds } },
      include: {
        coverageRequirements: { where: { isEnabled: true } },
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
                siteId,
                status: { in: ["created", "assigned"] },
              },
            }
          : {}),
      },
      select: { employeeId: true, startTime: true, endTime: true, shiftType: true },
    }),
  ]);

  const existingShiftsByEmployee = new Map<string, { startTime: Date; endTime: Date }[]>();
  const existingRestByEmployee = new Map<string, Map<string, "day" | "night">>();
  for (const shift of existingShifts) {
    const list = existingShiftsByEmployee.get(shift.employeeId) ?? [];
    list.push({ startTime: shift.startTime, endTime: shift.endTime });
    existingShiftsByEmployee.set(shift.employeeId, list);

    const dateKey = dateKeyInTimeZone(shift.startTime, timeZone);
    const shiftType =
      (shift.shiftType ?? "day").toLowerCase() === "night" ? "night" : "day";
    let restMap = existingRestByEmployee.get(shift.employeeId);
    if (!restMap) {
      restMap = new Map();
      existingRestByEmployee.set(shift.employeeId, restMap);
    }
    restMap.set(dateKey, shiftType);
  }

  return {
    employeeById: new Map(employees.map((e) => [e.id, e])),
    postById: new Map(
      posts.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          siteId: p.siteId,
          shiftType: inferPostShiftType(p.coverageRequirements),
          site: p.site,
        },
      ])
    ),
    siteAssignedEmployeeIds: new Set(siteAssignments.map((a) => a.employeeId)),
    existingShiftsByEmployee,
    existingRestByEmployee,
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
  const plannedRestByEmployee = new Map<string, Map<string, "day" | "night">>();
  const timeZone = await getCompanyTimezone(companyId);

  const validationCtx = await loadApplyValidationContext(
    companyId,
    plan.siteId,
    plan,
    start,
    end,
    [...sitePostIds],
    replaceExisting,
    timeZone
  );
  const shiftsToCreate: {
    companyId: string;
    employeeId: string;
    siteId: string;
    shiftType: string;
    legacyPostName: string | null;
    startTime: Date;
    endTime: Date;
    status: "assigned";
  }[] = [];

  for (const entry of plan.entries) {
    const startTime = new Date(entry.startTime);
    const endTime = new Date(entry.endTime);
    const dateKey = dateKeyInTimeZone(startTime, timeZone);

    let restMap = plannedRestByEmployee.get(entry.employeeId);
    if (!restMap) {
      restMap = new Map(validationCtx.existingRestByEmployee.get(entry.employeeId));
      plannedRestByEmployee.set(entry.employeeId, restMap);
    }
    if (
      violatesAdjacentShiftRestRules(restMap, {
        dateKey,
        shiftType: entry.shiftType,
      })
    ) {
      errors.push(
        `${dateKey}: Rest rule violation (cannot work day and night on the same date, or a day shift after a night shift)`
      );
      continue;
    }

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
      siteId: plan.siteId,
      shiftType: entry.shiftType,
      legacyPostName: validationCtx.postById.get(entry.postId)?.name ?? null,
      startTime,
      endTime,
      status: "assigned",
    });
    employeePlanned.push({ start: startTime, end: endTime });
    plannedByEmployee.set(entry.employeeId, employeePlanned);
    restMap.set(dateKey, entry.shiftType);
  }

  await prisma.$transaction(
    async (tx) => {
      if (replaceExisting) {
        const del = await tx.shift.deleteMany({
          where: {
            companyId,
            siteId: plan.siteId,
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
      source: userId ? undefined : "auto_roster",
    });
  }

  return {
    deleted,
    created,
    skipped: plan.entries.length - created,
    errors: errors.length > 0 ? errors : undefined,
  };
}
