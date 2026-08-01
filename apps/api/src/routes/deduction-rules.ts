import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireCrudCapability } from "../middleware/authorization.js";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const createDeductionRuleSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["fixed", "percentage"]),
  amount: z.number().finite().positive().optional(),
  rate: z.number().finite().positive().max(100).optional(),
  appliesTo: z.enum(["all", "security_officer", "general"]).default("all"),
  employeeIds: z.array(z.string().min(1)).max(10_000).optional(),
  isOptional: z.boolean().default(false),
});

const updateDeductionRuleSchema = createDeductionRuleSchema.partial();

async function invalidEmployeeIds(
  companyId: string,
  employeeIds: string[] | undefined
): Promise<string[]> {
  const uniqueIds = [...new Set(employeeIds ?? [])];
  if (uniqueIds.length === 0) return [];
  const employees = await prisma.employee.findMany({
    where: { companyId, id: { in: uniqueIds } },
    select: { id: true },
  });
  const found = new Set(employees.map((employee) => employee.id));
  return uniqueIds.filter((id) => !found.has(id));
}

export async function deductionRulesRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireCrudCapability({ module: "/payroll" })];

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
    if (data.type === "fixed" && data.amount == null) {
      return reply.code(400).send({
        error: "Validation error",
        message: "amount required for fixed deductions",
      });
    }
    if (data.type === "percentage" && data.rate == null) {
      return reply.code(400).send({
        error: "Validation error",
        message: "rate required for percentage deductions",
      });
    }

    const companyId = request.user!.companyId;
    const foreignEmployeeIds = await invalidEmployeeIds(companyId, data.employeeIds);
    if (foreignEmployeeIds.length > 0) {
      return reply.code(400).send({
        error: "Validation error",
        message: { employeeIds: ["Every targeted employee must belong to this company"] },
      });
    }
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
    const effectiveType = data.type ?? existing.type;
    const effectiveAmount =
      data.amount !== undefined ? data.amount : existing.amount != null ? Number(existing.amount) : null;
    const effectiveRate =
      data.rate !== undefined ? data.rate : existing.rate != null ? Number(existing.rate) : null;
    if (effectiveType === "fixed" && (effectiveAmount == null || !Number.isFinite(effectiveAmount) || effectiveAmount <= 0)) {
      return reply.code(400).send({
        error: "Validation error",
        message: { amount: ["A positive fixed deduction amount is required"] },
      });
    }
    if (effectiveType === "percentage" && (effectiveRate == null || !Number.isFinite(effectiveRate) || effectiveRate <= 0 || effectiveRate > 100)) {
      return reply.code(400).send({
        error: "Validation error",
        message: { rate: ["A percentage deduction rate between 0 and 100 is required"] },
      });
    }
    const foreignEmployeeIds = await invalidEmployeeIds(companyId, data.employeeIds);
    if (foreignEmployeeIds.length > 0) {
      return reply.code(400).send({
        error: "Validation error",
        message: { employeeIds: ["Every targeted employee must belong to this company"] },
      });
    }
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.type !== undefined) updateData.type = data.type;
    if (effectiveType === "fixed") {
      updateData.amount = effectiveAmount;
      updateData.rate = null;
    } else {
      updateData.amount = null;
      updateData.rate = effectiveRate;
    }
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
