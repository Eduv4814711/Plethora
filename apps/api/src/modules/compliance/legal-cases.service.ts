import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import type {
  LegalCaseType,
  LegalCaseStatus,
  ComplianceRiskLevel,
  RemediationPlanStatus,
  Prisma,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// Legal Cases
// ---------------------------------------------------------------------------

export interface ListLegalCasesFilter {
  caseType?: LegalCaseType;
  status?: LegalCaseStatus;
  riskLevel?: ComplianceRiskLevel;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listLegalCases(
  companyId: string,
  filter: ListLegalCasesFilter = {}
) {
  const { caseType, status, riskLevel, search, limit = 50, offset = 0 } = filter;

  const where: Prisma.ComplianceLegalCaseWhereInput = {
    companyId,
    ...(caseType && { caseType }),
    ...(status && { status }),
    ...(riskLevel && { riskLevel }),
    ...(search && {
      OR: [
        { caseNumber: { contains: search, mode: "insensitive" } },
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [items, total] = await Promise.all([
    prisma.complianceLegalCase.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ riskLevel: "desc" }, { nextEventDate: "asc" }, { dateReceived: "desc" }],
      skip: offset,
      take: limit,
    }),
    prisma.complianceLegalCase.count({ where }),
  ]);

  return { items, total, limit, offset };
}

export async function getLegalCase(companyId: string, id: string) {
  return prisma.complianceLegalCase.findFirst({
    where: { id, companyId },
    include: {
      employee: true,
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function createLegalCase(
  companyId: string,
  data: Omit<Prisma.ComplianceLegalCaseUncheckedCreateInput, "companyId">,
  actorUserId?: string
) {
  const legalCase = await prisma.complianceLegalCase.create({
    data: {
      ...data,
      companyId,
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.legal_case.created",
    entityType: "ComplianceLegalCase",
    entityId: legalCase.id,
    metadata: {
      caseNumber: legalCase.caseNumber,
      caseType: legalCase.caseType,
      riskLevel: legalCase.riskLevel,
    },
  });

  return legalCase;
}

export async function updateLegalCase(
  companyId: string,
  id: string,
  data: Prisma.ComplianceLegalCaseUncheckedUpdateInput,
  actorUserId?: string
) {
  const legalCase = await prisma.complianceLegalCase.update({
    where: { id, companyId },
    data,
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.legal_case.updated",
    entityType: "ComplianceLegalCase",
    entityId: id,
    metadata: { ...data },
  });

  return legalCase;
}

export async function closeLegalCase(
  companyId: string,
  id: string,
  outcome: string,
  actorUserId?: string
) {
  const legalCase = await prisma.complianceLegalCase.update({
    where: { id, companyId },
    data: {
      status: "CLOSED",
      outcome,
      closedAt: new Date(),
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.legal_case.closed",
    entityType: "ComplianceLegalCase",
    entityId: id,
    metadata: { outcome },
  });

  return legalCase;
}

// ---------------------------------------------------------------------------
// Remediation Plans (AOD / Payment Arrangements)
// ---------------------------------------------------------------------------

export interface ListRemediationPlansFilter {
  status?: RemediationPlanStatus;
  limit?: number;
  offset?: number;
}

export async function listRemediationPlans(
  companyId: string,
  filter: ListRemediationPlansFilter = {}
) {
  const { status, limit = 50, offset = 0 } = filter;
  const where: Prisma.ComplianceRemediationPlanWhereInput = {
    companyId,
    ...(status && { status }),
  };

  const [items, total] = await Promise.all([
    prisma.complianceRemediationPlan.findMany({
      where,
      include: {
        obligation: { select: { id: true, title: true, type: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ status: "asc" }, { nextPaymentDate: "asc" }],
      skip: offset,
      take: limit,
    }),
    prisma.complianceRemediationPlan.count({ where }),
  ]);

  return { items, total, limit, offset };
}

export async function createRemediationPlan(
  companyId: string,
  data: Omit<Prisma.ComplianceRemediationPlanUncheckedCreateInput, "companyId">,
  actorUserId?: string
) {
  const plan = await prisma.complianceRemediationPlan.create({
    data: {
      ...data,
      companyId,
      ownerUserId: data.ownerUserId ?? actorUserId,
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.remediation_plan.created",
    entityType: "ComplianceRemediationPlan",
    entityId: plan.id,
    metadata: {
      title: plan.title,
      originalBalance: plan.originalBalance,
      currentBalance: plan.currentBalance,
    },
  });

  return plan;
}

export async function updateRemediationPlan(
  companyId: string,
  id: string,
  data: Prisma.ComplianceRemediationPlanUncheckedUpdateInput,
  actorUserId?: string
) {
  const plan = await prisma.complianceRemediationPlan.update({
    where: { id, companyId },
    data,
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.remediation_plan.updated",
    entityType: "ComplianceRemediationPlan",
    entityId: id,
    metadata: { ...data },
  });

  return plan;
}
