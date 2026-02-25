import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../services/auth.service.js";
import { createAuditLog } from "../lib/audit.js";

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"]),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"]).optional(),
});

export async function usersRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin"])];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 20, 100);
    const offset = Number(q.offset) || 0;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: { companyId: user.companyId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          companyId: true,
          createdAt: true,
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where: { companyId: user.companyId } }),
    ]);

    return reply.send({ data: users, total, limit, offset });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const passwordHash = await hashPassword(parsed.data.password);

    const user = await prisma.user.create({
      data: {
        companyId,
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        passwordHash,
        role: parsed.data.role,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        createdAt: true,
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "user.create",
      entityType: "user",
      entityId: user.id,
    });

    return reply.code(201).send(user);
  });

  app.get("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const found = await prisma.user.findFirst({
      where: { id, companyId: user.companyId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        createdAt: true,
      },
    });

    if (!found) {
      return reply.code(404).send({ error: "User not found" });
    }

    return reply.send(found);
  });

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const existing = await prisma.user.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "User not found" });
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.name) updateData.name = parsed.data.name;
    if (parsed.data.email) updateData.email = parsed.data.email.toLowerCase();
    if (parsed.data.role) updateData.role = parsed.data.role;
    if (parsed.data.password) {
      updateData.passwordHash = await hashPassword(parsed.data.password);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        createdAt: true,
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "user.update",
      entityType: "user",
      entityId: id,
      metadata: { updatedFields: Object.keys(updateData) },
    });

    return reply.send(updated);
  });

  app.delete("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const existing = await prisma.user.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "User not found" });
    }

    if (id === user.sub) {
      return reply.code(400).send({ error: "You cannot delete your own account" });
    }

    await prisma.user.delete({
      where: { id },
    });

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "user.delete",
      entityType: "user",
      entityId: id,
    });

    return reply.code(204).send();
  });
}
