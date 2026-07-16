import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authProtect } from "../middleware/auth-protect.js";
import { requirePermission } from "../middleware/permissions.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";

function sanitizeDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getFullYear();
  if (y < 1900 || y > 2100) return undefined;
  return d;
}

const createReminderSchema = z.object({
  remindAt: z.string().transform(sanitizeDate).refine((d) => d != null && d > new Date(), {
    message: "remindAt must be a future date/time",
  }),
});

export async function taskRemindersRoutes(app: FastifyInstance) {
  const protect = [...authProtect, requirePermission(PERMISSIONS.TASKS_MANAGE)];

  app.post("/tasks/:taskId/reminders", { preHandler: protect }, async (request, reply) => {
    const parsed = createReminderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const { taskId } = request.params as { taskId: string };

    const task = await prisma.task.findFirst({
      where: { id: taskId, companyId: user.companyId },
    });

    if (!task) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const reminder = await prisma.taskReminder.create({
      data: {
        taskId,
        remindAt: parsed.data.remindAt!,
      },
    });

    return reply.code(201).send(reminder);
  });

  app.get("/reminders/upcoming", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 20, 50);

    const now = new Date();
    const reminders = await prisma.taskReminder.findMany({
      where: {
        sentAt: null,
        remindAt: { gte: now },
        task: {
          companyId: user.companyId,
          assigneeId: user.sub,
          assigneeType: "user",
        },
      },
      include: {
        task: {
          select: { id: true, title: true, dueDate: true },
        },
      },
      orderBy: { remindAt: "asc" },
      take: limit,
    });

    return reply.send({ data: reminders });
  });

  app.delete("/reminders/:id", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const reminder = await prisma.taskReminder.findFirst({
      where: { id },
      include: { task: true },
    });

    if (!reminder || reminder.task.companyId !== user.companyId) {
      return reply.code(404).send({ error: "Not found", message: "Reminder not found" });
    }

    await prisma.taskReminder.delete({ where: { id } });

    return reply.code(204).send();
  });
}
