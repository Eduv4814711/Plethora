import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole, normalizeModuleAccess } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import {
  findManyUsersForCompany,
  findUniqueUserListRow,
  isMissingModuleAccessColumnError,
  isMissingRoleLabelColumnError,
} from "../lib/user-module-column.js";
import { createAuditLog } from "../lib/audit.js";
import { hashPassword } from "../services/auth.service.js";

const MODULE_ACCESS_MIGRATION_MESSAGE =
  "The database is missing the User.moduleAccess column. From the project root run: npm run db:push. If that fails on duplicate User emails (email unique), run: npm run db:add-module-access — it only adds the moduleAccess column. Later, fix duplicate emails (npm run db:check-email-unique in apps/api) then db:push to align the rest of the schema. DATABASE_URL must be set in apps/api/.env.";

const moduleAccessSchema = z
  .union([z.array(z.string()), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : normalizeModuleAccess(v)));

const roleLabelSchema = z.union([z.string().max(120), z.null()]).optional();

function normalizeRoleLabel(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"]),
  roleLabel: roleLabelSchema,
  moduleAccess: moduleAccessSchema,
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
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
    const passwordHash = await hashPassword(parsed.data.password);

    const baseCreate = {
      companyId,
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      passwordHash,
      role: parsed.data.role,
      roleLabel: normalizeRoleLabel(parsed.data.roleLabel),
    };
    const createData =
      parsed.data.moduleAccess != null && parsed.data.moduleAccess.length > 0
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
        if (!missingModuleAccess && !missingRoleLabel) throw e;
        if (missingModuleAccess && Object.prototype.hasOwnProperty.call(createData, "moduleAccess")) {
          return reply.code(503).send({
            error: "Module access not available",
            message: MODULE_ACCESS_MIGRATION_MESSAGE,
          });
        }
        const fallbackCreate = { ...createData };
        delete (fallbackCreate as { roleLabel?: string | null }).roleLabel;
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

      return reply.code(201).send(user);
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
      updateData.passwordHash = await hashPassword(parsed.data.password);
    }
    if (parsed.data.moduleAccess !== undefined) {
      updateData.moduleAccess =
        parsed.data.moduleAccess === null || parsed.data.moduleAccess.length === 0
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
      if (!missingModuleAccess && !missingRoleLabel) throw e;
      if (missingModuleAccess && Object.prototype.hasOwnProperty.call(updateData, "moduleAccess")) {
        return reply.code(503).send({
          error: "Module access not available",
          message: MODULE_ACCESS_MIGRATION_MESSAGE,
        });
      }
      const softData = { ...updateData };
      delete (softData as { roleLabel?: string | null }).roleLabel;
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
        await tx.taskComment.deleteMany({ where: { userId: id } });
        await tx.taskAttachment.deleteMany({ where: { uploadedById: id } });
        await tx.task.deleteMany({ where: { createdById: id } });
        await tx.auditLog.updateMany({
          where: { userId: id },
          data: { userId: null },
        });
        await tx.user.delete({ where: { id } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        return reply.code(409).send({
          error: "Cannot delete user",
          message: "This account is still linked to other records. Remove those links or contact support.",
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
