import { Prisma, type ShiftStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { canTransitionShift } from "../../lib/state-machines.js";
import { createAuditLog } from "../../lib/audit.js";
import { auditManualShiftEdit, auditRosterReset } from "../../lib/roster-audit.js";
import { getCompanyTimezone, getShiftTimes, parseDateOnly, parseDateOnlyEnd, dateKeyInTimeZone } from "../../lib/timezone.js";
import { getLeaveDateKeysByEmployee } from "../../services/leave-availability.service.js";
import {
  validateShiftAssignment,
  RosteringValidationError,
  computeDatesFromPattern,
  computeDatesFromPatternDual,
  meetsSiteShiftGenderRule,
  type BulkPattern,
} from "../../services/rostering.service.js";
import {
  generateRosterPlan,
  applyRosterPlan,
  buildEmployeePostAssignmentMap,
  findApprovedLeaveConflictsForPlan,
  RosterPlanValidationError,
  resolvePostForShiftSlot,
  type PostWithAssignments,
  type RosterPlan,
} from "../../services/roster-engine.service.js";
import { violatesAdjacentShiftRestRules } from "../../services/roster-scheduler.js";
import { rosteringRepository } from "./rostering.repository.js";
import { resolveShiftSiteFieldsFromPost } from "../../lib/shift-site-fields.js";
import { inferPostShiftType } from "../../lib/site-post-api.js";
import type {
  BulkCreateInput,
  CreateShiftInput,
  CustomBlock,
  ResetInput,
  RosterApplyInput,
  RosterPreviewInput,
  UpdateShiftInput,
} from "./rostering.schemas.js";
import { rosterPlanSchema } from "./rostering.schemas.js";
import type { z } from "zod";

const MAX_SHIFT_LIST_LIMIT = 1000;

export type RosteringServiceError = {
  status: number;
  body: Record<string, unknown>;
};

export type BulkCreateResult = {
  deleted: number;
  created: number;
  skipped: number;
  errors?: string[];
};

type BulkShiftCreateInput = Omit<
  Prisma.ShiftCreateManyInput,
  "startTime" | "endTime"
> & {
  startTime: Date;
  endTime: Date;
};

function validateBulkShiftSequence(
  shifts: { startTime: Date; endTime: Date; shiftType: "day" | "night" }[],
  timeZone: string
): string[] {
  const errors: string[] = [];
  const planned: { startTime: Date; endTime: Date }[] = [];
  const restByDate = new Map<string, "day" | "night">();
  for (const shift of [...shifts].sort((a, b) => a.startTime.getTime() - b.startTime.getTime())) {
    const dateKey = dateKeyInTimeZone(shift.startTime, timeZone);
    if (
      planned.some(
        (existing) =>
          shift.startTime < existing.endTime && shift.endTime > existing.startTime
      )
    ) {
      errors.push(`${dateKey}: Overlaps another shift in this roster plan`);
      continue;
    }
    if (
      violatesAdjacentShiftRestRules(restByDate, {
        dateKey,
        shiftType: shift.shiftType,
      })
    ) {
      errors.push(
        `${dateKey}: Rest rule violation (cannot work day and night on the same date, or a day shift after a night shift)`
      );
      continue;
    }
    planned.push(shift);
    restByDate.set(dateKey, shift.shiftType);
  }
  return errors;
}

async function replaceBulkShiftsAtomically(params: {
  companyId: string;
  deleteWhere: Prisma.ShiftWhereInput;
  shifts: BulkShiftCreateInput[];
  timeZone: string;
}): Promise<BulkCreateResult | RosteringServiceError> {
  let deleted = 0;
  let created = 0;
  try {
    await prisma.$transaction(
      async (tx) => {
        const leaveConflicts = await findApprovedLeaveConflictsForPlan(
          tx,
          params.companyId,
          params.shifts.map((shift) => ({
            employeeId: shift.employeeId,
            startTime: shift.startTime,
          })),
          params.timeZone
        );
        if (leaveConflicts.length > 0) {
          throw new RosterPlanValidationError(leaveConflicts);
        }
        deleted = (await tx.shift.deleteMany({ where: params.deleteWhere })).count;
        created =
          params.shifts.length > 0
            ? (await tx.shift.createMany({ data: params.shifts })).count
            : 0;
      },
      {
        maxWait: 10_000,
        timeout: Math.min(120_000, 15_000 + params.shifts.length * 50),
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );
  } catch (error) {
    if (error instanceof RosterPlanValidationError) {
      return {
        status: 409,
        body: {
          error: "Roster plan is no longer valid",
          message: "No existing shifts were replaced.",
          conflicts: error.errors,
        },
      };
    }
    throw error;
  }
  return { deleted, created, skipped: 0 };
}

const defaultFairnessSpread: RosterPlan["summary"]["fairnessSpread"] = {
  maxDayMinusMinDay: 0,
  maxNightMinusMinNight: 0,
  maxSundayMinusMinSunday: 0,
  maxDayNightImbalance: 0,
};

function normalizeRosterPlanSummary(
  summary: z.infer<typeof rosterPlanSchema>["summary"],
  entryCount: number
): RosterPlan["summary"] {
  const spread = summary?.fairnessSpread;
  return {
    guardsConsidered: summary?.guardsConsidered ?? 0,
    shiftsPlanned: summary?.shiftsPlanned ?? entryCount,
    postsUsed: summary?.postsUsed ?? 0,
    skippedGuardDays: summary?.skippedGuardDays ?? 0,
    uncoveredDays: summary?.uncoveredDays ?? 0,
    fairnessSpread: spread
      ? {
          maxDayMinusMinDay: spread.maxDayMinusMinDay,
          maxNightMinusMinNight: spread.maxNightMinusMinNight,
          maxSundayMinusMinSunday: spread.maxSundayMinusMinSunday,
          maxDayNightImbalance: spread.maxDayNightImbalance ?? 0,
        }
      : defaultFairnessSpread,
  };
}

function buildShiftListWhere(
  companyId: string,
  query: Record<string, string | undefined>
): Prisma.ShiftWhereInput {
  const where: Prisma.ShiftWhereInput = { companyId };
  if (query.employeeId) where.employeeId = query.employeeId;
  if (query.siteId) where.siteId = query.siteId;
  const startDate = query.startDate;
  const endDate = query.endDate;
  if (startDate && endDate) {
    const start = parseDateOnly(startDate.slice(0, 10));
    const end = parseDateOnlyEnd(endDate.slice(0, 10));
    where.startTime = { lt: end };
    where.endTime = { gt: start };
  } else if (startDate) {
    where.endTime = { gt: parseDateOnly(startDate.slice(0, 10)) };
  } else if (endDate) {
    where.startTime = { lt: parseDateOnlyEnd(endDate.slice(0, 10)) };
  }
  return where;
}

export const rosteringModuleService = {
  async listShifts(companyId: string, query: Record<string, string | undefined>) {
    const limit = Math.min(Number(query.limit) || 50, MAX_SHIFT_LIST_LIMIT);
    const offset = Number(query.offset) || 0;
    const where = buildShiftListWhere(companyId, query);
    const [shifts, total] = await Promise.all([
      rosteringRepository.findShifts({ where, limit, offset }),
      rosteringRepository.countShifts(where),
    ]);
    return { data: shifts, total, limit, offset };
  },

  async createShift(
    companyId: string,
    userId: string,
    input: CreateShiftInput
  ): Promise<{ shift: Awaited<ReturnType<typeof rosteringRepository.createShift>> } | RosteringServiceError> {
    const startTime = new Date(input.startTime);
    const endTime = new Date(input.endTime);
    if (startTime >= endTime) {
      return {
        status: 400,
        body: { error: "Validation error", message: "endTime must be after startTime" },
      };
    }
    const siteFields = await resolveShiftSiteFieldsFromPost(input.postId, companyId);
    if (!siteFields) {
      return { status: 400, body: { error: "Validation error", message: "Post not found" } };
    }
    try {
      await validateShiftAssignment({
        companyId,
        employeeId: input.employeeId,
        siteId: siteFields.siteId,
        shiftType: siteFields.shiftType,
        startTime,
        endTime,
      });
    } catch (err) {
      if (err instanceof RosteringValidationError) {
        return {
          status: 400,
          body: { error: "Rostering validation failed", message: err.message },
        };
      }
      throw err;
    }
    const shift = await rosteringRepository.createShift({
      companyId,
      employeeId: input.employeeId,
      siteId: siteFields.siteId,
      shiftType: siteFields.shiftType,
      legacyPostName: siteFields.legacyPostName,
      startTime,
      endTime,
      status: input.status,
    });
    await createAuditLog({
      userId,
      companyId,
      action: "shift.create",
      entityType: "shift",
      entityId: shift.id,
    });
    return { shift };
  },

  async resetShifts(
    companyId: string,
    userId: string,
    input: ResetInput
  ): Promise<{ deleted: number } | RosteringServiceError> {
    const start = new Date(`${input.startDate.slice(0, 10)}T00:00:00.000Z`);
    const end = new Date(`${input.endDate.slice(0, 10)}T23:59:59.999Z`);
    if (start > end) {
      return {
        status: 400,
        body: { error: "Validation error", message: "endDate must be on or after startDate" },
      };
    }
    const where: Prisma.ShiftWhereInput = {
      companyId,
      status: { in: ["created", "assigned"] },
      startTime: { lt: end },
      endTime: { gt: start },
      ...(input.employeeId && { employeeId: input.employeeId }),
      ...(input.siteId && { siteId: input.siteId }),
    };
    const deleted = await rosteringRepository.deleteShifts(where);
    if (deleted.count > 0) {
      await auditRosterReset({
        userId,
        companyId,
        startDate: input.startDate,
        endDate: input.endDate,
        employeeId: input.employeeId,
        siteId: input.siteId,
        deleted: deleted.count,
      });
      await createAuditLog({
        userId,
        companyId,
        action: "shift.reset",
        entityType: "shift",
        metadata: {
          startDate: input.startDate,
          endDate: input.endDate,
          employeeId: input.employeeId,
          siteId: input.siteId,
          deleted: deleted.count,
        },
      });
    }
    return { deleted: deleted.count };
  },

  async bulkCreate(
    companyId: string,
    userId: string,
    input: BulkCreateInput
  ): Promise<BulkCreateResult | RosteringServiceError> {
    const start = parseDateOnly(input.startDate.slice(0, 10));
    const end = parseDateOnlyEnd(input.endDate.slice(0, 10));
    if (start > end) {
      return {
        status: 400,
        body: { error: "Validation error", message: "endDate must be on or after startDate" },
      };
    }
    if (input.pattern === "custom" && (!input.customDays || input.customDays.length === 0)) {
      return {
        status: 400,
        body: { error: "Validation error", message: "customDays required when pattern is custom" },
      };
    }
    if (input.siteId) {
      return this.bulkCreateForSite(companyId, userId, {
        employeeId: input.employeeId,
        siteId: input.siteId,
        start,
        end,
        pattern: input.pattern as "3_on_3_off" | "custom_builder",
        customBlocks: input.customBlocks,
      });
    }
    if (!input.postId) {
      return {
        status: 400,
        body: { error: "Validation error", message: "postId or siteId is required" },
      };
    }
    return this.bulkCreateForPost(companyId, userId, {
      employeeId: input.employeeId,
      postId: input.postId,
      start,
      end,
      pattern: input.pattern as BulkPattern,
      customDays: input.customDays,
      startDate: input.startDate,
      endDate: input.endDate,
    });
  },

  async bulkCreateForSite(
    companyId: string,
    userId: string,
    params: {
      employeeId: string;
      siteId: string;
      start: Date;
      end: Date;
      pattern: "3_on_3_off" | "custom_builder";
      customBlocks?: CustomBlock[];
    }
  ): Promise<BulkCreateResult | RosteringServiceError> {
    const site = await rosteringRepository.findSiteWithPostsForBulk(params.siteId, companyId);
    if (!site) {
      return { status: 404, body: { error: "Site not found" } };
    }
    const postsWithAssignments = site.posts.map((p) => ({
      ...p,
      shiftType: inferPostShiftType(p.coverageRequirements),
      assignedGuards: p.guardEligibilities.map((g) => ({ employeeId: g.employeeId })),
    })) as PostWithAssignments[];
    const dayPosts = postsWithAssignments.filter((p) => (p.shiftType ?? "day") === "day");
    const nightPosts = postsWithAssignments.filter((p) => p.shiftType === "night");
    if (dayPosts.length === 0) {
      return {
        status: 400,
        body: { error: "Site has no day post", message: "Add a day post to use this pattern." },
      };
    }
    if (nightPosts.length === 0) {
      return {
        status: 400,
        body: { error: "Site has no night post", message: "Add a night post to use this pattern." },
      };
    }
    const dualDates = computeDatesFromPatternDual(
      params.start,
      params.end,
      params.pattern,
      params.customBlocks
    );
    if (params.pattern === "custom_builder" && dualDates.length === 0) {
      return {
        status: 400,
        body: {
          error: "Pattern must include at least one day or night block",
          message: "Pattern must include at least one day or night block.",
        },
      };
    }
    const timeZone = await getCompanyTimezone(companyId);
    const postAssignmentByEmployee = buildEmployeePostAssignmentMap(postsWithAssignments);
    const roundRobin = { day: 0, night: 0 };
    const deleteWhere: Prisma.ShiftWhereInput = {
      companyId,
      employeeId: params.employeeId,
      siteId: params.siteId,
      status: { in: ["created", "assigned"] },
      startTime: { lt: params.end },
      endTime: { gt: params.start },
    };
    const replaceableShiftIds = await prisma.shift.findMany({
      where: deleteWhere,
      select: { id: true },
    });
    const excludedShiftIds = replaceableShiftIds.map((shift) => shift.id);
    const shiftsToCreate: BulkShiftCreateInput[] = [];
    const errors: string[] = [];
    for (const { date, shiftType } of dualDates) {
      const post = resolvePostForShiftSlot({
        employeeId: params.employeeId,
        shiftType,
        dayPosts,
        nightPosts,
        assignmentByEmployee: postAssignmentByEmployee,
        roundRobin,
      });
      const { shiftStart, shiftEnd } = getShiftTimes(date, shiftType, timeZone);
      try {
        await validateShiftAssignment({
          companyId,
          employeeId: params.employeeId,
          postId: post.id,
          startTime: shiftStart,
          endTime: shiftEnd,
          allowRosterable: true,
          allowUnassigned: false,
          excludeShiftIds: excludedShiftIds,
        });
      } catch (err) {
        if (err instanceof RosteringValidationError) {
          errors.push(`${date.toISOString().slice(0, 10)}: ${err.message}`);
          continue;
        }
        throw err;
      }
      shiftsToCreate.push({
        companyId,
        employeeId: params.employeeId,
        siteId: post.siteId,
        shiftType,
        legacyPostName: post.name,
        startTime: shiftStart,
        endTime: shiftEnd,
        status: "assigned",
      });
    }
    errors.push(
      ...validateBulkShiftSequence(
        shiftsToCreate.map((shift) => ({
          startTime: shift.startTime,
          endTime: shift.endTime,
          shiftType:
            (shift.shiftType ?? "day").toLowerCase() === "night" ? "night" : "day",
        })),
        timeZone
      )
    );
    if (errors.length > 0) {
      return {
        status: 409,
        body: {
          error: "Roster plan is not valid",
          message: "No existing shifts were replaced.",
          conflicts: errors,
        },
      };
    }
    const replacement = await replaceBulkShiftsAtomically({
      companyId,
      deleteWhere,
      shifts: shiftsToCreate,
      timeZone,
    });
    if (isRosteringServiceError(replacement)) return replacement;
    if (replacement.created > 0) {
      await createAuditLog({
        userId,
        companyId,
        action: "shift.bulk_create",
        entityType: "shift",
        entityId: undefined,
        metadata: {
          employeeId: params.employeeId,
          siteId: params.siteId,
          created: replacement.created,
          pattern: params.pattern,
        },
      });
    }
    return replacement;
  },

  async bulkCreateForPost(
    companyId: string,
    userId: string,
    params: {
      employeeId: string;
      postId: string;
      start: Date;
      end: Date;
      pattern: BulkPattern;
      customDays?: number[];
      startDate: string;
      endDate: string;
    }
  ): Promise<BulkCreateResult | RosteringServiceError> {
    const post = await rosteringRepository.findPostWithSite(params.postId);
    if (!post || post.site.companyId !== companyId) {
      return { status: 404, body: { error: "Post not found" } };
    }
    const shiftType = (inferPostShiftType(post.coverageRequirements) ?? "day") as "day" | "night";
    const dates = computeDatesFromPattern(params.start, params.end, params.pattern, params.customDays);
    const timeZone = await getCompanyTimezone(companyId);
    const deleteWhere: Prisma.ShiftWhereInput = {
      companyId,
      employeeId: params.employeeId,
      siteId: post.siteId,
      shiftType,
      status: { in: ["created", "assigned"] },
      startTime: { lt: params.end },
      endTime: { gt: params.start },
    };
    const replaceableShiftIds = await prisma.shift.findMany({
      where: deleteWhere,
      select: { id: true },
    });
    const excludedShiftIds = replaceableShiftIds.map((shift) => shift.id);
    const shiftsToCreate: BulkShiftCreateInput[] = [];
    const errors: string[] = [];
    for (const date of dates) {
      const { shiftStart, shiftEnd } = getShiftTimes(date, shiftType, timeZone);
      try {
        await validateShiftAssignment({
          companyId,
          employeeId: params.employeeId,
          postId: params.postId,
          startTime: shiftStart,
          endTime: shiftEnd,
          allowRosterable: true,
          allowUnassigned: false,
          excludeShiftIds: excludedShiftIds,
        });
      } catch (err) {
        if (err instanceof RosteringValidationError) {
          errors.push(`${date.toISOString().slice(0, 10)}: ${err.message}`);
          continue;
        }
        throw err;
      }
      shiftsToCreate.push({
        companyId,
        employeeId: params.employeeId,
        siteId: post.siteId,
        shiftType,
        legacyPostName: post.name,
        startTime: shiftStart,
        endTime: shiftEnd,
        status: "assigned",
      });
    }
    errors.push(
      ...validateBulkShiftSequence(
        shiftsToCreate.map((shift) => ({
          startTime: shift.startTime,
          endTime: shift.endTime,
          shiftType:
            (shift.shiftType ?? "day").toLowerCase() === "night" ? "night" : "day",
        })),
        timeZone
      )
    );
    if (errors.length > 0) {
      return {
        status: 409,
        body: {
          error: "Roster plan is not valid",
          message: "No existing shifts were replaced.",
          conflicts: errors,
        },
      };
    }
    const replacement = await replaceBulkShiftsAtomically({
      companyId,
      deleteWhere,
      shifts: shiftsToCreate,
      timeZone,
    });
    if (isRosteringServiceError(replacement)) return replacement;
    if (replacement.created > 0) {
      await createAuditLog({
        userId,
        companyId,
        action: "shift.bulk_create",
        entityType: "shift",
        entityId: undefined,
        metadata: {
          employeeId: params.employeeId,
          postId: params.postId,
          created: replacement.created,
          pattern: params.pattern,
          startDate: params.startDate,
          endDate: params.endDate,
        },
      });
    }
    return replacement;
  },

  async previewRoster(
    companyId: string,
    input: RosterPreviewInput
  ): Promise<{ plan: RosterPlan } | RosteringServiceError> {
    const start = parseDateOnly(input.startDate.slice(0, 10));
    const end = parseDateOnlyEnd(input.endDate.slice(0, 10));
    if (start > end) {
      return {
        status: 400,
        body: { error: "Validation error", message: "endDate must be on or after startDate" },
      };
    }
    const site = await rosteringRepository.findSiteWithAssignedGuards(input.siteId, companyId);
    if (!site) {
      return { status: 404, body: { error: "Site not found" } };
    }
    const rosterableCount = site.assignedGuards.filter((a) => {
      const e = a.employee;
      return (
        (e.employeeType ?? "security") === "security" &&
        ["active", "training", "hired", "reliever"].includes(e.status)
      );
    }).length;
    if (rosterableCount === 0) {
      return {
        status: 400,
        body: { error: "No site guards", message: "Assign guards to this site in Sites first." },
      };
    }
    try {
      const plan = await generateRosterPlan({
        companyId,
        siteId: input.siteId,
        startDate: start,
        endDate: end,
      });
      return { plan };
    } catch (err) {
      if (err instanceof Error && err.message === "SITE_NOT_FOUND") {
        return { status: 404, body: { error: "Site not found" } };
      }
      throw err;
    }
  },

  async applyRoster(
    companyId: string,
    userId: string,
    input: RosterApplyInput
  ): Promise<{ result: Awaited<ReturnType<typeof applyRosterPlan>> } | RosteringServiceError> {
    const { plan, options } = input;
    try {
      const result = await applyRosterPlan({
        companyId,
        userId,
        plan: {
          ...plan,
          summary: normalizeRosterPlanSummary(plan.summary, plan.entries.length),
          warnings: plan.warnings ?? [],
        },
        options,
      });
      return { result };
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "SITE_NOT_FOUND") {
          return { status: 404, body: { error: "Site not found" } };
        }
        if (err.message === "PLAN_EMPTY") {
          return {
            status: 400,
            body: {
              error: "Empty plan",
              message: "No shifts to apply. Adjust the pattern or assign more guards to the site.",
            },
          };
        }
        if (err.message === "PLAN_TOO_LARGE") {
          return {
            status: 400,
            body: {
              error: "Plan too large",
              message: "Roster plan exceeds the maximum of 1000 shifts. Shorten the period or reduce guards.",
            },
          };
        }
        if (err.message === "INVALID_POST") {
          return {
            status: 400,
            body: {
              error: "Invalid plan",
              message: "Plan references a post that does not belong to this site.",
            },
          };
        }
        if (err instanceof RosterPlanValidationError) {
          return {
            status: 409,
            body: {
              error: "Roster plan is no longer valid",
              message:
                "The complete plan was rejected without changing the current roster. Review the conflicts and generate a fresh preview.",
              conflicts: err.errors,
            },
          };
        }
      }
      throw err;
    }
  },

  async listAvailableRelievers(companyId: string, shiftId: string) {
    const shift = await rosteringRepository.findShiftWithSite(companyId, shiftId);
    if (!shift) {
      return { status: 404 as const, body: { error: "Shift not found" } };
    }
    const overlapping = await rosteringRepository.findOverlappingShiftEmployeeIds(
      companyId,
      shiftId,
      shift.startTime,
      shift.endTime
    );
    const busyEmployeeIds = new Set(overlapping.map((s) => s.employeeId));
    busyEmployeeIds.add(shift.employeeId);
    const candidates = await rosteringRepository.findRelieverCandidates(
      companyId,
      Array.from(busyEmployeeIds)
    );
    const timeZone = await getCompanyTimezone(companyId);
    const shiftDateKey = dateKeyInTimeZone(shift.startTime, timeZone);
    const leaveByEmployee = await getLeaveDateKeysByEmployee(
      candidates.map((e) => e.id),
      shift.startTime,
      shift.startTime
    );
    const site = shift.site;
    const postShiftType = shift.shiftType;
    const data = candidates
      .filter((e) => meetsSiteShiftGenderRule(e.gender, site, postShiftType))
      .filter((e) => !leaveByEmployee.get(e.id)?.has(shiftDateKey))
      .map(({ id, firstName, lastName }) => ({ id, firstName, lastName }));
    return { data };
  },

  async getShift(companyId: string, id: string) {
    const shift = await rosteringRepository.findShiftById(companyId, id);
    if (!shift) {
      return { status: 404 as const, body: { error: "Shift not found" } };
    }
    return { shift };
  },

  async updateShift(
    companyId: string,
    userId: string,
    id: string,
    input: UpdateShiftInput
  ): Promise<{ shift: Awaited<ReturnType<typeof rosteringRepository.updateShift>> } | RosteringServiceError> {
    const existing = await rosteringRepository.findShiftScalars(companyId, id);
    if (!existing) {
      return { status: 404, body: { error: "Shift not found" } };
    }
    if (existing.status !== "created" && existing.status !== "assigned") {
      return {
        status: 400,
        body: { error: "Cannot edit", message: "Only created or assigned shifts can be edited" },
      };
    }
    const employeeId = input.employeeId ?? existing.employeeId;
    const startTime = input.startTime ? new Date(input.startTime) : existing.startTime;
    const endTime = input.endTime ? new Date(input.endTime) : existing.endTime;
    let siteId = existing.siteId;
    let shiftType = existing.shiftType;
    let legacyPostName = existing.legacyPostName;
    if (input.postId) {
      const resolved = await resolveShiftSiteFieldsFromPost(input.postId, companyId);
      if (!resolved) {
        return { status: 404, body: { error: "Post not found" } };
      }
      siteId = resolved.siteId;
      shiftType = resolved.shiftType;
      legacyPostName = resolved.legacyPostName;
    }
    if (startTime >= endTime) {
      return {
        status: 400,
        body: { error: "Validation error", message: "endTime must be after startTime" },
      };
    }
    const isGuardReplacementOnly = !!input.employeeId && !input.postId && !input.startTime && !input.endTime;
    try {
      await validateShiftAssignment({
        companyId,
        employeeId,
        siteId,
        shiftType,
        startTime,
        endTime,
        excludeShiftId: id,
        allowRosterable: isGuardReplacementOnly,
        allowUnassigned: isGuardReplacementOnly,
      });
    } catch (err) {
      if (err instanceof RosteringValidationError) {
        return {
          status: 400,
          body: { error: "Rostering validation failed", message: err.message },
        };
      }
      throw err;
    }
    const shift = await rosteringRepository.updateShift(companyId, id, {
      employeeId,
      siteId,
      shiftType,
      legacyPostName,
      startTime,
      endTime,
    });
    if (!shift) {
      return { status: 404, body: { error: "Shift not found" } };
    }
    await auditManualShiftEdit({
      userId,
      companyId,
      shiftId: id,
      before: {
        employeeId: existing.employeeId,
        siteId: existing.siteId,
        shiftType: existing.shiftType,
        startTime: existing.startTime.toISOString(),
        endTime: existing.endTime.toISOString(),
        status: existing.status,
      },
      after: {
        employeeId,
        siteId,
        shiftType,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      },
    });
    await createAuditLog({
      userId,
      companyId,
      action: "shift.update",
      entityType: "shift",
      entityId: id,
      metadata: { manualEdit: true },
    });
    return { shift };
  },

  async transitionShift(
    companyId: string,
    userId: string,
    id: string,
    status: ShiftStatus
  ): Promise<{ shift: Awaited<ReturnType<typeof rosteringRepository.updateShiftStatus>> } | RosteringServiceError> {
    const existing = await rosteringRepository.findShiftScalars(companyId, id);
    if (!existing) {
      return { status: 404, body: { error: "Shift not found" } };
    }
    if (!canTransitionShift(existing.status, status)) {
      return {
        status: 400,
        body: {
          error: "Invalid transition",
          message: `Cannot transition from ${existing.status} to ${status}`,
        },
      };
    }
    const shift = await rosteringRepository.updateShiftStatus(companyId, id, status);
    if (!shift) {
      return { status: 404, body: { error: "Shift not found" } };
    }
    await createAuditLog({
      userId,
      companyId,
      action: "shift.transition",
      entityType: "shift",
      entityId: id,
      metadata: { newStatus: status },
    });
    return { shift };
  },

  async bulkVerify(companyId: string, userId: string, shiftIds: string[]) {
    let verified = 0;
    const errors: string[] = [];
    for (const id of shiftIds) {
      const existing = await rosteringRepository.findShiftScalars(companyId, id);
      if (!existing) {
        errors.push(`${id}: Shift not found`);
        continue;
      }
      if (!canTransitionShift(existing.status, "verified")) {
        errors.push(`${id}: Cannot verify (status: ${existing.status})`);
        continue;
      }
      const verifiedShift = await rosteringRepository.updateShiftStatus(companyId, id, "verified");
      if (verifiedShift) verified++;
    }
    if (verified > 0) {
      await createAuditLog({
        userId,
        companyId,
        action: "shift.bulk_verify",
        entityType: "shift",
        entityId: undefined,
        metadata: { shiftIds, verified },
      });
    }
    return { verified, errors: errors.length > 0 ? errors : undefined };
  },

  async verifyShift(
    companyId: string,
    userId: string,
    id: string
  ): Promise<{ shift: Awaited<ReturnType<typeof rosteringRepository.updateShiftStatus>> } | RosteringServiceError> {
    const existing = await rosteringRepository.findShiftScalars(companyId, id);
    if (!existing) {
      return { status: 404, body: { error: "Shift not found" } };
    }
    if (!canTransitionShift(existing.status, "verified")) {
      return {
        status: 400,
        body: {
          error: "Cannot verify",
          message: `Shift must be completed to verify. Current status: ${existing.status}`,
        },
      };
    }
    const shift = await rosteringRepository.updateShiftStatus(companyId, id, "verified");
    if (!shift) {
      return { status: 404, body: { error: "Shift not found" } };
    }
    await createAuditLog({
      userId,
      companyId,
      action: "shift.verify",
      entityType: "shift",
      entityId: id,
    });
    return { shift };
  },

  async deleteShift(
    companyId: string,
    userId: string,
    id: string
  ): Promise<{ ok: true } | RosteringServiceError> {
    const existing = await rosteringRepository.findShiftScalars(companyId, id);
    if (!existing) {
      return { status: 404, body: { error: "Shift not found" } };
    }
    if (existing.status !== "created" && existing.status !== "assigned") {
      return {
        status: 400,
        body: { error: "Cannot delete", message: "Only created or assigned shifts can be deleted" },
      };
    }
    const deleted = await rosteringRepository.deleteShift(companyId, id);
    if (!deleted) {
      return { status: 404, body: { error: "Shift not found" } };
    }
    await createAuditLog({
      userId,
      companyId,
      action: "shift.delete",
      entityType: "shift",
      entityId: id,
    });
    return { ok: true };
  },
};

export function isRosteringServiceError(
  value: unknown
): value is RosteringServiceError {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "body" in value &&
    typeof (value as RosteringServiceError).status === "number"
  );
}
