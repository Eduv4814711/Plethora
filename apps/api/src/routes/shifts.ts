import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { canTransitionShift } from "../lib/state-machines.js";
import { prisma } from "../lib/prisma.js";
import { validateShiftAssignment } from "../services/rostering.service.js";
import { RosteringValidationError } from "../services/rostering.service.js";
import { createAuditLog } from "../lib/audit.js";

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

export async function shiftsRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "operations_manager", "hr_payroll", "supervisor"])];

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
    if (startDate) {
      where.startTime = { gte: new Date(startDate) };
    }
    if (endDate) {
      where.endTime = { lte: new Date(endDate) };
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
}
