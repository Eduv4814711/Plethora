import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const createEarningsRuleSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["fixed", "percentage"]),
  amount: z.number().min(0).optional(),
  rate: z.number().min(0).max(100).optional(),
  appliesTo: z.enum(["all", "security", "office"]).default("all"),
});

const updateEarningsRuleSchema = createEarningsRuleSchema.partial();

export async function earningsRulesRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "hr_payroll"])];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const rules = await prisma.earningsRule.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: "asc" },
    });
    return reply.send({ data: rules });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createEarningsRuleSchema.safeParse(request.body);
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
        message: "amount required for fixed earnings",
      });
    }
    if (data.type === "percentage" && (data.rate == null || data.rate < 0)) {
      return reply.code(400).send({
        error: "Validation error",
        message: "rate required for percentage earnings",
      });
    }

    const companyId = request.user!.companyId;
    const rule = await prisma.earningsRule.create({
      data: {
        companyId,
        name: data.name,
        type: data.type,
        amount: data.type === "fixed" ? data.amount : null,
        rate: data.type === "percentage" ? data.rate : null,
        appliesTo: data.appliesTo,
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "earnings_rule.create",
      entityType: "earnings_rule",
      entityId: rule.id,
    });

    return reply.code(201).send(rule);
  });

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateEarningsRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const existing = await prisma.earningsRule.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Earnings rule not found" });
    }

    const data = parsed.data;
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.amount !== undefined) updateData.amount = data.amount;
    if (data.rate !== undefined) updateData.rate = data.rate;
    if (data.appliesTo !== undefined) updateData.appliesTo = data.appliesTo;

    const rule = await prisma.earningsRule.update({
      where: { id },
      data: updateData,
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "earnings_rule.update",
      entityType: "earnings_rule",
      entityId: id,
    });

    return reply.send(rule);
  });

  app.delete("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.user!.companyId;

    const existing = await prisma.earningsRule.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Earnings rule not found" });
    }

    await prisma.earningsRule.delete({ where: { id } });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "earnings_rule.delete",
      entityType: "earnings_rule",
      entityId: id,
    });

    return reply.send({ success: true });
  });
}
