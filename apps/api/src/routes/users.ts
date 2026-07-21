import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole, normalizeModulePermissions } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import {
  findManyUsersForCompany,
  findUniqueUserListRow,
  isMissingModuleAccessColumnError,
  isMissingPasswordSetupColumnError,
  isMissingRoleLabelColumnError,
} from "../lib/user-module-column.js";
import { createAuditLog } from "../lib/audit.js";
import { generatePasswordSetupToken, hashPassword, hashPasswordSetupToken } from "../services/auth.service.js";
import { validatePassword, PASSWORD_MIN_LENGTH } from "../lib/password-policy.js";
import { badRequest } from "../lib/api-response.js";
import { env } from "../lib/env.js";

const MODULE_ACCESS_MIGRATION_MESSAGE =
  "The database is missing the User.moduleAccess column. From the project root run: npm run db:push. If that fails on duplicate User emails (email unique), run: npm run db:add-module-access — it only adds the moduleAccess column. Later, fix duplicate emails (npm run db:check-email-unique in apps/api) then db:push to align the rest of the schema. DATABASE_URL must be set in apps/api/.env.";

const moduleAccessSchema = z
  .union([z.array(z.string()), z.record(z.string(), z.enum(["read", "write"])), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : normalizeModulePermissions(v)));

const roleLabelSchema = z.union([z.string().max(120), z.null()]).optional();

function normalizeRoleLabel(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildPasswordSetupLink(request: FastifyRequest, token: string): string {
  const configuredWebUrl =
    env.frontendUrl ?? (env.corsOrigins.length > 0 ? env.corsOrigins[0] : undefined);
  if (configuredWebUrl) {
    const baseUrl = configuredWebUrl.replace(/\/+$/, "");
    return `${baseUrl}/setup-password?token=${encodeURIComponent(token)}`;
  }
  const protoHeader = request.headers["x-forwarded-proto"];
  const hostHeader = request.headers["x-forwarded-host"] ?? request.headers.host;
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (proto && host) return `${proto}://${host}/setup-password?token=${encodeURIComponent(token)}`;
  return `http://localhost:3000/setup-password?token=${encodeURIComponent(token)}`;
}

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN_LENGTH).optional(),
  sendSetupLink: z.boolean().optional().default(true),
  role: z.enum(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"]),
  roleLabel: roleLabelSchema,
  moduleAccess: moduleAccessSchema,
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(PASSWORD_MIN_LENGTH).optional(),
  role: z.enum(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"]).optional(),
  roleLabel: roleLabelSchema,
  moduleAccess: moduleAccessSchema,
});

export async function usersRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin"])];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 20, 100);
    const offset = Number(q.offset) || 0;

    const [users, total] = await Promise.all([
      findManyUsersForCompany(user.companyId, limit, offset),
      prisma.user.count({ where: { companyId: user.companyId } }),
    ]);

    return reply.send({ data: users, total, limit, offset });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const inviteMode = parsed.data.sendSetupLink ?? true;
    if (!inviteMode && !parsed.data.password) {
      return reply.code(400).send({
        error: "Validation error",
        message: { password: ["Password is required when setup link is disabled"] },
      });
    }
    if (parsed.data.password) {
      const check = validatePassword(parsed.data.password);
      if (!check.valid) return badRequest(reply, check.message ?? "Password does not meet policy");
    }
    const setupToken = inviteMode ? generatePasswordSetupToken() : null;
    const setupTokenHash = setupToken ? hashPasswordSetupToken(setupToken) : null;
    const setupTokenExpiresAt = inviteMode ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;
    const passwordHash = parsed.data.password
      ? await hashPassword(parsed.data.password)
      : await hashPassword(generatePasswordSetupToken());

    const baseCreate = {
      companyId,
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      passwordHash,
      passwordSetupRequired: inviteMode,
      passwordSetupTokenHash: setupTokenHash,
      passwordSetupTokenExpiresAt: setupTokenExpiresAt,
      passwordSetupTokenConsumedAt: null,
      role: parsed.data.role,
      roleLabel: normalizeRoleLabel(parsed.data.roleLabel),
    };
    const createData =
      parsed.data.moduleAccess != null && Object.keys(parsed.data.moduleAccess).length > 0
        ? { ...baseCreate, moduleAccess: parsed.data.moduleAccess }
        : baseCreate;

    try {
      let user;
      try {
        user = await prisma.user.create({
          data: createData,
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            roleLabel: true,
            companyId: true,
            moduleAccess: true,
            createdAt: true,
          },
        });
      } catch (e) {
        const missingModuleAccess = isMissingModuleAccessColumnError(e);
        const missingRoleLabel = isMissingRoleLabelColumnError(e);
        const missingPasswordSetup = isMissingPasswordSetupColumnError(e);
        if (!missingModuleAccess && !missingRoleLabel && !missingPasswordSetup) throw e;
        if (missingModuleAccess && Object.prototype.hasOwnProperty.call(createData, "moduleAccess")) {
          return reply.code(503).send({
            error: "Module access not available",
            message: MODULE_ACCESS_MIGRATION_MESSAGE,
          });
        }
        const fallbackCreate = { ...createData };
        delete (fallbackCreate as { roleLabel?: string | null }).roleLabel;
        delete (fallbackCreate as { passwordSetupRequired?: boolean }).passwordSetupRequired;
        delete (fallbackCreate as { passwordSetupTokenHash?: string | null }).passwordSetupTokenHash;
        delete (fallbackCreate as { passwordSetupTokenExpiresAt?: Date | null }).passwordSetupTokenExpiresAt;
        delete (fallbackCreate as { passwordSetupTokenConsumedAt?: Date | null }).passwordSetupTokenConsumedAt;
        user = await prisma.user.create({
          data: fallbackCreate,
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            companyId: true,
            createdAt: true,
          },
        });
        user = { ...user, roleLabel: null, moduleAccess: null };
      }

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "user.create",
        entityType: "user",
        entityId: user.id,
      });

      return reply.code(201).send({
        ...user,
        ...(setupToken ? { setupLink: buildPasswordSetupLink(request, setupToken) } : {}),
      });
    } catch (err: unknown) {
      const prismaErr = err as { code?: string };
      if (prismaErr.code === "P2002") {
        return reply.code(409).send({
          error: "Email already registered",
          message: "This email is already in use. Use a different email.",
        });
      }
      throw err;
    }
  });

  app.get("/team-member-candidates", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const searchQuery = (q.q ?? "").trim();
    const limit = Math.min(Math.max(Number(q.limit) || 10, 1), 20);

    if (searchQuery.length < 2) {
      return reply.send({ data: [] });
    }

    const [employees, companyUsers] = await Promise.all([
      prisma.employee.findMany({
        where: {
          companyId: user.companyId,
          status: { not: "offboarded" },
          OR: [
            { firstName: { contains: searchQuery, mode: "insensitive" } },
            { lastName: { contains: searchQuery, mode: "insensitive" } },
            { employeeNumber: { contains: searchQuery, mode: "insensitive" } },
            { email: { contains: searchQuery, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          employeeNumber: true,
          firstName: true,
          lastName: true,
          email: true,
          jobRole: true,
          status: true,
        },
        take: limit,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      prisma.user.findMany({
        where: { companyId: user.companyId },
        select: { email: true },
      }),
    ]);

    const userEmails = new Set(companyUsers.map((u) => u.email.toLowerCase()));

    const data = employees.map((e) => ({
      id: e.id,
      employeeNumber: e.employeeNumber,
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.email,
      jobRole: e.jobRole,
      status: e.status,
      hasUserAccount: !!e.email && userEmails.has(e.email.toLowerCase()),
    }));

    return reply.send({ data });
  });

  app.get("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const found = await findUniqueUserListRow(id, user.companyId);

    if (!found) {
      return reply.code(404).send({ error: "User not found" });
    }

    return reply.send(found);
  });

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const existing = await prisma.user.findFirst({
      where: { id, companyId },
      select: { id: true },
    });

    if (!existing) {
      return reply.code(404).send({ error: "User not found" });
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.name) updateData.name = parsed.data.name;
    if (parsed.data.email) updateData.email = parsed.data.email.toLowerCase();
    if (parsed.data.role) updateData.role = parsed.data.role;
    if (parsed.data.roleLabel !== undefined) updateData.roleLabel = normalizeRoleLabel(parsed.data.roleLabel);
    if (parsed.data.password) {
      const check = validatePassword(parsed.data.password);
      if (!check.valid) return badRequest(reply, check.message ?? "Password does not meet policy");
      updateData.passwordHash = await hashPassword(parsed.data.password);
    }
    if (parsed.data.moduleAccess !== undefined) {
      updateData.moduleAccess =
        parsed.data.moduleAccess === null || Object.keys(parsed.data.moduleAccess).length === 0
          ? Prisma.JsonNull
          : parsed.data.moduleAccess;
    }

    let updated;
    try {
      updated = await prisma.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          roleLabel: true,
          companyId: true,
          moduleAccess: true,
          createdAt: true,
        },
      });
    } catch (e) {
      const missingModuleAccess = isMissingModuleAccessColumnError(e);
      const missingRoleLabel = isMissingRoleLabelColumnError(e);
      const missingPasswordSetup = isMissingPasswordSetupColumnError(e);
      if (!missingModuleAccess && !missingRoleLabel && !missingPasswordSetup) throw e;
      const softData = { ...updateData };
      // Older deployments may not have the optional access columns yet. Do not
      // let that prevent unrelated account changes (especially password
      // changes) from being saved. A module-only update still needs the
      // migration so we do not report success without applying the request.
      const hasNonModuleUpdate = Object.keys(softData).some((key) => key !== "moduleAccess" && key !== "roleLabel");
      if (missingModuleAccess && !hasNonModuleUpdate) {
        return reply.code(503).send({
          error: "Module access not available",
          message: MODULE_ACCESS_MIGRATION_MESSAGE,
        });
      }
      if (missingModuleAccess) {
        delete (softData as { moduleAccess?: Prisma.InputJsonValue | typeof Prisma.JsonNull }).moduleAccess;
      }
      delete (softData as { roleLabel?: string | null }).roleLabel;
      delete (softData as { passwordSetupRequired?: boolean }).passwordSetupRequired;
      delete (softData as { passwordSetupTokenHash?: string | null }).passwordSetupTokenHash;
      delete (softData as { passwordSetupTokenExpiresAt?: Date | null }).passwordSetupTokenExpiresAt;
      delete (softData as { passwordSetupTokenConsumedAt?: Date | null }).passwordSetupTokenConsumedAt;
      updated = await prisma.user.update({
        where: { id },
        data: softData,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          companyId: true,
          createdAt: true,
        },
      });
      updated = { ...updated, roleLabel: null, moduleAccess: null };
    }

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "user.update",
      entityType: "user",
      entityId: id,
      metadata: { updatedFields: Object.keys(updateData) },
    });

    return reply.send(updated);
  });

  app.delete("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const existing = await prisma.user.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true },
    });

    if (!existing) {
      return reply.code(404).send({ error: "User not found" });
    }

    if (id === user.sub) {
      return reply.code(400).send({ error: "You cannot delete your own account" });
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Be explicit about dependent task data to stay compatible with older DBs
        // where FK cascades may not have been applied yet.
        await tx.taskReminder.deleteMany({ where: { task: { createdById: id } } });
        await tx.taskComment.deleteMany({
          where: {
            OR: [{ userId: id }, { task: { createdById: id } }],
          },
        });
        await tx.taskAttachment.deleteMany({
          where: {
            OR: [{ uploadedById: id }, { task: { createdById: id } }],
          },
        });
        await tx.task.deleteMany({ where: { createdById: id } });
        await tx.whatsAppMessage.updateMany({
          where: { companyId: user.companyId, sentByUserId: id },
          data: { sentByUserId: null },
        });
        await tx.auditLog.updateMany({
          where: { userId: id },
          data: { userId: null },
        });
        await tx.user.delete({ where: { id } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        const rawField = (e.meta as { field_name?: unknown } | undefined)?.field_name;
        const fieldName = typeof rawField === "string" ? rawField : "a related record";
        return reply.code(409).send({
          error: "Cannot delete user",
          message: `This account is still linked to ${fieldName}. Remove linked records and try again.`,
        });
      }
      throw e;
    }

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "user.delete",
      entityType: "user",
      entityId: id,
    });

    return reply.code(204).send();
  });
}
