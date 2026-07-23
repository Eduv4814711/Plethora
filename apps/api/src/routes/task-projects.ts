import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  sortOrder: z.number().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  sortOrder: z.number().optional(),
});

export async function taskProjectsRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireCrudCapability({ module: "/tasks" })];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;

    const projects = await prisma.taskProject.findMany({
      where: { companyId: user.companyId },
      include: {
        _count: { select: { tasks: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return reply.send({ data: projects });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const userId = request.user!.sub!;
    const d = parsed.data;

    const project = await prisma.taskProject.create({
      data: {
        companyId,
        name: d.name,
        description: d.description,
        color: d.color,
        sortOrder: d.sortOrder ?? 0,
      },
    });

    await createAuditLog({
      userId,
      companyId,
      action: "create",
      entityType: "TaskProject",
      entityId: project.id,
      metadata: { name: project.name },
    });

    return reply.code(201).send(project);
  });

  app.get("/:id", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const project = await prisma.taskProject.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        tasks: {
          orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!project) {
      return reply.code(404).send({ error: "Not found", message: "Project not found" });
    }

    return reply.send(project);
  });

  app.patch("/:id", { preHandler: protect }, async (request, reply) => {
    const parsed = updateProjectSchema.safeParse(request.body);
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

    const existing = await prisma.taskProject.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Project not found" });
    }

    const project = await prisma.taskProject.update({
      where: { id },
      data: {
        ...(d.name !== undefined && { name: d.name }),
        ...(d.description !== undefined && { description: d.description }),
        ...(d.color !== undefined && { color: d.color }),
        ...(d.sortOrder !== undefined && { sortOrder: d.sortOrder }),
      },
    });

    await createAuditLog({
      userId,
      companyId: user.companyId,
      action: "update",
      entityType: "TaskProject",
      entityId: project.id,
      metadata: { name: project.name },
    });

    return reply.send(project);
  });

  app.delete("/:id", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const userId = request.user!.sub!;
    const { id } = request.params as { id: string };

    const existing = await prisma.taskProject.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Project not found" });
    }

    await prisma.taskProject.delete({ where: { id } });

    await createAuditLog({
      userId,
      companyId: user.companyId,
      action: "delete",
      entityType: "TaskProject",
      entityId: id,
      metadata: { name: existing.name },
    });

    return reply.code(204).send();
  });
}
