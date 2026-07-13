import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authProtect } from "../middleware/auth-protect.js";
import { requireRole } from "../middleware/rbac.js";
import { requirePermission } from "../middleware/permissions.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { employeeGradeOperationalSelect } from "../lib/employee-dto.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const createPayGradeSchema = z.object({
  name: z.string().min(1),
  hourlyRate: z.number().positive(),
  sortOrder: z.number().int().min(0).optional(),
  groupId: z.string().optional().nullable(),
});

const updatePayGradeSchema = createPayGradeSchema.partial();

export async function payGradesRoutes(app: FastifyInstance) {
  const readRatesProtect = [
    ...authProtect,
    requireRole(["admin", "hr_payroll"], { anyOfModules: ["/payroll", "/employees"] }),
    requirePermission(PERMISSIONS.PAY_GRADES_READ_RATES),
  ];
  const readNamesProtect = [
    ...authProtect,
    requireRole(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"], {
      anyOfModules: ["/payroll", "/employees", "/rostering"],
    }),
    requirePermission(PERMISSIONS.PAY_GRADES_READ_NAMES),
  ];
  const manageProtect = [
    ...authProtect,
    requireRole(["admin", "hr_payroll"], { module: "/payroll" }),
    requirePermission(PERMISSIONS.PAY_GRADES_MANAGE_RATES),
  ];

  app.get("/options", { preHandler: readNamesProtect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { groupId?: string };
    const where: { companyId: string; groupId?: null | { equals: string } } = { companyId: user.companyId };
    if (q.groupId) where.groupId = { equals: q.groupId };
    else where.groupId = null;
    const grades = await prisma.payGrade.findMany({
      where,
      select: employeeGradeOperationalSelect,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return reply.send({ data: grades });
  });

  app.get("/", { preHandler: readRatesProtect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { groupId?: string };

    const where: { companyId: string; groupId?: null | { equals: string } } = {
      companyId: user.companyId,
    };
    if (q.groupId) {
      where.groupId = { equals: q.groupId };
    } else {
      where.groupId = null;
    }
    const grades = await prisma.payGrade.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return reply.send({ data: grades });
  });

  app.post("/", { preHandler: manageProtect }, async (request, reply) => {
    const parsed = createPayGradeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const groupId = parsed.data.groupId ?? null;
    if (groupId) {
      const group = await prisma.employeeGroup.findFirst({
        where: { id: groupId, companyId },
      });
      if (!group) {
        return reply.code(404).send({ error: "Employee group not found" });
      }
    }
    const grade = await prisma.payGrade.create({
      data: {
        companyId,
        groupId,
        name: parsed.data.name,
        hourlyRate: parsed.data.hourlyRate,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "pay_grade.create",
      entityType: "pay_grade",
      entityId: grade.id,
    });

    return reply.code(201).send(grade);
  });

  app.put("/:id", { preHandler: manageProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updatePayGradeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const existing = await prisma.payGrade.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Pay grade not found" });
    }

    const grade = await prisma.payGrade.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.hourlyRate !== undefined && { hourlyRate: parsed.data.hourlyRate }),
        ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "pay_grade.update",
      entityType: "pay_grade",
      entityId: id,
    });

    return reply.send(grade);
  });

  app.delete("/:id", { preHandler: manageProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.user!.companyId;

    const existing = await prisma.payGrade.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Pay grade not found" });
    }

    await prisma.payGrade.delete({ where: { id } });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "pay_grade.delete",
      entityType: "pay_grade",
      entityId: id,
    });

    return reply.send({ success: true });
  });
}
