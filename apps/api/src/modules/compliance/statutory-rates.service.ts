import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import type { StatutoryScheme, Prisma } from "@prisma/client";

// Statutory defaults for South Africa (BCEA / SARS / Department of Employment & Labour)
export const SA_STATUTORY_DEFAULTS: Record<
  StatutoryScheme,
  { employeeRate: number; employerRate: number; earningsCeiling?: number; note: string }
> = {
  PAYE: {
    employeeRate: 0, // Calculated via SARS sliding tax tables
    employerRate: 0,
    note: "SARS progressive individual tax bracket tables",
  },
  UIF: {
    employeeRate: 0.01,
    employerRate: 0.01,
    earningsCeiling: 17712.0, // Monthly statutory ceiling for UIF (R177.12 max employee + employer)
    note: "UIF Act: 1% employee + 1% employer up to R17,712/month ceiling",
  },
  SDL: {
    employeeRate: 0,
    employerRate: 0.01,
    note: "Skills Development Levies Act: 1% of leviable payroll by employer",
  },
  PSSPF: {
    employeeRate: 0.075,
    employerRate: 0.075,
    note: "Private Security Sector Provident Fund standard rules",
  },
  NBCPSS: {
    employeeRate: 0.005,
    employerRate: 0.005,
    note: "National Bargaining Council for Private Security Sector admin levy",
  },
  COIDA: {
    employeeRate: 0,
    employerRate: 0.015, // Security sector average ~1.5% - 2.5% of annual earnings
    earningsCeiling: 568959.0, // Annual maximum earnings threshold
    note: "Compensation for Occupational Injuries and Diseases Act assessment",
  },
  OTHER: {
    employeeRate: 0,
    employerRate: 0,
    note: "Custom employer statutory scheme",
  },
};

export async function listRateConfigs(companyId: string, scheme?: StatutoryScheme) {
  return prisma.statutoryRateConfig.findMany({
    where: {
      companyId,
      ...(scheme && { scheme }),
    },
    include: {
      verifiedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ scheme: "asc" }, { effectiveFrom: "desc" }],
  });
}

export async function getEffectiveRate(
  companyId: string,
  scheme: StatutoryScheme,
  asOfDate: Date = new Date()
) {
  // First check database for company override
  const custom = await prisma.statutoryRateConfig.findFirst({
    where: {
      companyId,
      scheme,
      effectiveFrom: { lte: asOfDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });

  if (custom) {
    return {
      source: "custom" as const,
      configId: custom.id,
      scheme,
      employeeRate: custom.employeeRate ? Number(custom.employeeRate) : 0,
      employerRate: custom.employerRate ? Number(custom.employerRate) : 0,
      earningsCeiling: custom.earningsCeiling ? Number(custom.earningsCeiling) : undefined,
      isProvisional: custom.isProvisional,
      verifiedAt: custom.verifiedAt,
    };
  }

  // Fall back to national statutory default
  const standard = SA_STATUTORY_DEFAULTS[scheme];
  return {
    source: "default" as const,
    configId: null,
    scheme,
    employeeRate: standard.employeeRate,
    employerRate: standard.employerRate,
    earningsCeiling: standard.earningsCeiling,
    isProvisional: false,
    verifiedAt: null,
  };
}

export async function createRateConfig(
  companyId: string,
  data: {
    scheme: StatutoryScheme;
    effectiveFrom: Date;
    effectiveTo?: Date;
    employeeRate?: number;
    employerRate?: number;
    earningsCeiling?: number;
    configuration?: Record<string, unknown>;
    sourceReference?: string;
    isProvisional?: boolean;
  },
  actorUserId?: string
) {
  const config = await prisma.statutoryRateConfig.create({
    data: {
      companyId,
      scheme: data.scheme,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo,
      employeeRate: data.employeeRate,
      employerRate: data.employerRate,
      earningsCeiling: data.earningsCeiling,
      configuration: data.configuration ? JSON.parse(JSON.stringify(data.configuration)) : undefined,
      sourceReference: data.sourceReference,
      isProvisional: data.isProvisional ?? false,
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.rate_config.created",
    entityType: "StatutoryRateConfig",
    entityId: config.id,
    metadata: {
      scheme: config.scheme,
      effectiveFrom: config.effectiveFrom,
      employeeRate: data.employeeRate,
      employerRate: data.employerRate,
    },
  });

  return config;
}

export async function verifyRateConfig(
  companyId: string,
  id: string,
  actorUserId: string
) {
  const config = await prisma.statutoryRateConfig.update({
    where: { id, companyId },
    data: {
      verifiedAt: new Date(),
      verifiedById: actorUserId,
      isProvisional: false,
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.rate_config.verified",
    entityType: "StatutoryRateConfig",
    entityId: id,
    metadata: { verifiedById: actorUserId },
  });

  return config;
}
