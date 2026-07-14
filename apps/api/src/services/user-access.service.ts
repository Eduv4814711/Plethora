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

export async function grantSystemOwner(userId: string): Promise<UserAccessRecord> {
  const updated = await prisma.$transaction(async (tx) => {
    await tx.userPermission.deleteMany({ where: { userId } });
    return tx.user.update({
      where: { id: userId },
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

  await revokeAllUserRefreshTokens(userId);
  clearUserAccessCache(userId);

  return {
    userId: updated.id,
    companyId: updated.companyId,
    accessVersion: updated.accessVersion,
    isSystemOwner: true,
    permissions: new Set(ALL_PERMISSIONS),
  };
}

/**
 * Explicit demotion. Refuses if this user is the company's last system owner.
 * Assigns OPERATIONAL_ADMIN permissions after clearing ownership.
 */
export async function revokeSystemOwner(userId: string, companyId: string): Promise<UserAccessRecord> {
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId },
    select: { id: true, companyId: true, isSystemOwner: true },
  });
  if (!user) {
    throw new SystemOwnerNotFoundError();
  }
  if (!user.isSystemOwner) {
    return (await loadUserAccess(userId))!;
  }

  const owners = await countSystemOwners(companyId);
  if (owners <= 1) {
    throw new LastSystemOwnerError();
  }

  const preset = permissionsForPreset(PRESET_KEYS.OPERATIONAL_ADMIN);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.userPermission.deleteMany({ where: { userId } });
    if (preset.length > 0) {
      await tx.userPermission.createMany({
        data: preset.map((permission) => ({ userId, permission })),
      });
    }
    return tx.user.update({
      where: { id: userId },
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

  await revokeAllUserRefreshTokens(userId);
  clearUserAccessCache(userId);

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
