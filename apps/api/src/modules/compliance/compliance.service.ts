import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import type {
  ComplianceObligationType,
  ComplianceObligationStatus,
  ComplianceRiskLevel,
  Prisma,
} from "@prisma/client";

export interface ListObligationsFilter {
  type?: ComplianceObligationType;
  status?: ComplianceObligationStatus;
  riskLevel?: ComplianceRiskLevel;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listObligations(
  companyId: string,
  filter: ListObligationsFilter = {}
) {
  const { type, status, riskLevel, search, limit = 50, offset = 0 } = filter;

  const where: Prisma.ComplianceObligationWhereInput = {
    companyId,
    ...(type && { type }),
    ...(status && { status }),
    ...(riskLevel && { riskLevel }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: "insensitive" } },
        { referenceNumber: { contains: search, mode: "insensitive" } },
        { authority: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [items, total] = await Promise.all([
    prisma.complianceObligation.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        verifiedBy: { select: { id: true, name: true, email: true } },
        managementOverride: { select: { id: true, name: true, email: true } },
        remediationPlans: { select: { id: true, title: true, status: true, currentBalance: true } },
      },
      orderBy: [{ riskLevel: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      skip: offset,
      take: limit,
    }),
    prisma.complianceObligation.count({ where }),
  ]);

  return { items, total, limit, offset };
}

export async function getObligation(companyId: string, id: string) {
  return prisma.complianceObligation.findFirst({
    where: { id, companyId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      verifiedBy: { select: { id: true, name: true, email: true } },
      managementOverride: { select: { id: true, name: true, email: true } },
      remediationPlans: true,
    },
  });
}

export async function createObligation(
  companyId: string,
  data: Omit<Prisma.ComplianceObligationUncheckedCreateInput, "companyId">,
  actorUserId?: string
) {
  const obligation = await prisma.complianceObligation.create({
    data: {
      ...data,
      companyId,
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.obligation.created",
    entityType: "ComplianceObligation",
    entityId: obligation.id,
    metadata: {
      type: obligation.type,
      title: obligation.title,
      status: obligation.status,
      riskLevel: obligation.riskLevel,
    },
  });

  return obligation;
}

export async function updateObligation(
  companyId: string,
  id: string,
  data: Prisma.ComplianceObligationUncheckedUpdateInput,
  actorUserId?: string
) {
  const obligation = await prisma.complianceObligation.update({
    where: { id, companyId },
    data,
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.obligation.updated",
    entityType: "ComplianceObligation",
    entityId: obligation.id,
    metadata: { ...data },
  });

  return obligation;
}

export async function markObligationCompliant(
  companyId: string,
  id: string,
  data: { primaryEvidenceDocumentId?: string; notes?: string },
  actorUserId?: string
) {
  const obligation = await prisma.complianceObligation.update({
    where: { id, companyId },
    data: {
      status: "COMPLIANT",
      primaryEvidenceDocumentId: data.primaryEvidenceDocumentId,
      lastVerifiedAt: new Date(),
      verifiedById: actorUserId,
      ...(data.notes && { notes: data.notes }),
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.obligation.verified_compliant",
    entityType: "ComplianceObligation",
    entityId: obligation.id,
    metadata: {
      primaryEvidenceDocumentId: data.primaryEvidenceDocumentId,
      verifiedById: actorUserId,
    },
  });

  return obligation;
}

export async function managementOverrideObligation(
  companyId: string,
  id: string,
  targetStatus: ComplianceObligationStatus,
  reason: string,
  actorUserId?: string
) {
  const obligation = await prisma.complianceObligation.update({
    where: { id, companyId },
    data: {
      status: targetStatus,
      managementOverrideReason: reason,
      managementOverrideById: actorUserId,
      managementOverrideAt: new Date(),
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.obligation.management_override",
    entityType: "ComplianceObligation",
    entityId: obligation.id,
    metadata: {
      targetStatus,
      reason,
      overrideById: actorUserId,
    },
  });

  return obligation;
}

export async function deleteObligation(
  companyId: string,
  id: string,
  actorUserId?: string
) {
  const deleted = await prisma.complianceObligation.delete({
    where: { id, companyId },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.obligation.deleted",
    entityType: "ComplianceObligation",
    entityId: id,
    metadata: { title: deleted.title, type: deleted.type },
  });

  return deleted;
}

// Employment Exit workflows
export interface ListEmploymentExitsFilter {
  terminationStatus?: string;
  employeeId?: string;
  limit?: number;
  offset?: number;
}

export async function listEmploymentExits(
  companyId: string,
  filter: ListEmploymentExitsFilter = {}
) {
  const { terminationStatus, employeeId, limit = 50, offset = 0 } = filter;
  const where: Prisma.EmploymentExitWhereInput = {
    companyId,
    ...(terminationStatus && { terminationStatus }),
    ...(employeeId && { employeeId }),
  };

  const [items, total] = await Promise.all([
    prisma.employmentExit.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        site: { select: { id: true, name: true } },
        newSite: { select: { id: true, name: true } },
        processedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.employmentExit.count({ where }),
  ]);

  return { items, total, limit, offset };
}

export async function getEmploymentExit(companyId: string, id: string) {
  return prisma.employmentExit.findFirst({
    where: { id, companyId },
    include: {
      employee: true,
      site: true,
      newSite: true,
      processedBy: { select: { id: true, name: true } },
    },
  });
}

export async function createEmploymentExit(
  companyId: string,
  data: Omit<Prisma.EmploymentExitUncheckedCreateInput, "companyId">,
  actorUserId?: string
) {
  const exit = await prisma.employmentExit.create({
    data: {
      ...data,
      companyId,
      processedById: actorUserId,
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.exit.created",
    entityType: "EmploymentExit",
    entityId: exit.id,
    metadata: {
      employeeId: exit.employeeId,
      terminationStatus: exit.terminationStatus,
    },
  });

  return exit;
}

export async function updateEmploymentExit(
  companyId: string,
  id: string,
  data: Prisma.EmploymentExitUncheckedUpdateInput,
  actorUserId?: string
) {
  const exit = await prisma.employmentExit.update({
    where: { id, companyId },
    data,
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.exit.updated",
    entityType: "EmploymentExit",
    entityId: exit.id,
    metadata: { ...data },
  });

  return exit;
}

export async function deleteEmploymentExit(
  companyId: string,
  id: string,
  actorUserId?: string
) {
  const exit = await prisma.employmentExit.delete({
    where: { id, companyId },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.exit.deleted",
    entityType: "EmploymentExit",
    entityId: id,
    metadata: { employeeId: exit.employeeId },
  });

  return exit;
}
