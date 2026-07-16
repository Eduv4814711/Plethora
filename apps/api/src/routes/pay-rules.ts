import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authProtect } from "../middleware/auth-protect.js";
import { requireRole } from "../middleware/rbac.js";
import { requirePermission } from "../middleware/permissions.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const RULE_TYPES = ["overtime", "sunday", "public_holiday"] as const;

const updatePayRuleSchema = z.object({
  ruleType: z.enum(RULE_TYPES),
  multiplier: z.number().min(0).max(10),
});

export async function payRulesRoutes(app: FastifyInstance) {
  const readProtect = [...authProtect, requireRole(["admin", "hr_payroll"], { module: "/payroll" }), requirePermission(PERMISSIONS.PAY_GRADES_READ_RATES)];
  const manageProtect = [...authProtect, requireRole(["admin", "hr_payroll"], { module: "/payroll" }), requirePermission(PERMISSIONS.PAY_GRADES_MANAGE_RATES)];

  app.get("/", { preHandler: readProtect }, async (request, reply) => {
    const user = request.user!;
    const rules = await prisma.payRule.findMany({
      where: { companyId: user.companyId },
      orderBy: { ruleType: "asc" },
    });
    return reply.send({ data: rules });
  });

  app.put("/", { preHandler: manageProtect }, async (request, reply) => {
    const parsed = updatePayRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const { ruleType, multiplier } = parsed.data;

    const rule = await prisma.payRule.upsert({
      where: {
        companyId_ruleType: { companyId, ruleType },
      },
      create: { companyId, ruleType, multiplier },
      update: { multiplier },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "pay_rule.upsert",
      entityType: "pay_rule",
      entityId: rule.id,
      metadata: { ruleType, multiplier },
    });

    return reply.send(rule);
  });
}
