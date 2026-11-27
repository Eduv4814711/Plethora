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

async function validateLegalCaseCompanyRefs(
  companyId: string,
  refs: { employeeId?: unknown; assignedToId?: unknown }
) {
  if (typeof refs.employeeId === "string" && refs.employeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: refs.employeeId, companyId },
      select: { id: true },
    });
    if (!emp) {
      throw Object.assign(new Error("Referenced employee not found"), { statusCode: 400 });
    }
  }
  if (typeof refs.assignedToId === "string" && refs.assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: { id: refs.assignedToId, companyId },
      select: { id: true },
    });
    if (!assignee) {
      throw Object.assign(new Error("Referenced assigned user not found"), { statusCode: 400 });
    }
  }
}

export async function getLegalCase(companyId: string, id: string) {
  return prisma.complianceLegalCase.findFirst({
    where: { id, companyId },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function createLegalCase(
  companyId: string,
  data: Omit<Prisma.ComplianceLegalCaseUncheckedCreateInput, "companyId">,
  actorUserId?: string
) {
  await validateLegalCaseCompanyRefs(companyId, {
    employeeId: data.employeeId,
    assignedToId: data.assignedToId,
  });
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
  await validateLegalCaseCompanyRefs(companyId, {
    employeeId: data.employeeId,
    assignedToId: data.assignedToId,
  });
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

async function validateRemediationPlanCompanyRefs(
  companyId: string,
  refs: { obligationId?: unknown; ownerUserId?: unknown }
) {
  if (typeof refs.obligationId === "string" && refs.obligationId) {
    const obligation = await prisma.complianceObligation.findFirst({
      where: { id: refs.obligationId, companyId },
      select: { id: true },
    });
    if (!obligation) {
      throw Object.assign(new Error("Referenced compliance obligation not found"), { statusCode: 400 });
    }
  }
  if (typeof refs.ownerUserId === "string" && refs.ownerUserId) {
    const owner = await prisma.user.findFirst({
      where: { id: refs.ownerUserId, companyId },
      select: { id: true },
    });
    if (!owner) {
      throw Object.assign(new Error("Referenced owner user not found"), { statusCode: 400 });
    }
  }
}

export async function createRemediationPlan(
  companyId: string,
  data: Omit<Prisma.ComplianceRemediationPlanUncheckedCreateInput, "companyId">,
  actorUserId?: string
) {
  await validateRemediationPlanCompanyRefs(companyId, {
    obligationId: data.obligationId,
    ownerUserId: data.ownerUserId ?? actorUserId,
  });
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
  await validateRemediationPlanCompanyRefs(companyId, {
    obligationId: data.obligationId,
    ownerUserId: data.ownerUserId,
  });
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
