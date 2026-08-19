import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireCapability, requireOwner } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import {
  CAPABILITY_CATALOG,
  hasCapability,
  resolveEffectiveCapabilities,
  validateCapabilities,
  type CapabilityMap,
} from "../lib/capabilities.js";
import { auditFromRequest } from "../lib/audit.js";
import { toCsv } from "../lib/csv.js";
import { findManyUsersForCompany, findUniqueUserListRow } from "../lib/user-access.js";
import {
  applyUserCreate,
  applyUserDeactivate,
  applyUserUpdate,
  checkPasswordResetAllowed,
  checkUserCreateAllowed,
  checkUserDeactivateAllowed,
  checkUserUpdateAllowed,
  issuePasswordResetToken,
  loadAccessTarget,
  type AccessActor,
  type AccessGuardError,
  type UserUpdatePayload,
} from "../services/user-access.service.js";
import {
  PendingRequestExistsError,
  beforeStateOf,
  submitAccessChangeRequest,
} from "../services/access-change.service.js";
import { verifyPassword } from "../services/auth.service.js";
import { validatePassword, PASSWORD_MIN_LENGTH } from "../lib/password-policy.js";
import { badRequest } from "../lib/api-response.js";
import { buildPasswordSetupLink } from "../lib/setup-link.js";

const capabilitiesSchema = z.record(z.string(), z.array(z.string())).default({});
const accountTypeSchema = z.enum(["staff", "client"]);

function parseCapabilities(raw: unknown):
  | { success: true; data: CapabilityMap }
  | { success: false; message: string } {
  const parsed = capabilitiesSchema.safeParse(raw);
  if (!parsed.success) return { success: false, message: "Capabilities must be a path-to-capability-list object" };
  return validateCapabilities(parsed.data);
}

/** The request's actor in the shape the access guards expect. */
function actorOf(request: FastifyRequest): AccessActor {
  return {
    id: request.user!.sub,
    isOwner: Boolean(request.user!.isOwner),
    isActive: request.user!.isActive !== false,
    capabilities: request.user!.capabilities,
  };
}

function sendGuardError(reply: FastifyReply, guard: AccessGuardError) {
  return guard.status === 400
    ? badRequest(reply, guard.message)
    : reply.code(403).send({ error: "Forbidden", message: guard.message });
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
  /** Optional note to the owner, used only when the change needs approval. */
  requestNote: z.string().trim().max(500).optional(),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().email().optional(),
  accountType: accountTypeSchema.optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  isActive: z.boolean().optional(),
  capabilities: capabilitiesSchema.optional(),
  requestNote: z.string().trim().max(500).optional(),
});

const transferOwnershipSchema = z.object({
  newOwnerUserId: z.string().min(1),
  currentPassword: z.string().min(1),
});

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

  /**
   * Company-wide access matrix for periodic sign-off: every user against every
   * module, with the last login derived from the auth audit trail so accounts
   * that hold access but never sign in are visible.
   */
  app.get("/access-review", { preHandler: viewAccess }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const wantsCsv = (request.query as { format?: string }).format === "csv";

    const [users, company, lastLogins] = await Promise.all([
      prisma.user.findMany({
        where: { companyId },
        select: {
          id: true,
          name: true,
          email: true,
          jobTitle: true,
          accountType: true,
          isActive: true,
          capabilities: true,
          createdAt: true,
        },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      }),
      prisma.company.findUnique({ where: { id: companyId }, select: { ownerUserId: true } }),
      prisma.auditLog.groupBy({
        by: ["userId"],
        where: { companyId, action: "auth.login" },
        _max: { timestamp: true },
      }),
    ]);

    const lastLoginByUser = new Map(
      lastLogins
        .filter((row): row is typeof row & { userId: string } => Boolean(row.userId))
        .map((row) => [row.userId, row._max.timestamp])
    );

    const rows = users.map((user) => {
      const isOwner = company?.ownerUserId === user.id;
      const lastLoginAt = lastLoginByUser.get(user.id) ?? null;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        jobTitle: user.jobTitle,
        accountType: user.accountType,
        isActive: user.isActive,
        isOwner,
        createdAt: user.createdAt,
        lastLoginAt,
        neverLoggedIn: lastLoginAt === null,
        modules: resolveEffectiveCapabilities({
          isOwner,
          isActive: user.isActive,
          capabilities: user.capabilities,
        }),
      };
    });

    if (!wantsCsv) {
      return reply.send({ data: rows, catalog: CAPABILITY_CATALOG, generatedAt: new Date() });
    }

    const headers = [
      "Name",
      "Email",
      "Job title",
      "Account type",
      "Status",
      "Owner",
      "Last login",
      ...CAPABILITY_CATALOG.map((definition) => definition.label),
    ];
    const csvRows = rows.map((row) => [
      row.name,
      row.email,
      row.jobTitle ?? "",
      row.accountType,
      row.isActive ? "active" : "deactivated",
      row.isOwner ? "yes" : "no",
      row.lastLoginAt ? row.lastLoginAt.toISOString() : "never",
      ...CAPABILITY_CATALOG.map((definition) => {
        const granted = row.modules.find((module) => module.path === definition.path)?.granted ?? [];
        return granted.join(" ");
      }),
    ]);

    await auditFromRequest(request, {
      action: "user.access_review.export",
      entityType: "user",
      metadata: { userCount: rows.length, format: "csv" },
    });

    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="access-review-${new Date().toISOString().slice(0, 10)}.csv"`
      )
      .send(toCsv(headers, csvRows));
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
    const guard = checkUserCreateAllowed(actorOf(request), permissions.data);
    if (guard) return sendGuardError(reply, guard);

    const isOwner = Boolean(request.user!.isOwner);
    const inviteMode = parsed.data.sendSetupLink;
    if (!inviteMode && !parsed.data.password) {
      return badRequest(reply, "Password is required when setup link is disabled");
    }
    if (parsed.data.password) {
      const check = validatePassword(parsed.data.password);
      if (!check.valid) return badRequest(reply, check.message ?? "Password does not meet policy");
    }
    const email = parsed.data.email.toLowerCase();

    if (!isOwner) {
      // A proposal is stored until the owner decides, so it must never carry a
      // password: invited accounts set their own once the account exists.
      if (!inviteMode || parsed.data.password) {
        return badRequest(
          reply,
          "New accounts that need owner approval must use the setup-link invite, not a password"
        );
      }
      const clash = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (clash) {
        return reply.code(409).send({ error: "Email already registered", message: "This email is already in use." });
      }
      try {
        const pendingRequest = await submitAccessChangeRequest(request, {
          kind: "CREATE_USER",
          targetUserId: null,
          targetLabel: `${parsed.data.name} (${email})`,
          payload: {
            name: parsed.data.name,
            email,
            accountType: parsed.data.accountType,
            jobTitle: parsed.data.jobTitle || null,
            isActive: parsed.data.isActive,
            capabilities: permissions.data,
            sendSetupLink: true,
          },
          beforeState: beforeStateOf(null),
          requestNote: parsed.data.requestNote,
        });
        return reply.code(202).send({ pending: true, request: pendingRequest });
      } catch (error) {
        if (error instanceof PendingRequestExistsError) {
          return reply.code(409).send({
            error: "Conflict",
            message: error.message,
            existingRequestId: error.existingId,
          });
        }
        throw error;
      }
    }

    try {
      const created = await prisma.$transaction(async (tx) =>
        applyUserCreate(request, tx, {
          companyId: request.user!.companyId,
          payload: {
            name: parsed.data.name,
            email,
            accountType: parsed.data.accountType,
            jobTitle: parsed.data.jobTitle || null,
            isActive: parsed.data.isActive,
            capabilities: permissions.data,
            sendSetupLink: inviteMode,
            password: parsed.data.password,
          },
        })
      );
      return reply.code(201).send({
        ...created.user,
        isOwner: false,
        ...(created.setupToken
          ? { setupLink: buildPasswordSetupLink(request, created.setupToken) }
          : {}),
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

  /**
   * What this person can actually do, computed by the same function the route
   * guards use. Anyone may read their own; reading someone else's needs
   * /settings/access:view.
   */
  app.get("/:id/effective-access", { preHandler: [authMiddleware] }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const isSelf = id === request.user!.sub;
    if (!isSelf && !hasCapability(request.user!, "/settings/access", "view")) {
      return reply.code(403).send({
        error: "Forbidden",
        message: "You do not have permission to view another user's access",
      });
    }
    const target = await prisma.user.findFirst({
      where: { id, companyId: request.user!.companyId },
      select: {
        id: true,
        name: true,
        email: true,
        jobTitle: true,
        accountType: true,
        isActive: true,
        capabilities: true,
        company: { select: { ownerUserId: true } },
      },
    });
    if (!target) return reply.code(404).send({ error: "User not found" });

    const isOwner = target.company.ownerUserId === target.id;
    const modules = resolveEffectiveCapabilities({
      isOwner,
      isActive: target.isActive,
      capabilities: target.capabilities,
    });

    // Recent access-relevant history for this person, so "what can they do",
    // "who asked for it" and "who allowed it" are answered in one place.
    const history = await prisma.auditLog.findMany({
      where: {
        companyId: request.user!.companyId,
        entityType: "user",
        entityId: id,
        action: {
          in: [
            "user.create",
            "user.access.update",
            "user.deactivate",
            "user.access.migrated",
            "user.access.request",
            "user.access.request.approved",
            "user.access.request.declined",
            "user.access.request.cancelled",
          ],
        },
      },
      orderBy: { timestamp: "desc" },
      take: 10,
      select: {
        id: true,
        action: true,
        timestamp: true,
        metadata: true,
        actorLabel: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    return reply.send({
      user: {
        id: target.id,
        name: target.name,
        email: target.email,
        jobTitle: target.jobTitle,
        accountType: target.accountType,
        isActive: target.isActive,
        isOwner,
      },
      modules,
      history,
    });
  });

  app.put("/:id", { preHandler: editAccess }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    }
    const existing = await loadAccessTarget(request.user!.companyId, id);
    if (!existing) return reply.code(404).send({ error: "User not found" });

    const permissions = parsed.data.capabilities === undefined
      ? null
      : parseCapabilities(parsed.data.capabilities);
    if (permissions && !permissions.success) return badRequest(reply, permissions.message);

    const payload: UserUpdatePayload = {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.email !== undefined ? { email: parsed.data.email.toLowerCase() } : {}),
      ...(parsed.data.accountType !== undefined ? { accountType: parsed.data.accountType } : {}),
      ...(parsed.data.jobTitle !== undefined ? { jobTitle: parsed.data.jobTitle || null } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      ...(permissions?.success ? { capabilities: permissions.data } : {}),
    };

    const guard = checkUserUpdateAllowed(actorOf(request), existing, payload);
    if (guard) return sendGuardError(reply, guard);

    if (!request.user!.isOwner) {
      try {
        const pendingRequest = await submitAccessChangeRequest(request, {
          kind: "UPDATE_ACCESS",
          targetUserId: id,
          targetLabel: existing.email,
          payload: payload as Record<string, unknown>,
          beforeState: beforeStateOf(existing),
          requestNote: parsed.data.requestNote,
        });
        return reply.code(202).send({ pending: true, request: pendingRequest });
      } catch (error) {
        if (error instanceof PendingRequestExistsError) {
          return reply.code(409).send({
            error: "Conflict",
            message: error.message,
            existingRequestId: error.existingId,
          });
        }
        throw error;
      }
    }

    const updated = await prisma.$transaction(async (tx) =>
      applyUserUpdate(request, tx, { id, existing, payload })
    );
    return reply.send({ ...updated, isOwner: existing.isOwner });
  });

  /**
   * Hands back a single-use link the person can use to set their own password.
   * Not an access change, so it applies immediately rather than queueing for the
   * owner — a locked-out user should not have to wait on an approval.
   */
  app.post("/:id/password-reset-link", { preHandler: editAccess }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const existing = await loadAccessTarget(request.user!.companyId, id);
    if (!existing) return reply.code(404).send({ error: "User not found" });

    const guard = checkPasswordResetAllowed(actorOf(request), existing);
    if (guard) return sendGuardError(reply, guard);

    const issued = await prisma.$transaction(async (tx) =>
      issuePasswordResetToken(request, tx, { id, targetEmail: existing.email })
    );

    return reply.send({
      email: existing.email,
      setupLink: buildPasswordSetupLink(request, issued.token),
      expiresAt: issued.expiresAt,
    });
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
        select: { id: true, email: true },
      });
      if (!target) return badRequest(reply, "The new owner must be an active user in this company");
      if (target.id === request.user!.sub) return badRequest(reply, "This user is already the company owner");
      await prisma.$transaction(async (tx) => {
        await tx.company.update({
          where: { id: request.user!.companyId },
          data: { ownerUserId: target.id },
        });
        await auditFromRequest(
          request,
          {
            action: "company.owner.transfer",
            entityType: "company",
            entityId: request.user!.companyId,
            metadata: {
              previousOwnerUserId: request.user!.sub,
              previousOwnerEmail: request.user!.email,
              newOwnerUserId: target.id,
              newOwnerEmail: target.email,
            },
          },
          tx
        );
      });
      return reply.send({ success: true, ownerUserId: target.id });
    }
  );

  app.delete("/:id", { preHandler: deleteAccess }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const existing = await loadAccessTarget(request.user!.companyId, id);
    if (!existing) return reply.code(404).send({ error: "User not found" });

    const guard = checkUserDeactivateAllowed(actorOf(request), existing);
    if (guard) return sendGuardError(reply, guard);

    if (!request.user!.isOwner) {
      try {
        const pendingRequest = await submitAccessChangeRequest(request, {
          kind: "DEACTIVATE_USER",
          targetUserId: id,
          targetLabel: existing.email,
          payload: {},
          beforeState: beforeStateOf(existing),
        });
        return reply.code(202).send({ pending: true, request: pendingRequest });
      } catch (error) {
        if (error instanceof PendingRequestExistsError) {
          return reply.code(409).send({
            error: "Conflict",
            message: error.message,
            existingRequestId: error.existingId,
          });
        }
        throw error;
      }
    }

    await prisma.$transaction(async (tx) =>
      applyUserDeactivate(request, tx, { id, existing })
    );
    return reply.code(204).send();
  });
}
