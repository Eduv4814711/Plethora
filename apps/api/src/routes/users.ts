import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireCapability, requireOwner } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import {
  CAPABILITY_CATALOG,
  findUnassignableCapability,
  hasCapability,
  normalizeCapabilities,
  validateCapabilities,
  type CapabilityMap,
} from "../lib/capabilities.js";
import { findManyUsersForCompany, findUniqueUserListRow } from "../lib/user-access.js";
import {
  generatePasswordSetupToken,
  hashPassword,
  hashPasswordSetupToken,
  verifyPassword,
} from "../services/auth.service.js";
import { validatePassword, PASSWORD_MIN_LENGTH } from "../lib/password-policy.js";
import { badRequest } from "../lib/api-response.js";
import { env } from "../lib/env.js";

const capabilitiesSchema = z.record(z.string(), z.array(z.string())).default({});
const accountTypeSchema = z.enum(["staff", "client"]);

function parseCapabilities(raw: unknown):
  | { success: true; data: CapabilityMap }
  | { success: false; message: string } {
  const parsed = capabilitiesSchema.safeParse(raw);
  if (!parsed.success) return { success: false, message: "Capabilities must be a path-to-capability-list object" };
  return validateCapabilities(parsed.data);
}

function buildPasswordSetupLink(request: FastifyRequest, token: string): string {
  const configuredWebUrl =
    env.frontendUrl ?? (env.corsOrigins.length > 0 ? env.corsOrigins[0] : undefined);
  if (configuredWebUrl) {
    return `${configuredWebUrl.replace(/\/+$/, "")}/setup-password?token=${encodeURIComponent(token)}`;
  }
  const protoRaw = request.headers["x-forwarded-proto"];
  const hostRaw = request.headers["x-forwarded-host"] ?? request.headers.host;
  const proto = Array.isArray(protoRaw) ? protoRaw[0] : protoRaw;
  const host = Array.isArray(hostRaw) ? hostRaw[0] : hostRaw;
  return proto && host
    ? `${proto}://${host}/setup-password?token=${encodeURIComponent(token)}`
    : `http://localhost:3000/setup-password?token=${encodeURIComponent(token)}`;
}

const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN_LENGTH).optional(),
  sendSetupLink: z.boolean().optional().default(true),
  accountType: accountTypeSchema.default("staff"),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  isActive: z.boolean().optional().default(true),
  capabilities: capabilitiesSchema,
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().email().optional(),
  accountType: accountTypeSchema.optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  isActive: z.boolean().optional(),
  capabilities: capabilitiesSchema.optional(),
});

const transferOwnershipSchema = z.object({
  newOwnerUserId: z.string().min(1),
  currentPassword: z.string().min(1),
});

const userSelect = {
  id: true,
  name: true,
  email: true,
  accountType: true,
  jobTitle: true,
  isActive: true,
  companyId: true,
  capabilities: true,
  createdAt: true,
} as const;

export async function usersRoutes(app: FastifyInstance) {
  const viewAccess = [authMiddleware, requireCapability("/settings/access", "view")];
  const createAccess = [
    authMiddleware,
    requireCapability("/settings/access", "create"),
    requireCapability("/settings/access", "manage_access"),
  ];
  const editAccess = [
    authMiddleware,
    requireCapability("/settings/access", "edit"),
    requireCapability("/settings/access", "manage_access"),
  ];
  const deleteAccess = [
    authMiddleware,
    requireCapability("/settings/access", "delete"),
    requireCapability("/settings/access", "manage_access"),
  ];

  app.get("/capability-catalog", { preHandler: viewAccess }, async (_request, reply) => {
    return reply.send({ data: CAPABILITY_CATALOG });
  });

  app.get("/", { preHandler: viewAccess }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const [users, total] = await Promise.all([
      findManyUsersForCompany(request.user!.companyId, limit, offset),
      prisma.user.count({ where: { companyId: request.user!.companyId } }),
    ]);
    return reply.send({ data: users, total, limit, offset });
  });

  app.post("/", { preHandler: createAccess }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    }
    const permissions = parseCapabilities(parsed.data.capabilities);
    if (!permissions.success) return badRequest(reply, permissions.message);
    const unassignable = findUnassignableCapability(request.user!, permissions.data);
    if (unassignable) {
      return reply.code(403).send({
        error: "Forbidden",
        message: `You cannot assign ${unassignable.capability} access for ${unassignable.path}`,
      });
    }
    const inviteMode = parsed.data.sendSetupLink;
    if (!inviteMode && !parsed.data.password) {
      return badRequest(reply, "Password is required when setup link is disabled");
    }
    if (parsed.data.password) {
      const check = validatePassword(parsed.data.password);
      if (!check.valid) return badRequest(reply, check.message ?? "Password does not meet policy");
    }

    const setupToken = inviteMode ? generatePasswordSetupToken() : null;
    const passwordHash = parsed.data.password
      ? await hashPassword(parsed.data.password)
      : await hashPassword(generatePasswordSetupToken());
    try {
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.user.create({
          data: {
            companyId: request.user!.companyId,
            name: parsed.data.name,
            email: parsed.data.email.toLowerCase(),
            passwordHash,
            passwordSetupRequired: inviteMode,
            passwordSetupTokenHash: setupToken ? hashPasswordSetupToken(setupToken) : null,
            passwordSetupTokenExpiresAt: setupToken ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
            accountType: parsed.data.accountType,
            jobTitle: parsed.data.jobTitle || null,
            isActive: parsed.data.isActive,
            capabilities: permissions.data,
          },
          select: userSelect,
        });
        await tx.auditLog.create({
          data: {
            userId: request.user!.sub,
            companyId: request.user!.companyId,
            action: "user.create",
            entityType: "user",
            entityId: row.id,
            metadata: { accountType: row.accountType, capabilities: permissions.data },
          },
        });
        return row;
      });
      return reply.code(201).send({
        ...created,
        isOwner: false,
        ...(setupToken ? { setupLink: buildPasswordSetupLink(request, setupToken) } : {}),
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return reply.code(409).send({ error: "Email already registered", message: "This email is already in use." });
      }
      throw error;
    }
  });

  app.get("/team-member-candidates", { preHandler: createAccess }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const searchQuery = (q.q ?? "").trim();
    const limit = Math.min(Math.max(Number(q.limit) || 10, 1), 20);
    if (searchQuery.length < 2) return reply.send({ data: [] });
    const [employees, users] = await Promise.all([
      prisma.employee.findMany({
        where: {
          companyId: request.user!.companyId,
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
        where: { companyId: request.user!.companyId },
        select: { email: true },
      }),
    ]);
    const userEmails = new Set(users.map((user) => user.email.toLowerCase()));
    return reply.send({
      data: employees.map((employee) => ({
        ...employee,
        hasUserAccount: !!employee.email && userEmails.has(employee.email.toLowerCase()),
      })),
    });
  });

  app.get("/:id", { preHandler: viewAccess }, async (request, reply) => {
    const found = await findUniqueUserListRow(
      (request.params as { id: string }).id,
      request.user!.companyId
    );
    return found ? reply.send(found) : reply.code(404).send({ error: "User not found" });
  });

  app.put("/:id", { preHandler: editAccess }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    }
    const existing = await prisma.user.findFirst({
      where: { id, companyId: request.user!.companyId },
      select: { ...userSelect, company: { select: { ownerUserId: true } } },
    });
    if (!existing) return reply.code(404).send({ error: "User not found" });
    const isOwner = existing.company.ownerUserId === id;
    if (isOwner && request.user!.sub !== id) {
      return reply.code(403).send({
        error: "Forbidden",
        message: "Only the company owner may update the owner account",
      });
    }
    if (isOwner && parsed.data.isActive === false) {
      return badRequest(reply, "Transfer ownership before deactivating the company owner");
    }
    const targetManagesAccess = hasCapability(
      { capabilities: existing.capabilities, isActive: existing.isActive },
      "/settings/access",
      "manage_access"
    );
    if (!request.user!.isOwner && targetManagesAccess) {
      return reply.code(403).send({
        error: "Forbidden",
        message: "Only the company owner may update another access manager",
      });
    }
    if (
      !request.user!.isOwner &&
      id === request.user!.sub &&
      parsed.data.capabilities !== undefined
    ) {
      return reply.code(403).send({
        error: "Forbidden",
        message: "Access managers cannot change their own capabilities",
      });
    }
    const permissions = parsed.data.capabilities === undefined
      ? null
      : parseCapabilities(parsed.data.capabilities);
    if (permissions && !permissions.success) return badRequest(reply, permissions.message);
    if (permissions?.success) {
      const previous = normalizeCapabilities(existing.capabilities);
      const additions: CapabilityMap = {};
      for (const [path, capabilities] of Object.entries(permissions.data)) {
        const newlyGranted = capabilities.filter(
          (capability) => !(previous[path] ?? []).includes(capability)
        );
        if (newlyGranted.length) additions[path] = newlyGranted;
      }
      const unassignable = findUnassignableCapability(request.user!, additions);
      if (unassignable) {
        return reply.code(403).send({
          error: "Forbidden",
          message: `You cannot assign ${unassignable.capability} access for ${unassignable.path}`,
        });
      }
    }

    const updateData: Prisma.UserUpdateInput = {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.email !== undefined ? { email: parsed.data.email.toLowerCase() } : {}),
      ...(parsed.data.accountType !== undefined ? { accountType: parsed.data.accountType } : {}),
      ...(parsed.data.jobTitle !== undefined ? { jobTitle: parsed.data.jobTitle || null } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      ...(permissions?.success ? { capabilities: permissions.data } : {}),
    };
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({ where: { id }, data: updateData, select: userSelect });
      if (parsed.data.isActive === false) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: request.user!.sub,
          companyId: request.user!.companyId,
          action: "user.access.update",
          entityType: "user",
          entityId: id,
          metadata: {
            before: {
              accountType: existing.accountType,
              jobTitle: existing.jobTitle,
              isActive: existing.isActive,
              capabilities: existing.capabilities,
            },
            after: {
              accountType: row.accountType,
              jobTitle: row.jobTitle,
              isActive: row.isActive,
              capabilities: row.capabilities,
            },
          },
        },
      });
      return row;
    });
    return reply.send({ ...updated, isOwner });
  });

  app.post(
    "/transfer-ownership",
    { preHandler: [authMiddleware, requireOwner()] },
    async (request, reply) => {
      const parsed = transferOwnershipSchema.safeParse(request.body);
      if (!parsed.success) return badRequest(reply, "New owner and current password are required");
      const currentOwner = await prisma.user.findUnique({
        where: { id: request.user!.sub },
        select: { passwordHash: true },
      });
      if (!currentOwner || !(await verifyPassword(parsed.data.currentPassword, currentOwner.passwordHash))) {
        return reply.code(403).send({ error: "Forbidden", message: "Current password is incorrect" });
      }
      const target = await prisma.user.findFirst({
        where: {
          id: parsed.data.newOwnerUserId,
          companyId: request.user!.companyId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!target) return badRequest(reply, "The new owner must be an active user in this company");
      if (target.id === request.user!.sub) return badRequest(reply, "This user is already the company owner");
      await prisma.$transaction([
        prisma.company.update({
          where: { id: request.user!.companyId },
          data: { ownerUserId: target.id },
        }),
        prisma.auditLog.create({
          data: {
            userId: request.user!.sub,
            companyId: request.user!.companyId,
            action: "company.owner.transfer",
            entityType: "company",
            entityId: request.user!.companyId,
            metadata: { previousOwnerUserId: request.user!.sub, newOwnerUserId: target.id },
          },
        }),
      ]);
      return reply.send({ success: true, ownerUserId: target.id });
    }
  );

  app.delete("/:id", { preHandler: deleteAccess }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const companyId = request.user!.companyId;
    const existing = await prisma.user.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        isActive: true,
        capabilities: true,
        company: { select: { ownerUserId: true } },
      },
    });
    if (!existing) return reply.code(404).send({ error: "User not found" });
    if (existing.company.ownerUserId === id) {
      return badRequest(reply, "Transfer ownership before deleting the company owner");
    }
    if (id === request.user!.sub) return badRequest(reply, "You cannot delete your own account");
    if (
      !request.user!.isOwner &&
      hasCapability(existing, "/settings/access", "manage_access")
    ) {
      return reply.code(403).send({
        error: "Forbidden",
        message: "Only the company owner may delete another access manager",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          isActive: false,
          capabilities: {},
          passwordSetupRequired: false,
          passwordSetupTokenHash: null,
          passwordSetupTokenExpiresAt: null,
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          userId: request.user!.sub,
          companyId,
          action: "user.deactivate",
          entityType: "user",
          entityId: id,
          metadata: { previousCapabilities: existing.capabilities },
        },
      });
    });
    return reply.code(204).send();
  });
}
