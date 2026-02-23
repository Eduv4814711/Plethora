import type { FastifyInstance } from "fastify";
import type { Post } from "@prisma/client";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { canTransitionShift } from "../lib/state-machines.js";
import { prisma } from "../lib/prisma.js";
import {
  validateShiftAssignment,
  RosteringValidationError,
  computeDatesFromPattern,
  computeDatesFromPatternDual,
  type BulkPattern,
} from "../services/rostering.service.js";
import { createAuditLog } from "../lib/audit.js";
import { getCompanyTimezone, getShiftTimes } from "../lib/timezone.js";

const createShiftSchema = z.object({
  employeeId: z.string().min(1),
  postId: z.string().min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  status: z.enum(["created", "assigned"]).default("assigned"),
});

const updateShiftSchema = z.object({
  employeeId: z.string().min(1).optional(),
  postId: z.string().min(1).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
});

const transitionSchema = z.object({
  status: z.enum(["created", "assigned", "active", "completed", "verified"]),
});

const customBlockSchema = z.object({
  type: z.enum(["day", "night", "off"]),
  count: z.number().min(1).max(14),
});

const bulkCreateSchema = z
  .object({
    employeeId: z.string().min(1),
    postId: z.string().min(1).optional(),
    siteId: z.string().min(1).optional(),
    startDate: z.string(),
    endDate: z.string(),
    pattern: z.enum([
      "all_days",
      "weekdays",
      "2_on_2_off",
      "4_on_4_off",
      "5_on_2_off",
      "6_on_3_off",
      "3_on_3_off",
      "custom",
      "custom_builder",
    ]),
    customDays: z.array(z.number().min(0).max(6)).optional(),
    customBlocks: z.array(customBlockSchema).optional(),
  })
  .superRefine((data, ctx) => {
    const hasPost = !!data.postId;
    const hasSite = !!data.siteId;
    if (hasPost === hasSite) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactly one of postId or siteId is required",
        path: ["postId"],
      });
      return;
    }
    if (hasSite && data.pattern !== "3_on_3_off" && data.pattern !== "custom_builder") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "siteId requires pattern 3_on_3_off or custom_builder",
        path: ["siteId"],
      });
    }
    if (data.pattern === "custom_builder" && hasSite && (!data.customBlocks || data.customBlocks.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "customBlocks required when pattern is custom_builder",
        path: ["customBlocks"],
      });
    }
  });

async function handleBulkCreateSite(
  request: { user?: { sub: string } },
  reply: { code: (n: number) => { send: (o: object) => unknown } },
  companyId: string,
  employeeId: string,
  siteId: string,
  start: Date,
  end: Date,
  pattern: "3_on_3_off" | "custom_builder",
  customBlocks?: { type: "day" | "night" | "off"; count: number }[]
) {
  const site = await prisma.site.findFirst({
    where: { id: siteId, companyId },
    include: { posts: true },
  });

  if (!site) {
    return reply.code(404).send({ error: "Site not found" });
  }

  const dayPost = site.posts.find((p: Post) => (p.shiftType ?? "day") === "day");
  const nightPost = site.posts.find((p: Post) => p.shiftType === "night");

  if (!dayPost) {
    return reply.code(400).send({
      error: "Site has no day post",
      message: "Add a day post to use this pattern.",
    });
  }
  if (!nightPost) {
    return reply.code(400).send({
      error: "Site has no night post",
      message: "Add a night post to use this pattern.",
    });
  }

  const dualDates = computeDatesFromPatternDual(start, end, pattern, customBlocks);

  if (pattern === "custom_builder" && dualDates.length === 0) {
    return reply.code(400).send({
      error: "Pattern must include at least one day or night block",
      message: "Pattern must include at least one day or night block.",
    });
  }

  const timeZone = await getCompanyTimezone(companyId);

  const deleted = await prisma.shift.deleteMany({
    where: {
      companyId,
      employeeId,
      postId: { in: [dayPost.id, nightPost.id] },
      status: { in: ["created", "assigned"] },
      startTime: { lt: end },
      endTime: { gt: start },
    },
  });

  let created = 0;
  const errors: string[] = [];

  for (const { date, shiftType } of dualDates) {
    const post = shiftType === "day" ? dayPost : nightPost;
    const { shiftStart, shiftEnd } = getShiftTimes(date, shiftType, timeZone);

    try {
      await validateShiftAssignment({
        companyId,
        employeeId,
        postId: post.id,
        startTime: shiftStart,
        endTime: shiftEnd,
        allowRosterable: true,
      });
    } catch (err) {
      if (err instanceof RosteringValidationError) {
        errors.push(`${date.toISOString().slice(0, 10)}: ${err.message}`);
        continue;
      }
      throw err;
    }

    await prisma.shift.create({
      data: {
        companyId,
        employeeId,
        postId: post.id,
        startTime: shiftStart,
        endTime: shiftEnd,
        status: "assigned",
      },
    });

    created++;
  }

  if (created > 0) {
    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "shift.bulk_create",
      entityType: "shift",
      entityId: undefined,
      metadata: { employeeId, siteId, created, pattern },
    });
  }

  return reply.code(201).send({
    deleted: deleted.count,
    created,
    skipped: dualDates.length - created,
    errors: errors.length > 0 ? errors : undefined,
  });
}

export async function shiftsRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "operations_manager", "hr_payroll", "supervisor"])];
  const verifyProtect = [authMiddleware, requireRole(["admin", "hr_payroll"])];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const employeeId = q.employeeId;
    const siteId = q.siteId;
    const startDate = q.startDate;
    const endDate = q.endDate;
    const limit = Math.min(Number(q.limit) || 50, 100);
    const offset = Number(q.offset) || 0;

    const where: Record<string, unknown> = {
      companyId: user.companyId,
    };

    if (employeeId) where.employeeId = employeeId;
    if (siteId) {
      where.post = { siteId };
    }
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      where.startTime = { lt: end };
      where.endTime = { gt: start };
    } else if (startDate) {
      where.endTime = { gt: new Date(startDate) };
    } else if (endDate) {
      where.startTime = { lt: new Date(endDate) };
    }

    const [shifts, total] = await Promise.all([
      prisma.shift.findMany({
        where,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          post: { include: { site: true } },
        },
        take: limit,
        skip: offset,
        orderBy: { startTime: "asc" },
      }),
      prisma.shift.count({ where }),
    ]);

    return reply.send({ data: shifts, total, limit, offset });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createShiftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const startTime = new Date(parsed.data.startTime);
    const endTime = new Date(parsed.data.endTime);

    if (startTime >= endTime) {
      return reply.code(400).send({
        error: "Validation error",
        message: "endTime must be after startTime",
      });
    }

    try {
      await validateShiftAssignment({
        companyId,
        employeeId: parsed.data.employeeId,
        postId: parsed.data.postId,
        startTime,
        endTime,
      });
    } catch (err) {
      if (err instanceof RosteringValidationError) {
        return reply.code(400).send({
          error: "Rostering validation failed",
          message: err.message,
        });
      }
      throw err;
    }

    const shift = await prisma.shift.create({
      data: {
        companyId,
        employeeId: parsed.data.employeeId,
        postId: parsed.data.postId,
        startTime,
        endTime,
        status: parsed.data.status,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        post: { include: { site: true } },
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "shift.create",
      entityType: "shift",
      entityId: shift.id,
    });

    return reply.code(201).send(shift);
  });

  const resetSchema = z.object({
    startDate: z.string(),
    endDate: z.string(),
    employeeId: z.string().optional(),
    siteId: z.string().optional(),
  });

  app.post("/reset", { preHandler: protect }, async (request, reply) => {
    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const { startDate, endDate, employeeId, siteId } = parsed.data;

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    if (start > end) {
      return reply.code(400).send({
        error: "Validation error",
        message: "endDate must be on or after startDate",
      });
    }

    const where = {
      companyId,
      status: { in: ["created", "assigned"] as ("created" | "assigned")[] },
      startTime: { lt: end },
      endTime: { gt: start },
      ...(employeeId && { employeeId }),
      ...(siteId && { post: { siteId } }),
    };

    // #region agent log
    const countBefore = await prisma.shift.count({ where });
    const allInRange = await prisma.shift.count({
      where: {
        companyId,
        startTime: { lt: end },
        endTime: { gt: start },
        ...(siteId && { post: { siteId } }),
      },
    });
    fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6f3bcb'},body:JSON.stringify({sessionId:'6f3bcb',location:'shifts.ts:reset',message:'Reset pre-delete',data:{startDate,endDate,employeeId,siteId,countMatchingWhere:countBefore,countAllInRangeNoStatus:allInRange,startISO:start.toISOString(),endISO:end.toISOString()},hypothesisId:'H3,H4,H5',timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const deleted = await prisma.shift.deleteMany({ where });

    if (deleted.count > 0) {
      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "shift.reset",
        entityType: "shift",
        entityId: undefined,
        metadata: { startDate, endDate, employeeId, siteId, deleted: deleted.count },
      });
    }

    return reply.send({ deleted: deleted.count });
  });

  app.post("/bulk", { preHandler: protect }, async (request, reply) => {
    const parsed = bulkCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const { employeeId, postId, siteId, startDate, endDate, pattern, customDays, customBlocks } = parsed.data;

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    if (start > end) {
      return reply.code(400).send({
        error: "Validation error",
        message: "endDate must be on or after startDate",
      });
    }

    if (pattern === "custom" && (!customDays || customDays.length === 0)) {
      return reply.code(400).send({
        error: "Validation error",
        message: "customDays required when pattern is custom",
      });
    }

    if (siteId) {
      return await handleBulkCreateSite(
        request,
        reply,
        companyId,
        employeeId,
        siteId,
        start,
        end,
        pattern as "3_on_3_off" | "custom_builder",
        customBlocks
      );
    }

    if (!postId) {
      return reply.code(400).send({
        error: "Validation error",
        message: "postId or siteId is required",
      });
    }

    const post = await prisma.post.findFirst({
      where: { id: postId },
      include: { site: true },
    });

    if (!post) {
      return reply.code(404).send({ error: "Post not found" });
    }

    if (post.site.companyId !== companyId) {
      return reply.code(404).send({ error: "Post not found" });
    }

    const shiftType = (post.shiftType ?? "day") as "day" | "night";
    const dates = computeDatesFromPattern(start, end, pattern as BulkPattern, customDays);
    const timeZone = await getCompanyTimezone(companyId);

    const deleted = await prisma.shift.deleteMany({
      where: {
        companyId,
        employeeId,
        postId,
        status: { in: ["created", "assigned"] },
        startTime: { lt: end },
        endTime: { gt: start },
      },
    });

    let created = 0;
    const errors: string[] = [];

    for (const date of dates) {
      const { shiftStart, shiftEnd } = getShiftTimes(date, shiftType, timeZone);

      try {
        await validateShiftAssignment({
          companyId,
          employeeId,
          postId,
          startTime: shiftStart,
          endTime: shiftEnd,
          allowRosterable: true,
        });
      } catch (err) {
        if (err instanceof RosteringValidationError) {
          errors.push(`${date.toISOString().slice(0, 10)}: ${err.message}`);
          continue;
        }
        throw err;
      }

      await prisma.shift.create({
        data: {
          companyId,
          employeeId,
          postId,
          startTime: shiftStart,
          endTime: shiftEnd,
          status: "assigned",
        },
      });

      created++;
    }

    if (created > 0) {
      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "shift.bulk_create",
        entityType: "shift",
        entityId: undefined,
        metadata: { employeeId, postId, created, pattern, startDate, endDate },
      });
    }

    return reply.code(201).send({
      deleted: deleted.count,
      created,
      skipped: dates.length - created,
      errors: errors.length > 0 ? errors : undefined,
    });
  });

  app.get("/:id/available-relievers", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const shift = await prisma.shift.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!shift) {
      return reply.code(404).send({ error: "Shift not found" });
    }

    const overlappingShifts = await prisma.shift.findMany({
      where: {
        companyId: user.companyId,
        id: { not: id },
        startTime: { lt: shift.endTime },
        endTime: { gt: shift.startTime },
      },
      select: { employeeId: true },
      distinct: ["employeeId"],
    });
    const busyEmployeeIds = new Set(overlappingShifts.map((s) => s.employeeId));
    busyEmployeeIds.add(shift.employeeId);

    const available = await prisma.employee.findMany({
      where: {
        companyId: user.companyId,
        id: { notIn: Array.from(busyEmployeeIds) },
        status: { in: ["active", "training", "hired"] },
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    return reply.send({ data: available });
  });

  app.get("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const shift = await prisma.shift.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        employee: true,
        post: { include: { site: true } },
        attendances: true,
      },
    });

    if (!shift) {
      return reply.code(404).send({ error: "Shift not found" });
    }

    return reply.send(shift);
  });

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateShiftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const existing = await prisma.shift.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Shift not found" });
    }

    if (existing.status !== "created" && existing.status !== "assigned") {
      return reply.code(400).send({
        error: "Cannot edit",
        message: "Only created or assigned shifts can be edited",
      });
    }

    const employeeId = parsed.data.employeeId ?? existing.employeeId;
    const postId = parsed.data.postId ?? existing.postId;
    const startTime = parsed.data.startTime ? new Date(parsed.data.startTime) : existing.startTime;
    const endTime = parsed.data.endTime ? new Date(parsed.data.endTime) : existing.endTime;

    if (startTime >= endTime) {
      return reply.code(400).send({
        error: "Validation error",
        message: "endTime must be after startTime",
      });
    }

    try {
      await validateShiftAssignment({
        companyId,
        employeeId,
        postId,
        startTime,
        endTime,
        excludeShiftId: id,
      });
    } catch (err) {
      if (err instanceof RosteringValidationError) {
        return reply.code(400).send({
          error: "Rostering validation failed",
          message: err.message,
        });
      }
      throw err;
    }

    const shift = await prisma.shift.update({
      where: { id },
      data: {
        employeeId,
        postId,
        startTime,
        endTime,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        post: { include: { site: true } },
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "shift.update",
      entityType: "shift",
      entityId: id,
    });

    return reply.send(shift);
  });

  app.post("/:id/transition", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = transitionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const existing = await prisma.shift.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Shift not found" });
    }

    if (!canTransitionShift(existing.status, parsed.data.status)) {
      return reply.code(400).send({
        error: "Invalid transition",
        message: `Cannot transition from ${existing.status} to ${parsed.data.status}`,
      });
    }

    const shift = await prisma.shift.update({
      where: { id },
      data: { status: parsed.data.status },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        post: { include: { site: true } },
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "shift.transition",
      entityType: "shift",
      entityId: id,
      metadata: { newStatus: parsed.data.status },
    });

    return reply.send(shift);
  });

  app.post("/bulk-verify", { preHandler: verifyProtect }, async (request, reply) => {
    const schema = z.object({ shiftIds: z.array(z.string().min(1)).min(1).max(100) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    let verified = 0;
    const errors: string[] = [];

    for (const id of parsed.data.shiftIds) {
      const existing = await prisma.shift.findFirst({
        where: { id, companyId },
      });
      if (!existing) {
        errors.push(`${id}: Shift not found`);
        continue;
      }
      if (!canTransitionShift(existing.status, "verified")) {
        errors.push(`${id}: Cannot verify (status: ${existing.status})`);
        continue;
      }
      await prisma.shift.update({
        where: { id },
        data: { status: "verified" },
      });
      verified++;
    }

    if (verified > 0) {
      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "shift.bulk_verify",
        entityType: "shift",
        entityId: undefined,
        metadata: { shiftIds: parsed.data.shiftIds, verified },
      });
    }

    return reply.send({ verified, errors: errors.length > 0 ? errors : undefined });
  });

  app.post("/:id/verify", { preHandler: verifyProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.user!.companyId;
    const existing = await prisma.shift.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Shift not found" });
    }

    if (!canTransitionShift(existing.status, "verified")) {
      return reply.code(400).send({
        error: "Cannot verify",
        message: `Shift must be completed to verify. Current status: ${existing.status}`,
      });
    }

    const shift = await prisma.shift.update({
      where: { id },
      data: { status: "verified" },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        post: { include: { site: true } },
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "shift.verify",
      entityType: "shift",
      entityId: id,
    });

    return reply.send(shift);
  });

  app.delete("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.user!.companyId;

    const existing = await prisma.shift.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Shift not found" });
    }

    if (existing.status !== "created" && existing.status !== "assigned") {
      return reply.code(400).send({
        error: "Cannot delete",
        message: "Only created or assigned shifts can be deleted",
      });
    }

    await prisma.shift.delete({ where: { id } });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "shift.delete",
      entityType: "shift",
      entityId: id,
    });

    return reply.code(204).send();
  });
}
