import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const createGroupEarningsRuleSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["fixed", "percentage"]),
  amount: z.number().min(0).optional(),
  rate: z.number().min(0).max(100).optional(),
  appliesTo: z.enum(["all", "security", "office"]).default("all"),
});

const updateGroupEarningsRuleSchema = createGroupEarningsRuleSchema.partial();

async function ensureGroupBelongsToCompany(groupId: string, companyId: string) {
  const group = await prisma.employeeGroup.findFirst({
    where: { id: groupId, companyId },
  });
  return group;
}

export async function groupEarningsRulesRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "hr_payroll"], { module: "/payroll" })];

  app.get<{ Params: { groupId: string } }>(
    "/groups/:groupId/earnings-rules",
    { preHandler: protect },
    async (request, reply) => {
      const user = request.user!;
      const { groupId } = request.params;

      const group = await ensureGroupBelongsToCompany(groupId, user.companyId);
      if (!group) {
        return reply.code(404).send({ error: "Employee group not found" });
      }

      const rules = await prisma.groupEarningsRule.findMany({
        where: { groupId, companyId: user.companyId },
        orderBy: { name: "asc" },
      });
      return reply.send({ data: rules });
    }
  );

  app.post<{ Params: { groupId: string } }>(
    "/groups/:groupId/earnings-rules",
    { preHandler: protect },
    async (request, reply) => {
      const parsed = createGroupEarningsRuleSchema.safeParse(request.body);
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
      const { groupId } = request.params;

      const group = await ensureGroupBelongsToCompany(groupId, companyId);
      if (!group) {
        return reply.code(404).send({ error: "Employee group not found" });
      }

      const rule = await prisma.groupEarningsRule.create({
        data: {
          companyId,
          groupId,
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
        action: "group_earnings_rule.create",
        entityType: "group_earnings_rule",
        entityId: rule.id,
      });

      return reply.code(201).send(rule);
    }
  );

  app.put<{ Params: { groupId: string; id: string } }>(
    "/groups/:groupId/earnings-rules/:id",
    { preHandler: protect },
    async (request, reply) => {
      const { groupId, id } = request.params;
      const parsed = updateGroupEarningsRuleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Validation error",
          message: parsed.error.flatten().fieldErrors,
        });
      }

      const companyId = request.user!.companyId;

      const group = await ensureGroupBelongsToCompany(groupId, companyId);
      if (!group) {
        return reply.code(404).send({ error: "Employee group not found" });
      }

      const existing = await prisma.groupEarningsRule.findFirst({
        where: { id, groupId, companyId },
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

      const rule = await prisma.groupEarningsRule.update({
        where: { id },
        data: updateData,
      });

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "group_earnings_rule.update",
        entityType: "group_earnings_rule",
        entityId: id,
      });

      return reply.send(rule);
    }
  );

  app.delete<{ Params: { groupId: string; id: string } }>(
    "/groups/:groupId/earnings-rules/:id",
    { preHandler: protect },
    async (request, reply) => {
      const { groupId, id } = request.params;
      const companyId = request.user!.companyId;

      const group = await ensureGroupBelongsToCompany(groupId, companyId);
      if (!group) {
        return reply.code(404).send({ error: "Employee group not found" });
      }

      const existing = await prisma.groupEarningsRule.findFirst({
        where: { id, groupId, companyId },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Earnings rule not found" });
      }

      await prisma.groupEarningsRule.delete({ where: { id } });

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "group_earnings_rule.delete",
        entityType: "group_earnings_rule",
        entityId: id,
      });

      return reply.send({ success: true });
    }
  );
}
