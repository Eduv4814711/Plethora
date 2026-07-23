import type { Prisma } from "@prisma/client";
import { normalizeCapabilities } from "./capabilities.js";
import { prisma } from "./prisma.js";

const authScalars = {
  id: true,
  name: true,
  email: true,
  passwordHash: true,
  passwordSetupRequired: true,
  passwordSetupTokenHash: true,
  passwordSetupTokenExpiresAt: true,
  passwordSetupTokenConsumedAt: true,
  accountType: true,
  jobTitle: true,
  isActive: true,
  companyId: true,
  capabilities: true,
  company: { select: { ownerUserId: true } },
} as const;

export type UserAuthScalars = Prisma.UserGetPayload<{ select: typeof authScalars }>;

export function findFirstUserAuthScalars(where: Prisma.UserWhereInput) {
  return prisma.user.findFirst({ where, select: authScalars });
}

export function findManyUserAuthScalars(where: Prisma.UserWhereInput) {
  return prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, select: authScalars });
}

export function findUniqueUserAuthScalars(where: Prisma.UserWhereUniqueInput) {
  return prisma.user.findUnique({ where, select: authScalars });
}

const PUBLIC_USER_SELECT = {
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

export async function findUniqueUserListRow(id: string, companyId: string) {
  const row = await prisma.user.findFirst({
    where: { id, companyId },
    select: PUBLIC_USER_SELECT,
  });
  if (!row) return null;
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ownerUserId: true },
  });
  return {
    ...row,
    capabilities: normalizeCapabilities(row.capabilities),
    isOwner: company?.ownerUserId === row.id,
  };
}

export async function findManyUsersForCompany(companyId: string, take: number, skip: number) {
  const [rows, company] = await Promise.all([
    prisma.user.findMany({
      where: { companyId },
      take,
      skip,
      orderBy: { createdAt: "desc" },
      select: PUBLIC_USER_SELECT,
    }),
    prisma.company.findUnique({ where: { id: companyId }, select: { ownerUserId: true } }),
  ]);
  return rows.map((row) => ({
    ...row,
    capabilities: normalizeCapabilities(row.capabilities),
    isOwner: company?.ownerUserId === row.id,
  }));
}

const ME_COMPANY_SELECT = {
  id: true,
  name: true,
  legalName: true,
  address: true,
  phone: true,
  email: true,
  logoUrl: true,
  website: true,
  fax: true,
  settings: true,
  ownerUserId: true,
} as const;

export async function findUniqueUserForMe(sub: string) {
  const row = await prisma.user.findUnique({
    where: { id: sub },
    select: {
      id: true,
      name: true,
      email: true,
      accountType: true,
      jobTitle: true,
      isActive: true,
      companyId: true,
      capabilities: true,
      company: { select: ME_COMPANY_SELECT },
    },
  });
  if (!row) return null;
  const { company, ...user } = row;
  const { ownerUserId, ...publicCompany } = company;
  return {
    ...user,
    capabilities: normalizeCapabilities(user.capabilities),
    isOwner: ownerUserId === user.id,
    company: publicCompany,
  };
}
