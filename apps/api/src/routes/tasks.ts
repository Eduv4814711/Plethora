import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const TASK_ROLES = ["admin", "operations_manager", "hr_payroll", "supervisor"] as const;

function sanitizeDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getFullYear();
  if (y < 1900 || y > 2100) return undefined;
  return d;
}

const recurrenceRuleSchema = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().positive().optional().default(1),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    endDate: z.string().optional().transform(sanitizeDate),
  })
  .optional()
  .nullable();

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string().optional().nullable(),
  status: z.enum(["todo", "in_progress", "done"]).optional().default("todo"),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional().default("medium"),
  dueDate: z.string().optional().transform(sanitizeDate),
  assigneeType: z.enum(["employee", "user"]).optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  recurrenceRule: recurrenceRuleSchema,
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueDate: z.string().optional().nullable().transform((v) => (v === null ? null : sanitizeDate(v ?? undefined))),
  assigneeType: z.enum(["employee", "user"]).optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  recurrenceRule: recurrenceRuleSchema,
});

async function resolveAssigneeDisplayName(
  assigneeType: string | null,
  assigneeId: string | null,
  companyId: string
): Promise<string | null> {
  if (!assigneeType || !assigneeId) return null;
  if (assigneeType === "user") {
    const user = await prisma.user.findFirst({
      where: { id: assigneeId, companyId },
      select: { name: true },
    });
    return user?.name ?? null;
  }
  if (assigneeType === "employee") {
    const emp = await prisma.employee.findFirst({
      where: { id: assigneeId, companyId },
      select: { firstName: true, lastName: true },
    });
    return emp ? `${emp.firstName} ${emp.lastName}` : null;
  }
  return null;
}

const taskInclude = {
  project: { select: { id: true, name: true, color: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  comments: {
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  },
  attachments: true,
  reminders: { orderBy: { remindAt: "asc" } },
} as const;

export async function tasksRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole([...TASK_ROLES], { module: "/tasks" })];

  app.get("/assignees", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const [users, employees] = await Promise.all([
      prisma.user.findMany({
        where: { companyId: user.companyId },
        select: { id: true, name: true, email: true, role: true },
      }),
      prisma.employee.findMany({
        where: { companyId: user.companyId, status: { in: ["active", "training", "hired", "reliever"] } },
        select: { id: true, firstName: true, lastName: true, employeeType: true },
      }),
    ]);
    return reply.send({
      users: users.map((u) => ({
        id: u.id,
        type: "user" as const,
        displayName: u.name,
        subtitle: u.role.replace(/_/g, " "),
      })),
      employees: employees.map((e) => ({
        id: e.id,
        type: "employee" as const,
        displayName: `${e.firstName} ${e.lastName}`,
        subtitle: e.employeeType === "office" ? "Office" : "Security",
      })),
    });
  });

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 100);
    const offset = Number(q.offset) || 0;
    const projectId = q.projectId;
    const status = q.status;
    const assigneeId = q.assigneeId;
    const dueBefore = q.dueBefore ? sanitizeDate(q.dueBefore) : undefined;
    const dueAfter = q.dueAfter ? sanitizeDate(q.dueAfter) : undefined;

    const where: Record<string, unknown> = { companyId: user.companyId };
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    if (assigneeId) where.assigneeId = assigneeId;
    if (dueBefore || dueAfter) {
      where.dueDate = {};
      if (dueBefore) (where.dueDate as Record<string, Date>).lte = dueBefore;
      if (dueAfter) (where.dueDate as Record<string, Date>).gte = dueAfter;
    }

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: taskInclude,
        take: limit,
        skip: offset,
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      }),
      prisma.task.count({ where }),
    ]);

    const tasksWithAssignee = await Promise.all(
      tasks.map(async (t) => ({
        ...t,
        assigneeDisplayName: await resolveAssigneeDisplayName(t.assigneeType, t.assigneeId, user.companyId),
      }))
    );

    return reply.send({ data: tasksWithAssignee, total, limit, offset });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const userId = request.user!.sub!;
    const d = parsed.data;

    if (d.projectId) {
      const project = await prisma.taskProject.findFirst({
        where: { id: d.projectId, companyId },
      });
      if (!project) {
        return reply.code(400).send({
          error: "Validation error",
          message: { projectId: ["Project not found"] },
        });
      }
    }

    if (d.assigneeType && d.assigneeId) {
      if (d.assigneeType === "user") {
        const u = await prisma.user.findFirst({
          where: { id: d.assigneeId, companyId },
        });
        if (!u) {
          return reply.code(400).send({
            error: "Validation error",
            message: { assigneeId: ["User not found"] },
          });
        }
      } else {
        const e = await prisma.employee.findFirst({
          where: { id: d.assigneeId, companyId },
        });
        if (!e) {
          return reply.code(400).send({
            error: "Validation error",
            message: { assigneeId: ["Employee not found"] },
          });
        }
      }
    }

    const task = await prisma.task.create({
      data: {
        companyId,
        createdById: userId,
        title: d.title,
        description: d.description,
        projectId: d.projectId ?? undefined,
        status: d.status as "todo" | "in_progress" | "done",
        priority: d.priority as "low" | "medium" | "high" | "urgent",
        dueDate: d.dueDate,
        assigneeType: d.assigneeType ?? undefined,
        assigneeId: d.assigneeId ?? undefined,
        recurrenceRule: d.recurrenceRule as object | undefined,
      },
      include: taskInclude,
    });

    const assigneeDisplayName = await resolveAssigneeDisplayName(
      task.assigneeType,
      task.assigneeId,
      companyId
    );

    await createAuditLog({
      userId,
      companyId,
      action: "create",
      entityType: "Task",
      entityId: task.id,
      metadata: { title: task.title },
    });

    return reply.code(201).send({ ...task, assigneeDisplayName });
  });

  app.get("/:id", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const task = await prisma.task.findFirst({
      where: { id, companyId: user.companyId },
      include: taskInclude,
    });

    if (!task) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const assigneeDisplayName = await resolveAssigneeDisplayName(
      task.assigneeType,
      task.assigneeId,
      user.companyId
    );

    return reply.send({ ...task, assigneeDisplayName });
  });

  app.patch("/:id", { preHandler: protect }, async (request, reply) => {
    const parsed = updateTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const userId = request.user!.sub!;
    const { id } = request.params as { id: string };
    const d = parsed.data;

    const existing = await prisma.task.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    if (d.projectId !== undefined && d.projectId) {
      const project = await prisma.taskProject.findFirst({
        where: { id: d.projectId, companyId: user.companyId },
      });
      if (!project) {
        return reply.code(400).send({
          error: "Validation error",
          message: { projectId: ["Project not found"] },
        });
      }
    }

    if (d.assigneeType && d.assigneeId) {
      if (d.assigneeType === "user") {
        const u = await prisma.user.findFirst({
          where: { id: d.assigneeId, companyId: user.companyId },
        });
        if (!u) {
          return reply.code(400).send({
            error: "Validation error",
            message: { assigneeId: ["User not found"] },
          });
        }
      } else {
        const e = await prisma.employee.findFirst({
          where: { id: d.assigneeId, companyId: user.companyId },
        });
        if (!e) {
          return reply.code(400).send({
            error: "Validation error",
            message: { assigneeId: ["Employee not found"] },
          });
        }
      }
    }

    const updateData: Record<string, unknown> = {};
    if (d.title !== undefined) updateData.title = d.title;
    if (d.description !== undefined) updateData.description = d.description;
    if (d.projectId !== undefined) updateData.projectId = d.projectId;
    if (d.status !== undefined) updateData.status = d.status;
    if (d.priority !== undefined) updateData.priority = d.priority;
    if (d.dueDate !== undefined) updateData.dueDate = d.dueDate;
    if (d.assigneeType !== undefined) updateData.assigneeType = d.assigneeType;
    if (d.assigneeId !== undefined) updateData.assigneeId = d.assigneeId;
    if (d.recurrenceRule !== undefined) updateData.recurrenceRule = d.recurrenceRule;

    const updatedCount = await prisma.task.updateMany({
      where: { id, companyId: user.companyId },
      data: updateData,
    });
    if (updatedCount.count === 0) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const task = await prisma.task.findFirst({
      where: { id, companyId: user.companyId },
      include: taskInclude,
    });
    if (!task) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const assigneeDisplayName = await resolveAssigneeDisplayName(
      task.assigneeType,
      task.assigneeId,
      user.companyId
    );

    await createAuditLog({
      userId,
      companyId: user.companyId,
      action: "update",
      entityType: "Task",
      entityId: task.id,
      metadata: { title: task.title },
    });

    return reply.send({ ...task, assigneeDisplayName });
  });

  app.delete("/:id", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const userId = request.user!.sub!;
    const { id } = request.params as { id: string };

    const existing = await prisma.task.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const deleted = await prisma.task.deleteMany({
      where: { id, companyId: user.companyId },
    });
    if (deleted.count === 0) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    await createAuditLog({
      userId,
      companyId: user.companyId,
      action: "delete",
      entityType: "Task",
      entityId: id,
      metadata: { title: existing.title },
    });

    return reply.code(204).send();
  });

  app.post("/:id/complete", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const userId = request.user!.sub!;
    const { id } = request.params as { id: string };

    const existing = await prisma.task.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const now = new Date();
    const doneUpdate = await prisma.task.updateMany({
      where: { id, companyId: user.companyId },
      data: { status: "done", completedAt: now },
    });
    if (doneUpdate.count === 0) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const task = await prisma.task.findFirst({
      where: { id, companyId: user.companyId },
      include: taskInclude,
    });
    if (!task) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const recurrenceRule = existing.recurrenceRule as
      | { frequency: string; interval?: number; daysOfWeek?: number[]; endDate?: string }
      | null
      | undefined;

    if (recurrenceRule && recurrenceRule.frequency) {
      let nextDue = new Date(existing.dueDate ?? now);
      const interval = recurrenceRule.interval ?? 1;
      if (recurrenceRule.frequency === "daily") {
        nextDue.setDate(nextDue.getDate() + interval);
      } else if (recurrenceRule.frequency === "weekly") {
        nextDue.setDate(nextDue.getDate() + 7 * interval);
      } else if (recurrenceRule.frequency === "monthly") {
        nextDue.setMonth(nextDue.getMonth() + interval);
      }

      const endDate = recurrenceRule.endDate ? new Date(recurrenceRule.endDate) : null;
      if (!endDate || nextDue <= endDate) {
        await prisma.task.create({
          data: {
            companyId: existing.companyId,
            createdById: existing.createdById,
            title: existing.title,
            description: existing.description,
            projectId: existing.projectId,
            status: "todo",
            priority: existing.priority,
            dueDate: nextDue,
            assigneeType: existing.assigneeType,
            assigneeId: existing.assigneeId,
            recurrenceRule: recurrenceRule as object,
          },
        });
      }
    }

    const assigneeDisplayName = await resolveAssigneeDisplayName(
      task.assigneeType,
      task.assigneeId,
      user.companyId
    );

    await createAuditLog({
      userId,
      companyId: user.companyId,
      action: "complete",
      entityType: "Task",
      entityId: task.id,
      metadata: { title: task.title },
    });

    return reply.send({ ...task, assigneeDisplayName });
  });

  app.post("/:id/reopen", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const userId = request.user!.sub!;
    const { id } = request.params as { id: string };

    const existing = await prisma.task.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const reopenUpdate = await prisma.task.updateMany({
      where: { id, companyId: user.companyId },
      data: { status: "todo", completedAt: null },
    });
    if (reopenUpdate.count === 0) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const task = await prisma.task.findFirst({
      where: { id, companyId: user.companyId },
      include: taskInclude,
    });
    if (!task) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const assigneeDisplayName = await resolveAssigneeDisplayName(
      task.assigneeType,
      task.assigneeId,
      user.companyId
    );

    await createAuditLog({
      userId,
      companyId: user.companyId,
      action: "reopen",
      entityType: "Task",
      entityId: task.id,
      metadata: { title: task.title },
    });

    return reply.send({ ...task, assigneeDisplayName });
  });
}
