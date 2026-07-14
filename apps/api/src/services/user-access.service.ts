import { prisma } from "../lib/prisma.js";
import { ALL_PERMISSIONS, permissionsForPreset, PRESET_KEYS } from "../lib/permissions.js";
import { revokeAllUserRefreshTokens } from "../services/refresh-token.service.js";

export interface UserAccessRecord {
  userId: string;
  companyId: string;
  accessVersion: number;
  isSystemOwner: boolean;
  permissions: Set<string>;
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
      isSystemOwner: true,
      permissions: { select: { permission: true } },
    },
  });
  if (!user) return null;

  const permissions = user.isSystemOwner
    ? new Set<string>(ALL_PERMISSIONS)
    : new Set(user.permissions.map((p) => p.permission));

  return {
    userId: user.id,
    companyId: user.companyId,
    accessVersion: user.accessVersion,
    isSystemOwner: user.isSystemOwner,
    permissions,
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
    where: { companyId, isSystemOwner: true },
  });
}

async function assertSameCompanySystemOwnerActor(
  actorUserId: string,
  targetUserId: string
): Promise<{ targetCompanyId: string; targetIsSystemOwner: boolean }> {
  const [actor, target] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, companyId: true, isSystemOwner: true },
    }),
    prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, companyId: true, isSystemOwner: true },
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
  _opts?: { auditUserId?: string }
): Promise<UserAccessRecord> {
  const unique = [...new Set(permissions)];

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, companyId: true, isSystemOwner: true },
  });
  if (!existing) {
    throw new SystemOwnerNotFoundError(`User ${userId} not found`);
  }

  if (existing.isSystemOwner) {
    const bumped = await prisma.user.update({
      where: { id: userId },
      data: { accessVersion: { increment: 1 } },
      select: {
        id: true,
        companyId: true,
        accessVersion: true,
        isSystemOwner: true,
      },
    });
    await revokeAllUserRefreshTokens(userId);
    clearUserAccessCache(userId);
    return {
      userId: bumped.id,
      companyId: bumped.companyId,
      accessVersion: bumped.accessVersion,
      isSystemOwner: true,
      permissions: new Set(ALL_PERMISSIONS),
    };
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.userPermission.deleteMany({ where: { userId } });
    if (unique.length > 0) {
      await tx.userPermission.createMany({
        data: unique.map((permission) => ({ userId, permission })),
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
        isSystemOwner: true,
        permissions: { select: { permission: true } },
      },
    });
  });

  await revokeAllUserRefreshTokens(userId);
  clearUserAccessCache(userId);

  return {
    userId: updated.id,
    companyId: updated.companyId,
    accessVersion: updated.accessVersion,
    isSystemOwner: updated.isSystemOwner,
    permissions: new Set(updated.permissions.map((p) => p.permission)),
  };
}

export async function applyPresetToUser(userId: string, presetPermissions: string[]): Promise<UserAccessRecord> {
  return setUserPermissions(userId, presetPermissions);
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
    await tx.userPermission.deleteMany({ where: { userId: targetUserId } });
    return tx.user.update({
      where: { id: targetUserId },
      data: {
        isSystemOwner: true,
        accessVersion: { increment: 1 },
      },
      select: {
        id: true,
        companyId: true,
        accessVersion: true,
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
    isSystemOwner: true,
    permissions: new Set(ALL_PERMISSIONS),
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
    await tx.userPermission.deleteMany({ where: { userId: targetUserId } });
    if (preset.length > 0) {
      await tx.userPermission.createMany({
        data: preset.map((permission) => ({ userId: targetUserId, permission })),
      });
    }
    return tx.user.update({
      where: { id: targetUserId },
      data: {
        isSystemOwner: false,
        accessVersion: { increment: 1 },
      },
      select: {
        id: true,
        companyId: true,
        accessVersion: true,
        isSystemOwner: true,
        permissions: { select: { permission: true } },
      },
    });
  });

  await revokeAllUserRefreshTokens(targetUserId);
  clearUserAccessCache(targetUserId);

  return {
    userId: updated.id,
    companyId: updated.companyId,
    accessVersion: updated.accessVersion,
    isSystemOwner: false,
    permissions: new Set(updated.permissions.map((p) => p.permission)),
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
