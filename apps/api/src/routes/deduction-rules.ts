import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const createDeductionRuleSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["fixed", "percentage"]),
  amount: z.number().min(0).optional(),
  rate: z.number().min(0).max(100).optional(),
  appliesTo: z.enum(["all", "security", "office"]).default("all"),
  employeeIds: z.array(z.string()).optional(),
  isOptional: z.boolean().default(false),
});

const updateDeductionRuleSchema = createDeductionRuleSchema.partial();

export async function deductionRulesRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "hr_payroll"], { module: "/payroll" })];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const rules = await prisma.deductionRule.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: "asc" },
    });
    return reply.send({ data: rules });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createDeductionRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    if (data.type === "fixed" && (data.amount == null || data.amount < 0)) {
      return reply.code(400).send({
        error: "Validation error",
        message: "amount required for fixed deductions",
      });
    }
    if (data.type === "percentage" && (data.rate == null || data.rate < 0)) {
      return reply.code(400).send({
        error: "Validation error",
        message: "rate required for percentage deductions",
      });
    }

    const companyId = request.user!.companyId;
    const rule = await prisma.deductionRule.create({
      data: {
        companyId,
        name: data.name,
        type: data.type,
        amount: data.type === "fixed" ? data.amount : null,
        rate: data.type === "percentage" ? data.rate : null,
        appliesTo: data.appliesTo,
        employeeIds: data.employeeIds ?? Prisma.JsonNull,
        isOptional: data.isOptional,
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "deduction_rule.create",
      entityType: "deduction_rule",
      entityId: rule.id,
    });

    return reply.code(201).send(rule);
  });

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateDeductionRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const existing = await prisma.deductionRule.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Deduction rule not found" });
    }

    const data = parsed.data;
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.amount !== undefined) updateData.amount = data.amount;
    if (data.rate !== undefined) updateData.rate = data.rate;
    if (data.appliesTo !== undefined) updateData.appliesTo = data.appliesTo;
    if (data.employeeIds !== undefined) updateData.employeeIds = data.employeeIds;
    if (data.isOptional !== undefined) updateData.isOptional = data.isOptional;

    const rule = await prisma.deductionRule.update({
      where: { id },
      data: updateData,
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "deduction_rule.update",
      entityType: "deduction_rule",
      entityId: id,
    });

    return reply.send(rule);
  });

  app.delete("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.user!.companyId;

    const existing = await prisma.deductionRule.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Deduction rule not found" });
    }

    await prisma.deductionRule.delete({ where: { id } });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "deduction_rule.delete",
      entityType: "deduction_rule",
      entityId: id,
    });

    return reply.send({ success: true });
  });
}
