import { addDays, getDay } from "date-fns";
import { prisma } from "../lib/prisma.js";

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
    const blocks: CustomBlock[] = [
      { type: "day", count: 3 },
      { type: "night", count: 3 },
      { type: "off", count: 3 },
    ];
    result.push(...iterateBlocks(d, end, blocks));
    return result;
  }

  if (pattern === "custom_builder" && customBlocks && customBlocks.length > 0) {
    const hasWork = customBlocks.some((b) => b.type === "day" || b.type === "night");
    if (!hasWork) return result;
    result.push(...iterateBlocks(d, end, customBlocks));
    return result;
  }

  return result;
}

function iterateBlocks(
  start: Date,
  end: Date,
  blocks: CustomBlock[]
): DualPatternResult {
  const result: DualPatternResult = [];
  let d = new Date(start);
  let blockIdx = 0;
  let dayInBlock = 0;

  while (d <= end) {
    const block = blocks[blockIdx];
    if (block.type === "day") {
      result.push({ date: new Date(d), shiftType: "day" });
    } else if (block.type === "night") {
      result.push({ date: new Date(d), shiftType: "night" });
    }
    dayInBlock++;
    if (dayInBlock >= block.count) {
      dayInBlock = 0;
      blockIdx = (blockIdx + 1) % blocks.length;
    }
    d = addDays(d, 1);
  }

  return result;
}

const ROSTERABLE_STATUSES = ["active", "training", "hired"] as const;

export async function validateShiftAssignment(params: {
  companyId: string;
  employeeId: string;
  postId: string;
  startTime: Date;
  endTime: Date;
  excludeShiftId?: string;
  allowRosterable?: boolean;
}): Promise<void> {
  const { companyId, employeeId, postId, startTime, endTime, excludeShiftId, allowRosterable } = params;

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
  });

  if (!employee) {
    throw new RosteringValidationError("Employee not found");
  }

  const validStatuses: readonly string[] = allowRosterable ? ROSTERABLE_STATUSES : ["active"];
  if (!validStatuses.includes(employee.status)) {
    throw new RosteringValidationError(
      `Employee must be ${allowRosterable ? "active, training, or hired" : "active"} to be assigned. Current status: ${employee.status}`
    );
  }

  const post = await prisma.post.findFirst({
    where: { id: postId },
    include: { site: true },
  });

  if (!post) {
    throw new RosteringValidationError("Post not found");
  }

  if (post.site.companyId !== companyId) {
    throw new RosteringValidationError("Post does not belong to company");
  }

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
}
