import type { CustomBlock } from "./rostering.service.js";

export type ShiftStaffingRequirements = { day: number; night: number };

function formatRotationPatternLabel(blocks: CustomBlock[]): string {
  return blocks
    .map((b) => {
      const letter = b.type === "day" ? "D" : b.type === "night" ? "N" : "O";
      return `${b.count}${letter}`;
    })
    .join("-");
}

export type RotationStrategy =
  | "equal_rotation"
  | "core_with_relievers"
  | "day_only"
  | "night_only"
  | "understaffed"
  | "custom";

export type SiteRotationRecommendation = {
  recommendedPatternLabel: string;
  blocks: CustomBlock[];
  strategy: RotationStrategy;
  reason: string;
  warnings: string[];
  coreGuardCount: number;
  relieverGuardCount: number;
  canFullyCover: boolean;
};

export type RecommendSiteRotationPatternParams = {
  guardCount: number;
  rosterableGuardCount: number;
  relieverCount: number;
  dayPostCount: number;
  nightPostCount: number;
  staffing: ShiftStaffingRequirements;
  rosterPeriodStart: Date;
  rosterPeriodEnd: Date;
  rotateAllGuards?: boolean;
};

function blocks3D3N3O(): CustomBlock[] {
  return [
    { type: "day", count: 3 },
    { type: "night", count: 3 },
    { type: "off", count: 3 },
  ];
}

function blocks2D2N4O(): CustomBlock[] {
  return [
    { type: "day", count: 2 },
    { type: "night", count: 2 },
    { type: "off", count: 4 },
  ];
}

function blocks2D2N6O(): CustomBlock[] {
  return [
    { type: "day", count: 2 },
    { type: "night", count: 2 },
    { type: "off", count: 6 },
  ];
}

function blocks2D2N8O(): CustomBlock[] {
  return [
    { type: "day", count: 2 },
    { type: "night", count: 2 },
    { type: "off", count: 8 },
  ];
}

function proportionalDualBlocks(
  staffing: ShiftStaffingRequirements,
  guardCount: number
): CustomBlock[] {
  const workersPerDay = staffing.day + staffing.night;
  const offPerCycle = Math.max(0, guardCount - workersPerDay);
  const blocks: CustomBlock[] = [];
  if (staffing.day > 0) blocks.push({ type: "day", count: staffing.day });
  if (staffing.night > 0) blocks.push({ type: "night", count: staffing.night });
  if (offPerCycle > 0) blocks.push({ type: "off", count: offPerCycle });
  return blocks;
}

function dayOffBlocks(rosterableGuardCount: number, dayStaffing: number): CustomBlock[] {
  const workersPerDay = dayStaffing;
  const offPerCycle = Math.max(1, rosterableGuardCount - workersPerDay);
  const workBlock = rosterableGuardCount <= 3 ? 3 : rosterableGuardCount <= 6 ? 4 : 3;
  return [
    { type: "day", count: workBlock },
    { type: "off", count: Math.max(workBlock, offPerCycle) },
  ];
}

function nightOffBlocks(rosterableGuardCount: number, nightStaffing: number): CustomBlock[] {
  const workersPerDay = nightStaffing;
  const offPerCycle = Math.max(1, rosterableGuardCount - workersPerDay);
  const workBlock = rosterableGuardCount <= 3 ? 3 : rosterableGuardCount <= 6 ? 4 : 3;
  return [
    { type: "night", count: workBlock },
    { type: "off", count: Math.max(workBlock, offPerCycle) },
  ];
}

function minGuardsForFullCoverage(
  staffing: ShiftStaffingRequirements,
  isDayOnly: boolean,
  isNightOnly: boolean
): number {
  const workersPerDay = staffing.day + staffing.night;
  if (isDayOnly) return staffing.day + 1;
  if (isNightOnly) return staffing.night + 1;
  if (staffing.day === staffing.night && staffing.day === 1) {
    return 3;
  }
  return workersPerDay + 1;
}

function isEqualOneToOneStaffing(staffing: ShiftStaffingRequirements): boolean {
  return staffing.day === 1 && staffing.night === 1;
}

/**
 * Recommend the most suitable rotation pattern for a site before roster generation.
 * Does not require manual pattern selection — derives blocks from guards, posts, and staffing.
 */
export function recommendSiteRotationPattern(
  params: RecommendSiteRotationPatternParams
): SiteRotationRecommendation {
  const {
    guardCount,
    rosterableGuardCount,
    relieverCount,
    dayPostCount,
    nightPostCount,
    staffing,
    rotateAllGuards = false,
  } = params;

  const warnings: string[] = [];
  const workersPerDay = staffing.day + staffing.night;
  const isDayOnly = staffing.night === 0 && staffing.day > 0;
  const isNightOnly = staffing.day === 0 && staffing.night > 0;
  const isDual = staffing.day > 0 && staffing.night > 0;

  if (staffing.day > 0 && dayPostCount === 0) {
    warnings.push("Day staffing is configured but no day post exists on this site.");
  }
  if (staffing.night > 0 && nightPostCount === 0) {
    warnings.push("Night staffing is configured but no night post exists on this site.");
  }

  const minCover = minGuardsForFullCoverage(staffing, isDayOnly, isNightOnly);
  const canFullyCover = rosterableGuardCount >= minCover;

  if (rosterableGuardCount < workersPerDay) {
    return {
      recommendedPatternLabel: "—",
      blocks: [],
      strategy: "understaffed",
      reason: `This site requires ${staffing.day} day and ${staffing.night} night guard(s) per day (${workersPerDay} total), but only ${rosterableGuardCount} rosterable guard(s) are assigned. Add more guards, reduce staffing requirements, or assign relievers.`,
      warnings: [
        ...warnings,
        `Assigned rosterable guards (${rosterableGuardCount}) are below daily demand (${workersPerDay}).`,
      ],
      coreGuardCount: rosterableGuardCount,
      relieverGuardCount: 0,
      canFullyCover: false,
    };
  }

  if (isDayOnly) {
    const blocks = dayOffBlocks(rosterableGuardCount, staffing.day);
    const label = formatRotationPatternLabel(blocks);
    return {
      recommendedPatternLabel: label,
      blocks,
      strategy: "day_only",
      reason: `This site runs day shifts only (${staffing.day} guard(s) per day, ${dayPostCount} day post(s)). Pattern ${label} rotates work and off days fairly across ${rosterableGuardCount} guard(s).`,
      warnings,
      coreGuardCount: rosterableGuardCount,
      relieverGuardCount: 0,
      canFullyCover: rosterableGuardCount >= staffing.day + 1,
    };
  }

  if (isNightOnly) {
    const blocks = nightOffBlocks(rosterableGuardCount, staffing.night);
    const label = formatRotationPatternLabel(blocks);
    return {
      recommendedPatternLabel: label,
      blocks,
      strategy: "night_only",
      reason: `This site runs night shifts only (${staffing.night} guard(s) per night, ${nightPostCount} night post(s)). Pattern ${label} balances night workload and rest across ${rosterableGuardCount} guard(s).`,
      warnings,
      coreGuardCount: rosterableGuardCount,
      relieverGuardCount: 0,
      canFullyCover: rosterableGuardCount >= staffing.night + 1,
    };
  }

  if (!isDual) {
    return {
      recommendedPatternLabel: "—",
      blocks: [],
      strategy: "understaffed",
      reason: "At least one shift must require guards before a rotation pattern can be recommended.",
      warnings,
      coreGuardCount: 0,
      relieverGuardCount: 0,
      canFullyCover: false,
    };
  }

  if (!isEqualOneToOneStaffing(staffing)) {
    const blocks = proportionalDualBlocks(staffing, rosterableGuardCount);
    const label = formatRotationPatternLabel(blocks);
    if (rosterableGuardCount < workersPerDay + 1) {
      warnings.push(
        `With ${staffing.day} day and ${staffing.night} night guard(s) required daily, ${workersPerDay + 1}+ rosterable guards are recommended for sustainable rest.`
      );
    }
    return {
      recommendedPatternLabel: label,
      blocks,
      strategy: rosterableGuardCount > workersPerDay + 2 ? "core_with_relievers" : "equal_rotation",
      reason: `This site requires ${staffing.day} day and ${staffing.night} night guard(s) per day. Pattern ${label} matches daily demand with ${rosterableGuardCount} guard(s) on a ${blocks.reduce((s, b) => s + b.count, 0)}-day cycle.`,
      warnings,
      coreGuardCount: Math.min(rosterableGuardCount, workersPerDay + 2),
      relieverGuardCount: Math.max(0, rosterableGuardCount - (workersPerDay + 2)),
      canFullyCover: rosterableGuardCount >= workersPerDay,
    };
  }

  // Equal 1 day + 1 night post staffing (classic 24/7 site)
  const postSummary = `${dayPostCount} day post(s) and ${nightPostCount} night post(s)`;

  if (rosterableGuardCount === 2) {
    return {
      recommendedPatternLabel: "—",
      blocks: blocks3D3N3O(),
      strategy: "understaffed",
      reason: `This site has 2 guards with ${postSummary}. Two guards cannot fairly cover day and night shifts with proper off days.`,
      warnings: [
        ...warnings,
        "Recommend adding at least 1 more guard or assigning a reliever for sustainable 24/7 coverage.",
      ],
      coreGuardCount: 2,
      relieverGuardCount: relieverCount,
      canFullyCover: false,
    };
  }

  if (rosterableGuardCount === 3) {
    const blocks = blocks3D3N3O();
    return {
      recommendedPatternLabel: "3D-3N-3O",
      blocks,
      strategy: "equal_rotation",
      reason: `This site has 3 guards with ${postSummary}. The 3D-3N-3O pattern staggers guards so one works days, one works nights, and one is off each day.`,
      warnings,
      coreGuardCount: 3,
      relieverGuardCount: 0,
      canFullyCover: true,
    };
  }

  if (rosterableGuardCount === 4) {
    const blocks = blocks2D2N4O();
    return {
      recommendedPatternLabel: "2D-2N-4O",
      blocks,
      strategy: "equal_rotation",
      reason: `This site has 4 guards with ${postSummary}. Pattern 2D-2N-4O uses shorter shift blocks and longer rest for better balance than 3D-3N-3O.`,
      warnings,
      coreGuardCount: 4,
      relieverGuardCount: 0,
      canFullyCover: true,
    };
  }

  if (rosterableGuardCount === 5) {
    if (rotateAllGuards) {
      const blocks = blocks2D2N6O();
      return {
        recommendedPatternLabel: "2D-2N-6O",
        blocks,
        strategy: "equal_rotation",
        reason: `All 5 guards rotate equally on 2D-2N-6O for ${postSummary}. Relievers are not held in a separate pool.`,
        warnings,
        coreGuardCount: 5,
        relieverGuardCount: 0,
        canFullyCover: true,
      };
    }
    const blocks = blocks2D2N4O();
    return {
      recommendedPatternLabel: "2D-2N-4O",
      blocks,
      strategy: "core_with_relievers",
      reason: `This site has 5 guards with ${postSummary}. Four core guards rotate on 2D-2N-4O; the remaining guard acts as reliever for leave and gaps.`,
      warnings:
        relieverCount === 0
          ? [...warnings, "No guards are marked as reliever — the 5th guard will still be used as fallback only."]
          : warnings,
      coreGuardCount: 4,
      relieverGuardCount: 1,
      canFullyCover: true,
    };
  }

  if (rosterableGuardCount === 6) {
    if (rotateAllGuards) {
      const blocks = blocks2D2N8O();
      return {
        recommendedPatternLabel: "2D-2N-8O",
        blocks,
        strategy: "equal_rotation",
        reason: `All 6 guards rotate equally on 2D-2N-8O for ${postSummary}.`,
        warnings,
        coreGuardCount: 6,
        relieverGuardCount: 0,
        canFullyCover: true,
      };
    }
    const blocks = blocks2D2N4O();
    return {
      recommendedPatternLabel: "2D-2N-4O",
      blocks,
      strategy: "core_with_relievers",
      reason: `This site has 6 guards with ${postSummary}. Four core guards rotate on 2D-2N-4O; two guards form the reliever pool.`,
      warnings:
        relieverCount < 2
          ? [...warnings, "Fewer than 2 relievers are marked — non-core guards still act as fallback when needed."]
          : warnings,
      coreGuardCount: 4,
      relieverGuardCount: 2,
      canFullyCover: true,
    };
  }

  // 7+ guards on 1:1 staffing
  const blocks = blocks2D2N4O();
  const coreGuardCount = 4;
  const relieverGuardCount = rosterableGuardCount - coreGuardCount;
  warnings.push(
    `This site has ${rosterableGuardCount} guards but only needs 1 day and 1 night guard per day. ${coreGuardCount} core guards rotate; ${relieverGuardCount} form the reliever pool.`
  );
  if (guardCount > rosterableGuardCount) {
    warnings.push(
      `${guardCount - rosterableGuardCount} assigned guard(s) are not rosterable and will be excluded from generation.`
    );
  }

  return {
    recommendedPatternLabel: "2D-2N-4O",
    blocks,
    strategy: "core_with_relievers",
    reason: `This site has ${rosterableGuardCount} rosterable guards with ${postSummary} — more than needed for daily staffing. Four core guards use 2D-2N-4O; ${relieverGuardCount} reliever(s) cover leave and shortages.`,
    warnings,
    coreGuardCount,
    relieverGuardCount,
    canFullyCover: true,
  };
}

/** Split rosterable guards into core rotation vs reliever pool per recommendation. */
export function partitionGuardsForRotation(
  guards: { id: string; status: string }[],
  recommendation: SiteRotationRecommendation
): { coreGuardIds: string[]; relieverGuardIds: string[] } {
  if (recommendation.strategy !== "core_with_relievers" || recommendation.blocks.length === 0) {
    return {
      coreGuardIds: guards.map((g) => g.id),
      relieverGuardIds: [],
    };
  }

  const nonRelievers = guards.filter((g) => g.status !== "reliever");
  const relievers = guards.filter((g) => g.status === "reliever");
  const coreCount = recommendation.coreGuardCount;

  const coreGuardIds = nonRelievers.slice(0, coreCount).map((g) => g.id);
  if (coreGuardIds.length < coreCount) {
    const needed = coreCount - coreGuardIds.length;
    coreGuardIds.push(...relievers.slice(0, needed).map((g) => g.id));
  }

  const coreSet = new Set(coreGuardIds);
  const relieverGuardIds = guards.filter((g) => !coreSet.has(g.id)).map((g) => g.id);

  return { coreGuardIds, relieverGuardIds };
}
