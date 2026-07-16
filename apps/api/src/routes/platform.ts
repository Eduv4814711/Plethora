import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { platformProtect } from "../middleware/platform-auth.js";
import { ALL_PERMISSIONS } from "../lib/permissions.js";
import { auditContextFromRequest, createPlatformAuditEvent } from "../lib/audit.js";
import { generatePasswordSetupToken, hashPassword, hashPasswordSetupToken, verifyPassword } from "../services/auth.service.js";
import { applyRootRecoveryPermissionGrants, clearUserAccessCache } from "../services/user-access.service.js";
import { revokeAllUserRefreshTokens } from "../services/refresh-token.service.js";
import { env } from "../lib/env.js";

const reasonSchema = z.string().trim().min(5).max(2000);
const grantSchema = z.object({
  permission: z.string().refine((value) => (ALL_PERMISSIONS as string[]).includes(value), "Unknown permission"),
  scopeType: z.enum(["COMPANY", "SITE"]).default("COMPANY"),
  scopeId: z.string().min(1).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  emergencyAccess: z.boolean().optional().default(false),
});
const recoveryBase = { reason: reasonSchema, password: z.string().min(1) };

function setupLink(request: FastifyRequest, token: string): string {
  const configured = env.frontendUrl ?? env.corsOrigins[0];
  if (configured) return `${configured.replace(/\/+$/, "")}/setup-password?token=${encodeURIComponent(token)}`;
  const proto = request.headers["x-forwarded-proto"] ?? "http";
  const host = request.headers["x-forwarded-host"] ?? request.headers.host ?? "localhost:3000";
  return `${Array.isArray(proto) ? proto[0] : proto}://${Array.isArray(host) ? host[0] : host}/setup-password?token=${encodeURIComponent(token)}`;
}

async function confirmRootPassword(rootUserId: string, password: string): Promise<boolean> {
  const root = await prisma.user.findUnique({ where: { id: rootUserId }, select: { passwordHash: true, adminClass: true, disabledAt: true } });
  return !!root && root.adminClass === "ROOT_ADMIN" && !root.disabledAt && verifyPassword(password, root.passwordHash);
}

async function validateSiteScopes(companyId: string, grants: Array<{ scopeType: "COMPANY" | "SITE"; scopeId?: string | null }>) {
  const ids = [...new Set(grants.filter((grant) => grant.scopeType === "SITE").map((grant) => grant.scopeId).filter((id): id is string => !!id))];
  if (grants.some((grant) => grant.scopeType === "SITE" && !grant.scopeId)) return false;
  if (!ids.length) return true;
  return (await prisma.site.count({ where: { companyId, id: { in: ids } } })) === ids.length;
}

function toGrantInputs(grants: Array<z.infer<typeof grantSchema>>) {
  return grants.map((grant) => ({ ...grant, expiresAt: grant.expiresAt ? new Date(grant.expiresAt) : null }));
}

export async function platformRoutes(app: FastifyInstance) {
  app.get("/companies", { preHandler: platformProtect }, async (_request, reply) => {
    const companies = await prisma.company.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, legalName: true, registrationNumber: true, createdAt: true,
        users: { where: { adminClass: "SYSTEM_ADMIN" }, select: { id: true, disabledAt: true } },
      },
    });
    return reply.send({ data: companies.map(({ users, ...company }) => ({
      ...company,
      systemAdminCount: users.length,
      activeSystemAdminCount: users.filter((user) => !user.disabledAt).length,
      controlWarning: users.every((user) => !!user.disabledAt) ? "No active system administrator" : null,
    })) });
  });

  app.get("/companies/:companyId/system-admins", { preHandler: platformProtect }, async (request, reply) => {
    const { companyId } = request.params as { companyId: string };
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
    if (!company) return reply.code(404).send({ error: "Company not found" });
    const admins = await prisma.user.findMany({
      where: { companyId, adminClass: "SYSTEM_ADMIN" },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, email: true, roleLabel: true, disabledAt: true, disabledReason: true,
        lastLoginAt: true, accessVersion: true,
        permissions: { where: { status: "ACTIVE" }, orderBy: [{ permission: "asc" }, { scopeKey: "asc" }], select: {
          permission: true, scopeType: true, scopeId: true, validFrom: true, expiresAt: true,
          reason: true, requestedById: true, approvedById: true, emergencyAccess: true,
        } },
      },
    });
    return reply.send({ company, data: admins });
  });

  app.post("/companies/:companyId/system-admins", { preHandler: platformProtect }, async (request, reply) => {
    const parsed = z.object({
      ...recoveryBase,
      userId: z.string().min(1).optional(),
      name: z.string().trim().min(1).optional(),
      email: z.string().email().optional(),
      grants: z.array(grantSchema).max(200).default([]),
    }).refine((body) => !!body.userId || (!!body.name && !!body.email), "Choose an existing user or provide a name and email").safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    const { companyId } = request.params as { companyId: string };
    const actorId = request.user!.sub;
    if (!(await confirmRootPassword(actorId, parsed.data.password))) return reply.code(403).send({ error: "Recent password confirmation failed" });
    if (!(await validateSiteScopes(companyId, parsed.data.grants))) return reply.code(400).send({ error: "One or more site scopes are invalid" });
    if (!(await prisma.company.count({ where: { id: companyId } }))) return reply.code(404).send({ error: "Company not found" });

    let target;
    let rawToken: string | null = null;
    if (parsed.data.userId) {
      target = await prisma.user.findFirst({ where: { id: parsed.data.userId, companyId }, select: { id: true, adminClass: true, name: true, email: true } });
      if (!target) return reply.code(404).send({ error: "User not found in this company" });
      if (target.adminClass === "ROOT_ADMIN") return reply.code(409).send({ error: "A root administrator cannot also be a tenant system administrator" });
    } else {
      rawToken = generatePasswordSetupToken();
      target = await prisma.user.create({
        data: {
          companyId, name: parsed.data.name!, email: parsed.data.email!.toLowerCase(), role: "admin", roleLabel: "System Administrator",
          passwordHash: await hashPassword(generatePasswordSetupToken()), passwordSetupRequired: true,
          passwordSetupTokenHash: hashPasswordSetupToken(rawToken), passwordSetupTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          adminClass: "SYSTEM_ADMIN", isSystemOwner: false,
        },
        select: { id: true, adminClass: true, name: true, email: true },
      });
    }
    const before = { adminClass: target.adminClass };
    const access = await applyRootRecoveryPermissionGrants({ userId: target.id, rootUserId: actorId, reason: parsed.data.reason, grants: toGrantInputs(parsed.data.grants) });
    await createPlatformAuditEvent({ ...auditContextFromRequest(request), actorUserId: actorId, targetCompanyId: companyId, targetUserId: target.id,
      action: "system_admin.recovered", entityType: "user", entityId: target.id, reason: parsed.data.reason,
      beforeState: before, afterState: { adminClass: access.adminClass, grants: parsed.data.grants }, riskLevel: "CRITICAL" });
    return reply.code(rawToken ? 201 : 200).send({ id: target.id, name: target.name, email: target.email, adminClass: access.adminClass,
      ...(rawToken ? { setupLink: setupLink(request, rawToken) } : {}) });
  });

  app.patch("/system-admins/:userId/access", { preHandler: platformProtect }, async (request, reply) => {
    const parsed = z.object({ ...recoveryBase, grants: z.array(grantSchema).max(200) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    const { userId } = request.params as { userId: string };
    const actorId = request.user!.sub;
    if (!(await confirmRootPassword(actorId, parsed.data.password))) return reply.code(403).send({ error: "Recent password confirmation failed" });
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, companyId: true, adminClass: true, permissions: { where: { status: "ACTIVE" }, select: { permission: true, scopeType: true, scopeId: true, expiresAt: true } } } });
    if (!target || target.adminClass !== "SYSTEM_ADMIN") return reply.code(404).send({ error: "System administrator not found" });
    if (!(await validateSiteScopes(target.companyId, parsed.data.grants))) return reply.code(400).send({ error: "One or more site scopes are invalid" });
    await applyRootRecoveryPermissionGrants({ userId, rootUserId: actorId, reason: parsed.data.reason, grants: toGrantInputs(parsed.data.grants) });
    await createPlatformAuditEvent({ ...auditContextFromRequest(request), actorUserId: actorId, targetCompanyId: target.companyId, targetUserId: userId,
      action: "system_admin.access_changed", entityType: "user", entityId: userId, reason: parsed.data.reason,
      beforeState: { grants: target.permissions }, afterState: { grants: parsed.data.grants }, riskLevel: "CRITICAL" });
    return reply.send({ success: true, message: "Access updated and active sessions revoked" });
  });

  app.post("/system-admins/:userId/recover", { preHandler: platformProtect }, async (request, reply) => {
    const parsed = z.object({ ...recoveryBase, action: z.enum(["ENABLE", "DISABLE", "REISSUE_SETUP_LINK"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    const actorId = request.user!.sub;
    if (!(await confirmRootPassword(actorId, parsed.data.password))) return reply.code(403).send({ error: "Recent password confirmation failed" });
    const { userId } = request.params as { userId: string };
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, companyId: true, adminClass: true, disabledAt: true } });
    if (!target || target.adminClass !== "SYSTEM_ADMIN") return reply.code(404).send({ error: "System administrator not found" });
    let rawToken: string | null = null;
    const data: Prisma.UserUpdateInput = { accessVersion: { increment: 1 } };
    if (parsed.data.action === "ENABLE") { data.disabledAt = null; data.disabledReason = null; }
    if (parsed.data.action === "DISABLE") { data.disabledAt = new Date(); data.disabledReason = parsed.data.reason; }
    if (parsed.data.action === "REISSUE_SETUP_LINK") {
      rawToken = generatePasswordSetupToken();
      data.passwordSetupRequired = true; data.passwordSetupTokenHash = hashPasswordSetupToken(rawToken);
      data.passwordSetupTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); data.passwordSetupTokenConsumedAt = null;
    }
    await prisma.user.update({ where: { id: userId }, data });
    await revokeAllUserRefreshTokens(userId); clearUserAccessCache(userId);
    await createPlatformAuditEvent({ ...auditContextFromRequest(request), actorUserId: actorId, targetCompanyId: target.companyId, targetUserId: userId,
      action: `system_admin.${parsed.data.action.toLowerCase()}`, entityType: "user", entityId: userId, reason: parsed.data.reason,
      beforeState: { disabledAt: target.disabledAt }, afterState: { action: parsed.data.action }, riskLevel: "CRITICAL" });
    return reply.send({ success: true, ...(rawToken ? { setupLink: setupLink(request, rawToken) } : {}) });
  });

  app.get("/root-admins", { preHandler: platformProtect }, async (_request, reply) => {
    const data = await prisma.user.findMany({ where: { adminClass: "ROOT_ADMIN" }, orderBy: { createdAt: "asc" }, select: {
      id: true, name: true, email: true, companyId: true, disabledAt: true, lastLoginAt: true, createdAt: true,
      company: { select: { id: true, name: true } },
    } });
    return reply.send({ data });
  });

  app.post("/root-admins", { preHandler: platformProtect }, async (request, reply) => {
    const parsed = z.object({ ...recoveryBase, userId: z.string().min(1).optional(), companyId: z.string().min(1).optional(),
      name: z.string().trim().min(1).optional(), email: z.string().email().optional() })
      .refine((body) => !!body.userId || (!!body.companyId && !!body.name && !!body.email), "Choose a user or provide company, name and email")
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    const actorId = request.user!.sub;
    if (!(await confirmRootPassword(actorId, parsed.data.password))) return reply.code(403).send({ error: "Recent password confirmation failed" });
    let rawToken: string | null = null;
    let target;
    if (parsed.data.userId) {
      target = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, companyId: true, adminClass: true } });
      if (!target) return reply.code(404).send({ error: "User not found" });
    } else {
      if (!(await prisma.company.count({ where: { id: parsed.data.companyId } }))) return reply.code(404).send({ error: "Company not found" });
      rawToken = generatePasswordSetupToken();
      target = await prisma.user.create({ data: {
        companyId: parsed.data.companyId!, name: parsed.data.name!, email: parsed.data.email!.toLowerCase(), role: "admin", roleLabel: "Root Administrator",
        passwordHash: await hashPassword(generatePasswordSetupToken()), passwordSetupRequired: true,
        passwordSetupTokenHash: hashPasswordSetupToken(rawToken), passwordSetupTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        adminClass: "ROOT_ADMIN", isSystemOwner: false,
      }, select: { id: true, companyId: true, adminClass: true } });
    }
    await prisma.$transaction(async (tx) => {
      await tx.userPermission.updateMany({ where: { userId: target.id, status: "ACTIVE" }, data: { status: "REVOKED" } });
      await tx.user.update({ where: { id: target.id }, data: { adminClass: "ROOT_ADMIN", isSystemOwner: false, disabledAt: null, disabledReason: null, accessVersion: { increment: 1 } } });
    });
    await revokeAllUserRefreshTokens(target.id); clearUserAccessCache(target.id);
    await createPlatformAuditEvent({ ...auditContextFromRequest(request), actorUserId: actorId, targetCompanyId: target.companyId, targetUserId: target.id,
      action: "root_admin.promoted", entityType: "user", entityId: target.id, reason: parsed.data.reason,
      beforeState: { adminClass: target.adminClass }, afterState: { adminClass: "ROOT_ADMIN" }, riskLevel: "CRITICAL" });
    return reply.code(201).send({ success: true, id: target.id, ...(rawToken ? { setupLink: setupLink(request, rawToken) } : {}) });
  });

  app.delete("/root-admins/:userId", { preHandler: platformProtect }, async (request, reply) => {
    const parsed = z.object(recoveryBase).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    const actorId = request.user!.sub;
    if (!(await confirmRootPassword(actorId, parsed.data.password))) return reply.code(403).send({ error: "Recent password confirmation failed" });
    const { userId } = request.params as { userId: string };
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, companyId: true, adminClass: true } });
    if (!target || target.adminClass !== "ROOT_ADMIN") return reply.code(404).send({ error: "Root administrator not found" });
    if ((await prisma.user.count({ where: { adminClass: "ROOT_ADMIN", disabledAt: null } })) <= 1) return reply.code(409).send({ error: "The final active root administrator cannot be removed" });
    await prisma.user.update({ where: { id: userId }, data: { adminClass: "STANDARD", accessVersion: { increment: 1 } } });
    await revokeAllUserRefreshTokens(userId); clearUserAccessCache(userId);
    await createPlatformAuditEvent({ ...auditContextFromRequest(request), actorUserId: actorId, targetCompanyId: target.companyId, targetUserId: userId,
      action: "root_admin.removed", entityType: "user", entityId: userId, reason: parsed.data.reason,
      beforeState: { adminClass: "ROOT_ADMIN" }, afterState: { adminClass: "STANDARD" }, riskLevel: "CRITICAL" });
    return reply.code(204).send();
  });

  app.get("/audit-events", { preHandler: platformProtect }, async (request, reply) => {
    const query = z.object({ action: z.string().optional(), companyId: z.string().optional(), userId: z.string().optional(),
      from: z.string().datetime().optional(), to: z.string().datetime().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid filters" });
    const where: Prisma.PlatformAuditEventWhereInput = {
      ...(query.data.action ? { action: { contains: query.data.action, mode: "insensitive" } } : {}),
      ...(query.data.companyId ? { targetCompanyId: query.data.companyId } : {}),
      ...(query.data.userId ? { OR: [{ actorUserId: query.data.userId }, { targetUserId: query.data.userId }] } : {}),
      ...((query.data.from || query.data.to) ? { timestamp: { ...(query.data.from ? { gte: new Date(query.data.from) } : {}), ...(query.data.to ? { lte: new Date(query.data.to) } : {}) } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.platformAuditEvent.findMany({ where, orderBy: [{ timestamp: "desc" }, { id: "desc" }], skip: (query.data.page - 1) * query.data.pageSize, take: query.data.pageSize,
        include: { actor: { select: { id: true, name: true, email: true } }, targetUser: { select: { id: true, name: true, email: true } }, targetCompany: { select: { id: true, name: true } } } }),
      prisma.platformAuditEvent.count({ where }),
    ]);
    return reply.send({ data, pagination: { page: query.data.page, pageSize: query.data.pageSize, total } });
  });
}
