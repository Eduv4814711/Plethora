import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authProtect } from "../middleware/auth-protect.js";
import { requirePermission } from "../middleware/permissions.js";
import { ALL_PERMISSIONS, PERMISSIONS } from "../lib/permissions.js";
import { applyApprovedPermissionGrants, clearUserAccessCache } from "../services/user-access.service.js";
import { revokeAllUserRefreshTokens } from "../services/refresh-token.service.js";
import { auditContextFromRequest, createAuditLog } from "../lib/audit.js";

const grantSchema = z.object({
  permission: z.string().refine((value) => (ALL_PERMISSIONS as string[]).includes(value), "Unknown permission"),
  scopeType: z.enum(["COMPANY", "SITE"]).default("COMPANY"),
  scopeId: z.string().min(1).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  emergencyAccess: z.boolean().optional().default(false),
});

export async function adminChangesRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [...authProtect, requirePermission(PERMISSIONS.SYSTEM_ADMINS_REQUEST)] }, async (request, reply) => {
    const query = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED", "QUERY_RAISED"]).optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid filters" });
    const data = await prisma.adminChangeRequest.findMany({
      where: { companyId: request.user!.companyId, ...(query.data.status ? { status: query.data.status } : {}) },
      orderBy: { requestedAt: "desc" },
      include: {
        target: { select: { id: true, name: true, email: true, adminClass: true } },
        requestedBy: { select: { id: true, name: true } }, approver: { select: { id: true, name: true } },
      },
    });
    return reply.send({ data });
  });

  app.post("/", { preHandler: [...authProtect, requirePermission(PERMISSIONS.SYSTEM_ADMINS_REQUEST)] }, async (request, reply) => {
    const parsed = z.object({
      targetUserId: z.string().min(1),
      changeType: z.enum(["APPOINT_SYSTEM_ADMIN", "CHANGE_SYSTEM_ADMIN_ACCESS", "REMOVE_SYSTEM_ADMIN"]),
      grants: z.array(grantSchema).max(200).default([]), reason: z.string().trim().min(5).max(2000),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    const actor = request.access!;
    if (actor.adminClass !== "SYSTEM_ADMIN") return reply.code(403).send({ error: "Only a System Admin can request administrative access changes" });
    const target = await prisma.user.findFirst({ where: { id: parsed.data.targetUserId, companyId: actor.companyId }, select: { id: true, adminClass: true } });
    if (!target) return reply.code(404).send({ error: "User not found" });
    if (target.adminClass === "ROOT_ADMIN") return reply.code(409).send({ error: "Root accounts are platform-only" });
    for (const grant of parsed.data.grants) {
      if (!actor.permissions.has(grant.permission)) return reply.code(403).send({ error: "Forbidden", message: `You cannot grant a capability you do not hold: ${grant.permission}` });
      if (grant.scopeType === "SITE") {
        const heldScopes = actor.scopes.get(grant.permission) ?? [];
        if (!heldScopes.some((scope) => scope.type === "COMPANY" || (scope.type === "SITE" && scope.id === grant.scopeId))) {
          return reply.code(403).send({ error: "Forbidden", message: "You cannot grant a site scope you do not hold" });
        }
      }
    }
    const created = await prisma.adminChangeRequest.create({ data: {
      companyId: actor.companyId, targetUserId: target.id, changeType: parsed.data.changeType,
      requestedAdminClass: parsed.data.changeType === "REMOVE_SYSTEM_ADMIN" ? "STANDARD" : "SYSTEM_ADMIN",
      grants: parsed.data.grants, reason: parsed.data.reason, requestedById: actor.userId,
    } });
    await createAuditLog({ ...auditContextFromRequest(request), userId: actor.userId, companyId: actor.companyId,
      action: "system_admin.change_requested", entityType: "admin_change_request", entityId: created.id,
      reason: parsed.data.reason, result: "pending", riskLevel: "HIGH", afterState: parsed.data });
    return reply.code(202).send({ data: created });
  });

  app.post("/:id/approve", { preHandler: [...authProtect, requirePermission(PERMISSIONS.SYSTEM_ADMINS_APPROVE)] }, async (request, reply) => {
    const parsed = z.object({ comment: z.string().max(2000).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error" });
    const actor = request.access!;
    if (actor.adminClass !== "SYSTEM_ADMIN") return reply.code(403).send({ error: "Only a System Admin can approve administrative access changes" });
    const { id } = request.params as { id: string };
    const pending = await prisma.adminChangeRequest.findFirst({ where: { id, companyId: actor.companyId }, include: { target: { select: { id: true, companyId: true, adminClass: true } } } });
    if (!pending) return reply.code(404).send({ error: "Request not found" });
    if (pending.status !== "PENDING") return reply.code(409).send({ error: "This request has already been reviewed" });
    if (pending.requestedById === actor.userId) return reply.code(403).send({ error: "Requesters cannot approve their own changes" });
    const grants = z.array(grantSchema).parse(pending.grants ?? []);
    for (const grant of grants) {
      if (!actor.permissions.has(grant.permission)) return reply.code(403).send({ error: "Forbidden", message: `You cannot approve a capability you do not hold: ${grant.permission}` });
    }
    if (pending.changeType === "REMOVE_SYSTEM_ADMIN") {
      const activeCount = await prisma.user.count({ where: { companyId: actor.companyId, adminClass: "SYSTEM_ADMIN", disabledAt: null } });
      if (pending.target.adminClass === "SYSTEM_ADMIN" && activeCount <= 1) return reply.code(409).send({ error: "Use Root Admin recovery before removing the final active System Admin" });
      await prisma.$transaction(async (tx) => {
        await tx.userPermission.updateMany({ where: { userId: pending.targetUserId, status: "ACTIVE" }, data: { status: "REVOKED" } });
        await tx.user.update({ where: { id: pending.targetUserId }, data: { adminClass: "STANDARD", isSystemOwner: false, accessVersion: { increment: 1 } } });
      });
      await revokeAllUserRefreshTokens(pending.targetUserId); clearUserAccessCache(pending.targetUserId);
    } else {
      await applyApprovedPermissionGrants({ userId: pending.targetUserId,
        grants: grants.map((grant) => ({ ...grant, expiresAt: grant.expiresAt ? new Date(grant.expiresAt) : null })),
        requestedById: pending.requestedById, approvedById: actor.userId, approvalRequestId: pending.id, reason: pending.reason });
      await prisma.user.update({ where: { id: pending.targetUserId }, data: { adminClass: "SYSTEM_ADMIN", isSystemOwner: false } });
    }
    const updated = await prisma.adminChangeRequest.update({ where: { id }, data: { status: "APPROVED", approverId: actor.userId,
      reviewComment: parsed.data.comment, reviewedAt: new Date(), executedAt: new Date() } });
    await createAuditLog({ ...auditContextFromRequest(request), userId: actor.userId, companyId: actor.companyId,
      action: "system_admin.change_approved", entityType: "admin_change_request", entityId: id, reason: pending.reason,
      riskLevel: "CRITICAL", approvalRequestId: id, metadata: { requestedById: pending.requestedById, targetUserId: pending.targetUserId } });
    return reply.send({ data: updated });
  });

  app.post("/:id/reject", { preHandler: [...authProtect, requirePermission(PERMISSIONS.SYSTEM_ADMINS_APPROVE)] }, async (request, reply) => {
    const parsed = z.object({ comment: z.string().trim().min(3).max(2000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "A rejection reason is required" });
    const { id } = request.params as { id: string };
    const pending = await prisma.adminChangeRequest.findFirst({ where: { id, companyId: request.user!.companyId } });
    if (!pending) return reply.code(404).send({ error: "Request not found" });
    if (pending.status !== "PENDING") return reply.code(409).send({ error: "This request has already been reviewed" });
    if (pending.requestedById === request.user!.sub) return reply.code(403).send({ error: "Requesters cannot review their own changes" });
    const updated = await prisma.adminChangeRequest.update({ where: { id }, data: { status: "REJECTED", approverId: request.user!.sub, reviewComment: parsed.data.comment, reviewedAt: new Date() } });
    await createAuditLog({ ...auditContextFromRequest(request), userId: request.user!.sub, companyId: request.user!.companyId,
      action: "system_admin.change_rejected", entityType: "admin_change_request", entityId: id, reason: parsed.data.comment, result: "denied", riskLevel: "HIGH" });
    return reply.send({ data: updated });
  });
}
