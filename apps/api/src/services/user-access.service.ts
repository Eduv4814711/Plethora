import { prisma } from "../lib/prisma.js";
import type { AdminClass } from "@prisma/client";
import { ALL_PERMISSIONS, permissionsForPreset, PRESET_KEYS } from "../lib/permissions.js";
import { revokeAllUserRefreshTokens } from "../services/refresh-token.service.js";
import { createAuditLog } from "../lib/audit.js";

export interface UserAccessRecord {
  userId: string;
  companyId: string;
  accessVersion: number;
  adminClass: AdminClass;
  isSystemOwner: boolean;
  permissions: Set<string>;
  scopes: Map<string, Array<{ type: "COMPANY" | "SITE"; id: string | null }>>;
  mfaRequired?: boolean;
  mfaEnabled?: boolean;
  disabledAt?: Date | null;
}

export class LastSystemOwnerError extends Error {
  constructor(message = "Cannot demote or remove the last system owner for this company") {
    super(message);
    this.name = "LastSystemOwnerError";
  }
}

export class SystemOwnerNotFoundError extends Error {
  constructor(message = "User not found") {
    super(message);
    this.name = "SystemOwnerNotFoundError";
  }
}

export class SystemOwnerForbiddenError extends Error {
  constructor(message = "Only a system owner in the same company can change ownership") {
    super(message);
    this.name = "SystemOwnerForbiddenError";
  }
}

const cache = new Map<string, { record: UserAccessRecord; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

function cacheKey(userId: string, accessVersion: number): string {
  return `${userId}:${accessVersion}`;
}

export function clearUserAccessCache(userId?: string): void {
  if (!userId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}

export async function loadUserAccess(userId: string): Promise<UserAccessRecord | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      companyId: true,
      accessVersion: true,
      adminClass: true,
      isSystemOwner: true,
      disabledAt: true,
      mfaRequired: true,
      mfaEnabled: true,
      permissions: {
        where: {
          status: "ACTIVE",
          validFrom: { lte: new Date() },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { permission: true, scopeType: true, scopeId: true },
      },
    },
  });
  if (!user) return null;

  const permissions = user.isSystemOwner
    ? new Set<string>(ALL_PERMISSIONS)
    : new Set(user.permissions.map((p) => p.permission));
  const scopes = new Map<string, Array<{ type: "COMPANY" | "SITE"; id: string | null }>>();
  for (const grant of user.permissions) {
    const current = scopes.get(grant.permission) ?? [];
    current.push({ type: grant.scopeType, id: grant.scopeId });
    scopes.set(grant.permission, current);
  }

  return {
    userId: user.id,
    companyId: user.companyId,
    accessVersion: user.accessVersion,
    adminClass: user.adminClass,
    isSystemOwner: user.isSystemOwner,
    permissions,
    scopes,
    mfaRequired: user.mfaRequired,
    mfaEnabled: user.mfaEnabled,
    disabledAt: user.disabledAt,
  };
}

export async function getUserAccessCached(userId: string, accessVersion: number): Promise<UserAccessRecord | null> {
  const key = cacheKey(userId, accessVersion);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.record;

  const record = await loadUserAccess(userId);
  if (!record) return null;
  if (record.accessVersion !== accessVersion) return record;

  cache.set(key, { record, expiresAt: now + CACHE_TTL_MS });
  return record;
}

export async function countSystemOwners(companyId: string): Promise<number> {
  return prisma.user.count({
    where: { companyId, isSystemOwner: true, disabledAt: null },
  });
}

async function assertSameCompanySystemOwnerActor(
  actorUserId: string,
  targetUserId: string
): Promise<{ targetCompanyId: string; targetIsSystemOwner: boolean }> {
  const [actor, target] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, companyId: true, adminClass: true, isSystemOwner: true },
    }),
    prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, companyId: true, adminClass: true, isSystemOwner: true },
    }),
  ]);
  if (!target) {
    throw new SystemOwnerNotFoundError();
  }
  if (!actor || !actor.isSystemOwner || actor.companyId !== target.companyId) {
    throw new SystemOwnerForbiddenError();
  }
  return { targetCompanyId: target.companyId, targetIsSystemOwner: target.isSystemOwner };
}

/**
 * Replace a non-owner user's permission rows. Never clears `isSystemOwner`.
 * For system owners: leaves ownership intact and only bumps accessVersion
 * (owners resolve to ALL_PERMISSIONS in loadUserAccess regardless of rows).
 */
export async function setUserPermissions(
  userId: string,
  permissions: string[],
  opts?: {
    auditUserId?: string;
    approvedById?: string;
    approvalRequestId?: string;
    reason?: string;
  }
): Promise<UserAccessRecord> {
  const unique = [...new Set(permissions)];

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, companyId: true, adminClass: true, isSystemOwner: true },
  });
  if (!existing) {
    throw new SystemOwnerNotFoundError(`User ${userId} not found`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.userPermission.updateMany({
      where: { userId, permission: { notIn: unique }, status: "ACTIVE" },
      data: { status: "REVOKED" },
    });
    for (const permission of unique) {
      await tx.userPermission.upsert({
        where: { userId_permission_scopeKey: { userId, permission, scopeKey: "company" } },
        create: {
          userId,
          permission,
          reason: opts?.reason ?? "Access approved",
          requestedById: opts?.auditUserId,
          approvedById: opts?.approvedById,
          approvalRequestId: opts?.approvalRequestId,
        },
        update: {
          status: "ACTIVE",
          validFrom: new Date(),
          expiresAt: null,
          reason: opts?.reason ?? "Access approved",
          requestedById: opts?.auditUserId,
          approvedById: opts?.approvedById,
          approvalRequestId: opts?.approvalRequestId,
        },
      });
    }
    return tx.user.update({
      where: { id: userId },
      data: {
        accessVersion: { increment: 1 },
      },
      select: {
        id: true,
        companyId: true,
        accessVersion: true,
        adminClass: true,
        isSystemOwner: true,
        permissions: { where: { status: "ACTIVE" }, select: { permission: true } },
      },
    });
  });

  await revokeAllUserRefreshTokens(userId);
  clearUserAccessCache(userId);

  if (opts?.auditUserId) {
    await createAuditLog({
      userId: opts.approvedById ?? opts.auditUserId,
      companyId: existing.companyId,
      action: "access.permissions.changed",
      entityType: "user",
      entityId: userId,
      reason: opts.reason,
      approvalRequestId: opts.approvalRequestId,
      riskLevel: "HIGH",
      afterState: { permissions: unique },
      metadata: { requestedById: opts.auditUserId, approvedById: opts.approvedById },
    });
  }

  return {
    userId: updated.id,
    companyId: updated.companyId,
    accessVersion: updated.accessVersion,
    adminClass: updated.adminClass,
    isSystemOwner: updated.isSystemOwner,
    permissions: new Set(updated.permissions.map((p) => p.permission)),
    scopes: new Map(),
  };
}

export async function applyPresetToUser(userId: string, presetPermissions: string[]): Promise<UserAccessRecord> {
  return setUserPermissions(userId, presetPermissions);
}

export interface PermissionGrantInput {
  permission: string;
  scopeType?: "COMPANY" | "SITE";
  scopeId?: string | null;
  expiresAt?: Date | null;
  emergencyAccess?: boolean;
}

/** Apply an independently approved set of per-user grants and invalidate all sessions. */
export async function applyApprovedPermissionGrants(params: {
  userId: string;
  grants: PermissionGrantInput[];
  requestedById: string;
  approvedById: string;
  approvalRequestId: string;
  reason: string;
}): Promise<UserAccessRecord> {
  if (params.requestedById === params.approvedById) {
    throw new Error("The requester cannot approve their own access change");
  }
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, companyId: true, adminClass: true, isSystemOwner: true },
  });
  if (!user) throw new SystemOwnerNotFoundError(`User ${params.userId} not found`);
  if (user.adminClass === "ROOT_ADMIN") throw new Error("Root administrators cannot receive tenant permission grants");

  const normalized = [...new Map(params.grants.map((grant) => {
    const scopeType = grant.scopeType ?? "COMPANY";
    const scopeId = scopeType === "SITE" ? grant.scopeId ?? null : null;
    const scopeKey = scopeType === "SITE" ? `site:${scopeId}` : "company";
    return [`${grant.permission}:${scopeKey}`, { ...grant, scopeType, scopeId, scopeKey }];
  })).values()];

  await prisma.$transaction(async (tx) => {
    await tx.userPermission.updateMany({
      where: { userId: params.userId, status: "ACTIVE" },
      data: { status: "REVOKED" },
    });
    for (const grant of normalized) {
      await tx.userPermission.upsert({
        where: {
          userId_permission_scopeKey: {
            userId: params.userId,
            permission: grant.permission,
            scopeKey: grant.scopeKey,
          },
        },
        create: {
          userId: params.userId,
          permission: grant.permission,
          scopeType: grant.scopeType,
          scopeId: grant.scopeId,
          scopeKey: grant.scopeKey,
          expiresAt: grant.expiresAt,
          emergencyAccess: grant.emergencyAccess ?? false,
          reason: params.reason,
          requestedById: params.requestedById,
          approvedById: params.approvedById,
          approvalRequestId: params.approvalRequestId,
        },
        update: {
          status: "ACTIVE",
          validFrom: new Date(),
          expiresAt: grant.expiresAt,
          emergencyAccess: grant.emergencyAccess ?? false,
          reason: params.reason,
          requestedById: params.requestedById,
          approvedById: params.approvedById,
          approvalRequestId: params.approvalRequestId,
        },
      });
    }
    await tx.user.update({
      where: { id: params.userId },
      data: {
        accessVersion: { increment: 1 },
        mfaRequired: false,
      },
    });
  });

  await revokeAllUserRefreshTokens(params.userId);
  clearUserAccessCache(params.userId);
  await createAuditLog({
    userId: params.approvedById,
    companyId: user.companyId,
    action: "access.permissions.changed",
    entityType: "user",
    entityId: params.userId,
    reason: params.reason,
    approvalRequestId: params.approvalRequestId,
    riskLevel: "HIGH",
    metadata: { requestedById: params.requestedById, grantCount: normalized.length },
    afterState: {
      grants: normalized.map(({ permission, scopeType, scopeId, expiresAt, emergencyAccess }) => ({
        permission,
        scopeType,
        scopeId,
        expiresAt: expiresAt?.toISOString() ?? null,
        emergencyAccess: emergencyAccess ?? false,
      })),
    },
  });
  const access = await loadUserAccess(params.userId);
  if (!access) throw new SystemOwnerNotFoundError(`User ${params.userId} not found`);
  return access;
}

/** Root-only recovery path. The caller must authenticate and audit the root action. */
export async function applyRootRecoveryPermissionGrants(params: {
  userId: string;
  grants: PermissionGrantInput[];
  rootUserId: string;
  reason: string;
}): Promise<UserAccessRecord> {
  const target = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, companyId: true, adminClass: true },
  });
  if (!target) throw new SystemOwnerNotFoundError(`User ${params.userId} not found`);
  if (target.adminClass === "ROOT_ADMIN") throw new Error("Root administrators cannot receive tenant permissions");

  const normalized = [...new Map(params.grants.map((grant) => {
    const scopeType = grant.scopeType ?? "COMPANY";
    const scopeId = scopeType === "SITE" ? grant.scopeId ?? null : null;
    if (scopeType === "SITE" && !scopeId) throw new Error("A site scope requires a site id");
    const scopeKey = scopeType === "SITE" ? `site:${scopeId}` : "company";
    return [`${grant.permission}:${scopeKey}`, { ...grant, scopeType, scopeId, scopeKey }];
  })).values()];

  await prisma.$transaction(async (tx) => {
    await tx.userPermission.updateMany({ where: { userId: params.userId, status: "ACTIVE" }, data: { status: "REVOKED" } });
    for (const grant of normalized) {
      await tx.userPermission.upsert({
        where: { userId_permission_scopeKey: { userId: params.userId, permission: grant.permission, scopeKey: grant.scopeKey } },
        create: {
          userId: params.userId,
          permission: grant.permission,
          scopeType: grant.scopeType,
          scopeId: grant.scopeId,
          scopeKey: grant.scopeKey,
          expiresAt: grant.expiresAt,
          emergencyAccess: grant.emergencyAccess ?? false,
          reason: params.reason,
          requestedById: params.rootUserId,
          approvedById: params.rootUserId,
        },
        update: {
          status: "ACTIVE",
          validFrom: new Date(),
          expiresAt: grant.expiresAt,
          emergencyAccess: grant.emergencyAccess ?? false,
          reason: params.reason,
          requestedById: params.rootUserId,
          approvedById: params.rootUserId,
        },
      });
    }
    await tx.user.update({
      where: { id: params.userId },
      data: { adminClass: "SYSTEM_ADMIN", isSystemOwner: false, accessVersion: { increment: 1 } },
    });
  });
  await revokeAllUserRefreshTokens(params.userId);
  clearUserAccessCache(params.userId);
  const access = await loadUserAccess(params.userId);
  if (!access) throw new SystemOwnerNotFoundError(`User ${params.userId} not found`);
  return access;
}

export type GrantSystemOwnerOptions = {
  /** When set, actor must be a system owner in the same company as the target. Omit for seed/repair bootstrap. */
  actorUserId?: string;
};

/**
 * Explicit ownership grant. Ordinary permission/preset updates must never call this.
 */
export async function grantSystemOwner(
  targetUserId: string,
  opts?: GrantSystemOwnerOptions
): Promise<UserAccessRecord> {
  if (opts?.actorUserId) {
    await assertSameCompanySystemOwnerActor(opts.actorUserId, targetUserId);
  } else {
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!target) {
      throw new SystemOwnerNotFoundError();
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.userPermission.updateMany({
      where: { userId: targetUserId, status: "ACTIVE" },
      data: { status: "REVOKED" },
    });
    return tx.user.update({
      where: { id: targetUserId },
      data: {
        isSystemOwner: true,
        adminClass: "SYSTEM_ADMIN",
        accessVersion: { increment: 1 },
      },
      select: {
        id: true,
        companyId: true,
        accessVersion: true,
        adminClass: true,
        isSystemOwner: true,
      },
    });
  });

  await revokeAllUserRefreshTokens(targetUserId);
  clearUserAccessCache(targetUserId);

  return {
    userId: updated.id,
    companyId: updated.companyId,
    accessVersion: updated.accessVersion,
    adminClass: updated.adminClass,
    isSystemOwner: true,
    permissions: new Set(),
    scopes: new Map(),
  };
}

export type RevokeSystemOwnerOptions = {
  actorUserId: string;
};

/**
 * Explicit demotion. Refuses if this user is the company's last system owner.
 * Assigns OPERATIONAL_ADMIN permissions after clearing ownership.
 */
export async function revokeSystemOwner(
  targetUserId: string,
  opts: RevokeSystemOwnerOptions
): Promise<UserAccessRecord> {
  const { targetCompanyId, targetIsSystemOwner } = await assertSameCompanySystemOwnerActor(
    opts.actorUserId,
    targetUserId
  );

  if (!targetIsSystemOwner) {
    const access = await loadUserAccess(targetUserId);
    if (!access) throw new SystemOwnerNotFoundError();
    return access;
  }

  const owners = await countSystemOwners(targetCompanyId);
  if (owners <= 1) {
    throw new LastSystemOwnerError();
  }

  const preset = permissionsForPreset(PRESET_KEYS.OPERATIONAL_ADMIN);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.userPermission.updateMany({
      where: { userId: targetUserId, status: "ACTIVE" },
      data: { status: "REVOKED" },
    });
    for (const permission of preset) {
      await tx.userPermission.upsert({
        where: { userId_permission_scopeKey: { userId: targetUserId, permission, scopeKey: "company" } },
        create: { userId: targetUserId, permission, reason: "System owner access revoked" },
        update: {
          status: "ACTIVE",
          validFrom: new Date(),
          expiresAt: null,
          reason: "System owner access revoked",
        },
      });
    }
    return tx.user.update({
      where: { id: targetUserId },
      data: {
        isSystemOwner: false,
        adminClass: "STANDARD",
        accessVersion: { increment: 1 },
      },
      select: {
        id: true,
        companyId: true,
        accessVersion: true,
        adminClass: true,
        isSystemOwner: true,
        permissions: { where: { status: "ACTIVE" }, select: { permission: true } },
      },
    });
  });

  await revokeAllUserRefreshTokens(targetUserId);
  clearUserAccessCache(targetUserId);

  return {
    userId: updated.id,
    companyId: updated.companyId,
    accessVersion: updated.accessVersion,
    adminClass: updated.adminClass,
    isSystemOwner: false,
    permissions: new Set(updated.permissions.map((p) => p.permission)),
    scopes: new Map(),
  };
}

export async function incrementAccessVersion(userId: string): Promise<number> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { accessVersion: { increment: 1 } },
    select: { accessVersion: true },
  });
  await revokeAllUserRefreshTokens(userId);
  clearUserAccessCache(userId);
  return user.accessVersion;
}

export function hasPermission(access: UserAccessRecord | undefined, permission: string): boolean {
  if (!access) return false;
  if (access.isSystemOwner) return true;
  return access.permissions.has(permission);
}

export function hasAnyPermission(access: UserAccessRecord | undefined, permissions: string[]): boolean {
  if (!access) return false;
  if (access.isSystemOwner) return true;
  return permissions.some((p) => access.permissions.has(p));
}
