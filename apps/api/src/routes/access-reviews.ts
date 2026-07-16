import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authProtect } from "../middleware/auth-protect.js";
import { requirePermission } from "../middleware/permissions.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { createApprovalRequest } from "../modules/approvals/approvals.service.js";

const recertificationSchema = z.object({
  reason: z.string().min(5).max(2000),
  approverId: z.string().min(1).optional(),
});

export async function accessReviewsRoutes(app: FastifyInstance) {
  const protect = [...authProtect, requirePermission(PERMISSIONS.ACCESS_REVIEWS_MANAGE)];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const users = await prisma.user.findMany({
      where: { companyId },
      select: {
        id: true, name: true, email: true, roleLabel: true, role: true, isSystemOwner: true,
        mfaRequired: true, mfaEnabled: true, lastLoginAt: true,
        permissions: { where: { status: "ACTIVE" }, orderBy: { permission: "asc" } },
      },
      orderBy: { name: "asc" },
    });
    const certifications = await prisma.auditLog.findMany({
      where: { companyId, action: "access_review.certified", entityType: "User" },
      select: { entityId: true, timestamp: true, user: { select: { name: true } } },
      orderBy: { timestamp: "desc" },
    });
    const latest = new Map<string, { timestamp: Date; reviewer: string | null }>();
    for (const item of certifications) if (item.entityId && !latest.has(item.entityId)) latest.set(item.entityId, { timestamp: item.timestamp, reviewer: item.user?.name ?? null });
    const dueBefore = new Date(Date.now() - 90 * 86_400_000);
    return reply.send({
      generatedAt: new Date(),
      reviewIntervalDays: 90,
      data: users.map((user) => {
        const lastReview = latest.get(user.id);
        const active = user.permissions.filter((grant) => grant.validFrom <= new Date() && (!grant.expiresAt || grant.expiresAt > new Date()));
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          roleLabel: user.roleLabel ?? user.role,
          isSystemOwner: user.isSystemOwner,
          mfa: { required: user.mfaRequired, enabled: user.mfaEnabled },
          lastLoginAt: user.lastLoginAt,
          lastReviewedAt: lastReview?.timestamp ?? null,
          lastReviewedBy: lastReview?.reviewer ?? null,
          recertificationDue: !lastReview || lastReview.timestamp < dueBefore,
          permissionCount: active.length,
          unusedPermissionCount: active.filter((grant) => !grant.lastUsedAt || grant.lastUsedAt < dueBefore).length,
          temporaryGrantCount: active.filter((grant) => grant.expiresAt != null).length,
          emergencyGrantCount: active.filter((grant) => grant.emergencyAccess).length,
          grants: active.map((grant) => ({ permission: grant.permission, scopeType: grant.scopeType, scopeId: grant.scopeId, expiresAt: grant.expiresAt, lastUsedAt: grant.lastUsedAt, emergencyAccess: grant.emergencyAccess })),
        };
      }),
    });
  });

  app.post("/:userId/recertification-requests", { preHandler: protect }, async (request, reply) => {
    const parsed = recertificationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const target = await prisma.user.findFirst({ where: { id: (request.params as { userId: string }).userId, companyId: request.user!.companyId }, select: { id: true } });
    if (!target) return reply.code(404).send({ error: "User not found" });
    const approval = await createApprovalRequest({ companyId: request.user!.companyId, approvalType: "ACCESS_CHANGE", entityType: "User", entityId: target.id, requestedById: request.user!.sub, approverId: parsed.data.approverId, reason: parsed.data.reason, riskLevel: "HIGH", payload: { action: "recertify", targetUserId: target.id } });
    return reply.code(202).send({ approval, message: "Access recertification submitted for independent approval" });
  });
}
