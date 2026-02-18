import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const createPayGradeSchema = z.object({
  name: z.string().min(1),
  hourlyRate: z.number().positive(),
  sortOrder: z.number().int().min(0).optional(),
});

const updatePayGradeSchema = createPayGradeSchema.partial();

export async function payGradesRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "hr_payroll"])];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const grades = await prisma.payGrade.findMany({
      where: { companyId: user.companyId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return reply.send({ data: grades });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createPayGradeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const grade = await prisma.payGrade.create({
      data: {
        companyId,
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

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
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

  app.delete("/:id", { preHandler: protect }, async (request, reply) => {
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
