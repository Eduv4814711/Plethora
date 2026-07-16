import { addDays, differenceInCalendarDays, getDay } from "date-fns";
import { prisma } from "../lib/prisma.js";
import { inferPostShiftType } from "../lib/site-post-api.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../lib/timezone.js";
import { violatesAdjacentShiftRestRules } from "./roster-scheduler.js";

export class RosteringValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosteringValidationError";
  }
}

export type BulkPattern =
  | "all_days"
  | "weekdays"
  | "2_on_2_off"
  | "4_on_4_off"
  | "5_on_2_off"
  | "6_on_3_off"
  | "3_on_3_off"
  | "custom"
  | "custom_builder";

export type CustomBlockType = "day" | "night" | "off";

export interface CustomBlock {
  type: CustomBlockType;
  count: number;
}

export type DualPatternResult = { date: Date; shiftType: "day" | "night" }[];

/**
 * Compute which dates in [startDate, endDate] should get shifts based on pattern.
 * Returns array of Date objects (at midnight) for each day that gets a shift.
 */
export function computeDatesFromPattern(
  startDate: Date,
  endDate: Date,
  pattern: BulkPattern,
  customDays?: number[]
): Date[] {
  const dates: Date[] = [];
  let d = new Date(startDate);
  d.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  if (pattern === "all_days") {
    while (d <= end) {
      dates.push(new Date(d));
      d = addDays(d, 1);
    }
    return dates;
  }

  if (pattern === "weekdays") {
    while (d <= end) {
      const day = getDay(d);
      if (day >= 1 && day <= 5) dates.push(new Date(d));
      d = addDays(d, 1);
    }
    return dates;
  }

  if (pattern === "custom" && customDays && customDays.length > 0) {
    const set = new Set(customDays);
    while (d <= end) {
      if (set.has(getDay(d))) dates.push(new Date(d));
      d = addDays(d, 1);
    }
    return dates;
  }

  if (
    pattern === "2_on_2_off" ||
    pattern === "4_on_4_off" ||
    pattern === "5_on_2_off" ||
    pattern === "6_on_3_off"
  ) {
    const [daysOn, daysOff] =
      pattern === "2_on_2_off"
        ? [2, 2]
        : pattern === "4_on_4_off"
          ? [4, 4]
          : pattern === "5_on_2_off"
            ? [5, 2]
            : [6, 3];

    let dayIndex = 0;
    let onCount = 0;
    let offCount = 0;
    let inOnBlock = true;

    while (d <= end) {
      if (inOnBlock) {
        dates.push(new Date(d));
        onCount++;
        if (onCount >= daysOn) {
          onCount = 0;
          inOnBlock = false;
        }
      } else {
        offCount++;
        if (offCount >= daysOff) {
          offCount = 0;
          inOnBlock = true;
        }
      }
      d = addDays(d, 1);
    }
    return dates;
  }

  return dates;
}

/**
 * Compute dates with shift type (day/night) for dual-type patterns.
 * Returns array of { date, shiftType } for each day that gets a shift.
 * Used for 3_on_3_off (3D3N3O) and custom_builder.
 */
export function computeDatesFromPatternDual(
  startDate: Date,
  endDate: Date,
  pattern: "3_on_3_off" | "custom_builder",
  customBlocks?: CustomBlock[]
): DualPatternResult {
  const result: DualPatternResult = [];
  const d = new Date(startDate.getTime());
  const end = new Date(endDate.getTime());

  if (pattern === "3_on_3_off") {
    return buildGuardPatternSchedule(d, end, dualPatternBlocks3On3Off(), 0);
  }

  if (pattern === "custom_builder" && customBlocks && customBlocks.length > 0) {
    const hasWork = customBlocks.some((b) => b.type === "day" || b.type === "night");
    if (!hasWork) return result;
    return buildGuardPatternSchedule(d, end, customBlocks, 0);
  }

  return result;
}

export function dualPatternBlocks3On3Off(): CustomBlock[] {
  return [
    { type: "day", count: 3 },
    { type: "night", count: 3 },
    { type: "off", count: 3 },
  ];
}

/** Block index and day-within-block for a position in the cycle (0 .. cycleLength-1). */
export function cyclePositionToBlockCursor(
  blocks: CustomBlock[],
  positionInCycle: number
): { blockIdx: number; dayInBlock: number } {
  const cycleLength = blocks.reduce((sum, b) => sum + b.count, 0);
  if (cycleLength === 0) return { blockIdx: 0, dayInBlock: 0 };

  const pos = ((positionInCycle % cycleLength) + cycleLength) % cycleLength;
  let cursor = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (pos < cursor + block.count) {
      return { blockIdx: i, dayInBlock: pos - cursor };
    }
    cursor += block.count;
  }
  return { blockIdx: 0, dayInBlock: 0 };
}

/** Shift preference at cycle position p(g,t) = ((t - offsetDays) mod L). */
export function getShiftPreferenceFromBlocks(
  dayIndexFromStart: number,
  blocks: CustomBlock[]
): CustomBlockType {
  const cycleLength = blocks.reduce((sum, b) => sum + b.count, 0);
  if (cycleLength === 0) return "off";

  const pos = ((dayIndexFromStart % cycleLength) + cycleLength) % cycleLength;
  let cursor = 0;
  for (const block of blocks) {
    if (pos < cursor + block.count) {
      return block.type;
    }
    cursor += block.count;
  }
  return "off";
}

/**
 * Build shift dates for one guard from block pattern with phase offset o_g.
 * Calendar day t uses position ((t - offsetDays) mod L) — same as the preference grid.
 * Off blocks produce no entries (rest days).
 */
export function buildGuardPatternSchedule(
  startDate: Date,
  endDate: Date,
  blocks: CustomBlock[],
  offsetDays = 0
): DualPatternResult {
  const result: DualPatternResult = [];
  if (blocks.length === 0) return result;

  const rangeStart = new Date(startDate);
  rangeStart.setUTCHours(0, 0, 0, 0);
  let d = new Date(rangeStart);
  const end = new Date(endDate);
  end.setUTCHours(23, 59, 59, 999);

  while (d <= end) {
    const t = differenceInCalendarDays(d, rangeStart);
    const preference = getShiftPreferenceFromBlocks(t - offsetDays, blocks);
    if (preference === "day") {
      result.push({ date: new Date(d), shiftType: "day" });
    } else if (preference === "night") {
      result.push({ date: new Date(d), shiftType: "night" });
    }
    d = addDays(d, 1);
  }

  return result;
}

const ROSTERABLE_STATUSES = ["active", "training", "hired", "reliever"] as const;

type SiteShiftGenderRule = "male" | "female" | "any";

function normalizeSiteShiftGenderRule(v: string | null | undefined): SiteShiftGenderRule | null {
  if (v == null || v === "") return null;
  const s = String(v).toLowerCase();
  if (s === "male" || s === "female" || s === "any") return s;
  return null;
}

/** Maps employee profile gender (M/F, male/female) to roster enforcement axis. */
export function normalizeEmployeeGenderForRoster(g: string | null | undefined): "male" | "female" | null {
  const raw = (g ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "m" || raw === "male") return "male";
  if (raw === "f" || raw === "female") return "female";
  return null;
}

/**
 * True if the employee satisfies the site's staffing rule for this post's shift type
 * (day vs night). Unspecified / "any" rules always pass.
 */
export function meetsSiteShiftGenderRule(
  employeeGender: string | null | undefined,
  site: { rosterDayShiftGender: string | null; rosterNightShiftGender: string | null },
  postShiftType: string | null | undefined
): boolean {
  const kind = (postShiftType ?? "day").toLowerCase() === "night" ? "night" : "day";
  const ruleRaw = kind === "night" ? site.rosterNightShiftGender : site.rosterDayShiftGender;
  const rule = normalizeSiteShiftGenderRule(ruleRaw);
  if (rule == null || rule === "any") return true;
  const emp = normalizeEmployeeGenderForRoster(employeeGender);
  if (emp === null) return false;
  return emp === rule;
}

function assertSiteShiftGenderRule(
  employeeGender: string | null | undefined,
  site: { rosterDayShiftGender: string | null; rosterNightShiftGender: string | null },
  postShiftType: string | null | undefined
): void {
  const kind = (postShiftType ?? "day").toLowerCase() === "night" ? "night" : "day";
  const ruleRaw = kind === "night" ? site.rosterNightShiftGender : site.rosterDayShiftGender;
  const rule = normalizeSiteShiftGenderRule(ruleRaw);
  if (rule == null || rule === "any") return;

  const emp = normalizeEmployeeGenderForRoster(employeeGender);
  if (emp === null) {
    throw new RosteringValidationError(
      `This site requires ${rule === "male" ? "male" : "female"} guards on ${kind} shift. Set the guard's gender on their employee profile, or change the site's shift staffing rules.`
    );
  }
  if (emp !== rule) {
    throw new RosteringValidationError(
      `This site requires ${rule === "male" ? "male" : "female"} guards on ${kind} shift; this guard's profile does not match.`
    );
  }
}

export async function validateShiftAssignment(params: {
  companyId: string;
  employeeId: string;
  /** Legacy: resolve site + shift type from post when siteId omitted. */
  postId?: string;
  siteId?: string;
  shiftType?: string | null;
  startTime: Date;
  endTime: Date;
  excludeShiftId?: string;
  allowRosterable?: boolean;
  /** When false (default), employee must have a SiteAssignment for the post's site. */
  allowUnassigned?: boolean;
}): Promise<void> {
  const {
    companyId,
    employeeId,
    postId,
    startTime,
    endTime,
    excludeShiftId,
    allowRosterable,
    allowUnassigned,
  } = params;

  let siteId = params.siteId;
  let shiftType = params.shiftType ?? "day";
  let site: { companyId: string; rosterDayShiftGender: string | null; rosterNightShiftGender: string | null } | null =
    null;

  if (postId && !siteId) {
    const post = await prisma.sitePost.findFirst({
      where: { id: postId },
      include: { site: true, coverageRequirements: { where: { isEnabled: true } } },
    });
    if (!post) throw new RosteringValidationError("Post not found");
    siteId = post.siteId;
    shiftType = inferPostShiftType(post.coverageRequirements) ?? "day";
    site = post.site;
  } else if (siteId) {
    site = await prisma.site.findFirst({ where: { id: siteId, companyId } });
    if (!site) throw new RosteringValidationError("Site not found");
  }

  if (!siteId || !site) {
    throw new RosteringValidationError("Site not found for shift assignment");
  }

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
  });

  if (!employee) {
    throw new RosteringValidationError("Employee not found");
  }

  const validStatuses: readonly string[] = allowRosterable ? ROSTERABLE_STATUSES : ["active"];
  if (!validStatuses.includes(employee.status)) {
    throw new RosteringValidationError(
      `Employee must be ${allowRosterable ? "active, training, hired, or reliever" : "active"} to be assigned. Current status: ${employee.status}`
    );
  }

  if (site.companyId !== companyId) {
    throw new RosteringValidationError("Site does not belong to company");
  }

  if (!allowUnassigned) {
    const siteAssignment = await prisma.siteAssignment.findFirst({
      where: { siteId, employeeId, isActive: true },
    });
    if (!siteAssignment) {
      throw new RosteringValidationError(
        "Employee is not assigned to this site. Assign the guard to the site in Sites first."
      );
    }
  }

  assertSiteShiftGenderRule(employee.gender, site, shiftType);

  const overlapping = await prisma.shift.findFirst({
    where: {
      employeeId,
      id: excludeShiftId ? { not: excludeShiftId } : undefined,
      OR: [
        {
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      ],
    },
  });

  if (overlapping) {
    throw new RosteringValidationError(
      "Employee has an overlapping shift in this time range"
    );
  }

  const timeZone = await getCompanyTimezone(companyId);
  const candidateDateKey = dateKeyInTimeZone(startTime, timeZone);
  const candidateShiftType =
    (shiftType ?? "day").toLowerCase() === "night" ? "night" : "day";

  const restRangeStart = addDays(new Date(`${candidateDateKey}T00:00:00.000Z`), -2);
  const restRangeEnd = addDays(new Date(`${candidateDateKey}T00:00:00.000Z`), 2);
  restRangeEnd.setUTCHours(23, 59, 59, 999);

  const nearbyShifts = await prisma.shift.findMany({
    where: {
      employeeId,
      companyId,
      id: excludeShiftId ? { not: excludeShiftId } : undefined,
      startTime: { lt: restRangeEnd },
      endTime: { gt: restRangeStart },
    },
    select: { startTime: true, shiftType: true },
  });

  const assignmentsByDate = new Map<string, "day" | "night">();
  for (const s of nearbyShifts) {
    const key = dateKeyInTimeZone(s.startTime, timeZone);
    const kind =
      (s.shiftType ?? "day").toLowerCase() === "night" ? "night" : "day";
    assignmentsByDate.set(key, kind);
  }

  if (
    violatesAdjacentShiftRestRules(assignmentsByDate, {
      dateKey: candidateDateKey,
      shiftType: candidateShiftType,
    })
  ) {
    throw new RosteringValidationError(
      "Rest rule violation: a guard cannot work day and night on the same date, or a day shift immediately after a night shift."
    );
  }
}
