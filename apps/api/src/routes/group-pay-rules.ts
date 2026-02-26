import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const RULE_TYPES = ["overtime", "sunday", "public_holiday"] as const;

const updateGroupPayRuleSchema = z.object({
  ruleType: z.enum(RULE_TYPES),
  multiplier: z.number().min(0).max(10),
});

async function ensureGroupBelongsToCompany(groupId: string, companyId: string) {
  const group = await prisma.employeeGroup.findFirst({
    where: { id: groupId, companyId },
  });
  return group;
}

export async function groupPayRulesRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "hr_payroll"])];

  app.get<{ Params: { groupId: string } }>(
    "/groups/:groupId/pay-rules",
    { preHandler: protect },
    async (request, reply) => {
      const user = request.user!;
      const { groupId } = request.params;

      const group = await ensureGroupBelongsToCompany(groupId, user.companyId);
      if (!group) {
        return reply.code(404).send({ error: "Employee group not found" });
      }

      const rules = await prisma.groupPayRule.findMany({
        where: { groupId, companyId: user.companyId },
        orderBy: { ruleType: "asc" },
      });
      return reply.send({ data: rules });
    }
  );

  app.put<{ Params: { groupId: string } }>(
    "/groups/:groupId/pay-rules",
    { preHandler: protect },
    async (request, reply) => {
      const parsed = updateGroupPayRuleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Validation error",
          message: parsed.error.flatten().fieldErrors,
        });
      }

      const companyId = request.user!.companyId;
      const { groupId } = request.params;
      const { ruleType, multiplier } = parsed.data;

      const group = await ensureGroupBelongsToCompany(groupId, companyId);
      if (!group) {
        return reply.code(404).send({ error: "Employee group not found" });
      }

      const rule = await prisma.groupPayRule.upsert({
        where: {
          groupId_ruleType: { groupId, ruleType },
        },
        create: { companyId, groupId, ruleType, multiplier },
        update: { multiplier },
      });

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "group_pay_rule.upsert",
        entityType: "group_pay_rule",
        entityId: rule.id,
        metadata: { groupId, ruleType, multiplier },
      });

      return reply.send(rule);
    }
  );
}
