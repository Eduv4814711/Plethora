import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const createEmployeeGroupSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
});

const updateEmployeeGroupSchema = createEmployeeGroupSchema.partial();

export async function employeeGroupsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireRole(["admin", "operations_manager", "hr_payroll", "supervisor"], { module: "/employees" }),
  ];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const groups = await prisma.employeeGroup.findMany({
      where: { companyId: user.companyId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return reply.send({ data: groups });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createEmployeeGroupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const group = await prisma.employeeGroup.create({
      data: {
        companyId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "employee_group.create",
      entityType: "employee_group",
      entityId: group.id,
    });

    return reply.code(201).send(group);
  });

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateEmployeeGroupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const updated = await prisma.employeeGroup.updateMany({
      where: { id, companyId },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.description !== undefined && { description: parsed.data.description }),
        ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
      },
    });
    if (updated.count === 0) {
      return reply.code(404).send({ error: "Employee group not found" });
    }
    const group = await prisma.employeeGroup.findFirst({ where: { id, companyId } });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "employee_group.update",
      entityType: "employee_group",
      entityId: id,
    });

    return reply.send(group);
  });

  app.delete("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.user!.companyId;

    const existing = await prisma.employeeGroup.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Employee group not found" });
    }

    // Employee updates require a group, so deleting a non-empty group (FK SetNull)
    // would leave its members in an un-updatable state.
    const memberCount = await prisma.employee.count({ where: { companyId, groupId: id } });
    if (memberCount > 0) {
      return reply.code(400).send({
        error: "Group not empty",
        message: `Cannot delete this group while ${memberCount} employee(s) belong to it. Move them to another group first.`,
      });
    }

    await prisma.employeeGroup.deleteMany({ where: { id, companyId } });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "employee_group.delete",
      entityType: "employee_group",
      entityId: id,
    });

    return reply.send({ success: true });
  });
}
