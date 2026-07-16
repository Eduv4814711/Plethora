import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

/** Prisma/Postgres error when `User.moduleAccess` was never migrated. */
export function isMissingModuleAccessColumnError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /moduleAccess/i.test(msg) && /does not exist|Unknown column|not available/i.test(msg);
}

/** Prisma/Postgres error when `User.roleLabel` was never migrated. */
export function isMissingRoleLabelColumnError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /roleLabel/i.test(msg) && /does not exist|Unknown column|Unknown field|Unknown argument|not available/i.test(msg);
}

/** Prisma/Postgres error when password setup link columns were never migrated. */
export function isMissingPasswordSetupColumnError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /passwordSetup/i.test(msg) && /does not exist|Unknown column|Unknown field|Unknown argument|not available/i.test(msg);
}

const authScalarsBase = {
  id: true,
  name: true,
  email: true,
  passwordHash: true,
  passwordSetupRequired: true,
  passwordSetupTokenHash: true,
  passwordSetupTokenExpiresAt: true,
  passwordSetupTokenConsumedAt: true,
  role: true,
  roleLabel: true,
  companyId: true,
} as const;

const authScalarsLegacyBase = {
  id: true,
  name: true,
  email: true,
  passwordHash: true,
  role: true,
  companyId: true,
} as const;

const authScalarsWithModule = {
  ...authScalarsBase,
  moduleAccess: true,
} as const;

export type UserAuthScalars = Prisma.UserGetPayload<{
  select: typeof authScalarsWithModule;
}>;

export async function findFirstUserAuthScalars(
  where: Prisma.UserWhereInput
): Promise<UserAuthScalars | null> {
  try {
    return await prisma.user.findFirst({ where, select: authScalarsWithModule });
  } catch (e) {
    if (
      !isMissingModuleAccessColumnError(e) &&
      !isMissingRoleLabelColumnError(e) &&
      !isMissingPasswordSetupColumnError(e)
    ) {
      throw e;
    }
    try {
      const row = await prisma.user.findFirst({ where, select: authScalarsBase });
      return row ? { ...row, moduleAccess: null } : null;
    } catch (fallbackErr) {
      if (!isMissingRoleLabelColumnError(fallbackErr) && !isMissingPasswordSetupColumnError(fallbackErr)) {
        throw fallbackErr;
      }
      const legacyRow = await prisma.user.findFirst({ where, select: authScalarsLegacyBase });
      return legacyRow
        ? {
            ...legacyRow,
            passwordSetupRequired: false,
            passwordSetupTokenHash: null,
            passwordSetupTokenExpiresAt: null,
            passwordSetupTokenConsumedAt: null,
            roleLabel: null,
            moduleAccess: null,
          }
        : null;
    }
  }
}

export async function findManyUserAuthScalars(
  where: Prisma.UserWhereInput
): Promise<UserAuthScalars[]> {
  const orderBy = { createdAt: "desc" as const };
  try {
    return await prisma.user.findMany({ where, orderBy, select: authScalarsWithModule });
  } catch (e) {
    if (
      !isMissingModuleAccessColumnError(e) &&
      !isMissingRoleLabelColumnError(e) &&
      !isMissingPasswordSetupColumnError(e)
    ) {
      throw e;
    }
    try {
      const rows = await prisma.user.findMany({ where, orderBy, select: authScalarsBase });
      return rows.map((row) => ({ ...row, moduleAccess: null }));
    } catch (fallbackErr) {
      if (!isMissingRoleLabelColumnError(fallbackErr) && !isMissingPasswordSetupColumnError(fallbackErr)) {
        throw fallbackErr;
      }
      const legacyRows = await prisma.user.findMany({ where, orderBy, select: authScalarsLegacyBase });
      return legacyRows.map((legacyRow) => ({
        ...legacyRow,
        passwordSetupRequired: false,
        passwordSetupTokenHash: null,
        passwordSetupTokenExpiresAt: null,
        passwordSetupTokenConsumedAt: null,
        roleLabel: null,
        moduleAccess: null,
      }));
    }
  }
}

export async function findUniqueUserAuthScalars(
  where: Prisma.UserWhereUniqueInput
): Promise<UserAuthScalars | null> {
  try {
    return await prisma.user.findUnique({ where, select: authScalarsWithModule });
  } catch (e) {
    if (
      !isMissingModuleAccessColumnError(e) &&
      !isMissingRoleLabelColumnError(e) &&
      !isMissingPasswordSetupColumnError(e)
    ) {
      throw e;
    }
    try {
      const row = await prisma.user.findUnique({ where, select: authScalarsBase });
      return row ? { ...row, moduleAccess: null } : null;
    } catch (fallbackErr) {
      if (!isMissingRoleLabelColumnError(fallbackErr) && !isMissingPasswordSetupColumnError(fallbackErr)) {
        throw fallbackErr;
      }
      const legacyRow = await prisma.user.findUnique({ where, select: authScalarsLegacyBase });
      return legacyRow
        ? {
            ...legacyRow,
            passwordSetupRequired: false,
            passwordSetupTokenHash: null,
            passwordSetupTokenExpiresAt: null,
            passwordSetupTokenConsumedAt: null,
            roleLabel: null,
            moduleAccess: null,
          }
        : null;
    }
  }
}

const ME_COMPANY_SELECT = {
  id: true,
  name: true,
  legalName: true,
  registrationNumber: true,
  taxNumber: true,
  address: true,
  phone: true,
  email: true,
  logoUrl: true,
  website: true,
  fax: true,
  psiraRegistration: true,
  uifReference: true,
  settings: true,
} as const;

export async function findUniqueUserListRow(id: string, companyId: string) {
  try {
    return await prisma.user.findFirst({
      where: { id, companyId },
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
    if (
      !isMissingModuleAccessColumnError(e) &&
      !isMissingRoleLabelColumnError(e) &&
      !isMissingPasswordSetupColumnError(e)
    ) {
      throw e;
    }
    const row = await prisma.user.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        createdAt: true,
      },
    });
    return row ? { ...row, roleLabel: null, moduleAccess: null } : null;
  }
}

export async function findManyUsersForCompany(
  companyId: string,
  take: number,
  skip: number
) {
  const base = {
    where: { companyId },
    take,
    skip,
    orderBy: { createdAt: "desc" as const },
  };
  try {
    return await prisma.user.findMany({
      ...base,
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
    if (
      !isMissingModuleAccessColumnError(e) &&
      !isMissingRoleLabelColumnError(e) &&
      !isMissingPasswordSetupColumnError(e)
    ) {
      throw e;
    }
    const rows = await prisma.user.findMany({
      ...base,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({ ...r, roleLabel: null, moduleAccess: null }));
  }
}

export async function findUniqueUserForMe(sub: string) {
  try {
    return await prisma.user.findUnique({
      where: { id: sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        roleLabel: true,
        companyId: true,
        moduleAccess: true,
        company: { select: ME_COMPANY_SELECT },
      },
    });
  } catch (e) {
    if (
      !isMissingModuleAccessColumnError(e) &&
      !isMissingRoleLabelColumnError(e) &&
      !isMissingPasswordSetupColumnError(e)
    ) {
      throw e;
    }
    const row = await prisma.user.findUnique({
      where: { id: sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        companyId: true,
        company: { select: ME_COMPANY_SELECT },
      },
    });
    return row ? { ...row, roleLabel: null, moduleAccess: null } : null;
  }
}
