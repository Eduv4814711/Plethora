import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";

const TASK_ROLES = ["admin", "operations_manager", "hr_payroll", "supervisor"] as const;

const createCommentSchema = z.object({
  body: z.string().min(1),
});

export async function taskCommentsRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole([...TASK_ROLES], { module: "/tasks" })];

  app.get("/tasks/:taskId/comments", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { taskId } = request.params as { taskId: string };

    const task = await prisma.task.findFirst({
      where: { id: taskId, companyId: user.companyId },
    });

    if (!task) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const comments = await prisma.taskComment.findMany({
      where: { taskId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return reply.send({ data: comments });
  });

  app.post("/tasks/:taskId/comments", { preHandler: protect }, async (request, reply) => {
    const parsed = createCommentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const userId = request.user!.sub!;
    const { taskId } = request.params as { taskId: string };

    const task = await prisma.task.findFirst({
      where: { id: taskId, companyId: user.companyId },
    });

    if (!task) {
      return reply.code(404).send({ error: "Not found", message: "Task not found" });
    }

    const comment = await prisma.taskComment.create({
      data: {
        taskId,
        userId,
        body: parsed.data.body,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return reply.code(201).send(comment);
  });
}
