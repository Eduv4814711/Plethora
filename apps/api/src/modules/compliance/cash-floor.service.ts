import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { getPayrollReserveSnapshot } from "../../services/payroll-reserve.service.js";
import type { CashCommitmentCategory, CashCommitmentFrequency, Prisma } from "@prisma/client";

export async function listCommitments(companyId: string) {
  return prisma.cashCommitment.findMany({
    where: { companyId },
    orderBy: [{ priority: "desc" }, { amount: "desc" }],
  });
}

export async function createCommitment(
  companyId: string,
  data: {
    name: string;
    category: CashCommitmentCategory;
    amount: number;
    frequency?: CashCommitmentFrequency;
    dueDay?: number;
    protected?: boolean;
    priority?: number;
    active?: boolean;
    supplierOrPayee?: string;
    notes?: string;
  },
  actorUserId?: string
) {
  const commitment = await prisma.cashCommitment.create({
    data: {
      companyId,
      name: data.name,
      category: data.category,
      amount: data.amount,
      frequency: data.frequency ?? "MONTHLY",
      dueDay: data.dueDay,
      protected: data.protected ?? false,
      priority: data.priority ?? 0,
      active: data.active ?? true,
      supplierOrPayee: data.supplierOrPayee,
      notes: data.notes,
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.cash_commitment.created",
    entityType: "CashCommitment",
    entityId: commitment.id,
    metadata: { name: commitment.name, amount: data.amount, category: data.category },
  });

  return commitment;
}

export async function updateCommitment(
  companyId: string,
  id: string,
  data: Prisma.CashCommitmentUncheckedUpdateInput,
  actorUserId?: string
) {
  const commitment = await prisma.cashCommitment.update({
    where: { id, companyId },
    data,
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.cash_commitment.updated",
    entityType: "CashCommitment",
    entityId: id,
    metadata: { ...data },
  });

  return commitment;
}

export async function deleteCommitment(companyId: string, id: string, actorUserId?: string) {
  const commitment = await prisma.cashCommitment.delete({
    where: { id, companyId },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.cash_commitment.deleted",
    entityType: "CashCommitment",
    entityId: id,
    metadata: { name: commitment.name },
  });

  return commitment;
}

export async function recordCashSnapshot(
  companyId: string,
  availableCash: number,
  notes?: string,
  actorUserId?: string
) {
  const snapshot = await prisma.cashPositionSnapshot.create({
    data: {
      companyId,
      availableCash,
      notes,
      capturedById: actorUserId ?? "system",
    },
    include: {
      capturedBy: { select: { id: true, name: true, email: true } },
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.cash_snapshot.recorded",
    entityType: "CashPositionSnapshot",
    entityId: snapshot.id,
    metadata: { availableCash },
  });

  return snapshot;
}

export async function getLatestCashSnapshot(companyId: string) {
  return prisma.cashPositionSnapshot.findFirst({
    where: { companyId },
    orderBy: { capturedAt: "desc" },
    include: {
      capturedBy: { select: { id: true, name: true } },
    },
  });
}

export async function evaluateCashFloor(companyId: string) {
  // 1. Get corrected 1-month payroll cash burden
  const payrollReserve = await getPayrollReserveSnapshot(companyId);
  const monthlyPayrollRequirement = payrollReserve.correctedMonthlyBurden > 0
    ? payrollReserve.correctedMonthlyBurden
    : payrollReserve.oneMonthReserve;

  // 2. Active protected commitments
  const commitments = await prisma.cashCommitment.findMany({
    where: { companyId, active: true },
  });

  // Normalize commitments to monthly amount
  let protectedCommitmentsMonthly = 0;
  let totalCommitmentsMonthly = 0;

  for (const c of commitments) {
    const amt = Number(c.amount);
    let monthlyEquivalent = amt;
    switch (c.frequency) {
      case "WEEKLY":
        monthlyEquivalent = amt * 4.333;
        break;
      case "BIWEEKLY":
        monthlyEquivalent = amt * 2.166;
        break;
      case "QUARTERLY":
        monthlyEquivalent = amt / 3;
        break;
      case "ANNUAL":
        monthlyEquivalent = amt / 12;
        break;
      case "ONCE":
      case "MONTHLY":
      default:
        monthlyEquivalent = amt;
        break;
    }

    totalCommitmentsMonthly += monthlyEquivalent;
    if (c.protected) {
      protectedCommitmentsMonthly += monthlyEquivalent;
    }
  }

  // 3. Outstanding statutory debt currently due or overdue
  const now = new Date();
  const outstandingStatutoryPeriods = await prisma.statutoryPeriod.findMany({
    where: {
      companyId,
      status: { in: ["CALCULATED", "DECLARED", "PARTIALLY_PAID", "OVERDUE", "FAILED"] },
      outstandingAmount: { gt: 0 },
    },
  });

  const totalOutstandingStatutory = outstandingStatutoryPeriods.reduce(
    (sum, p) => sum + Number(p.outstandingAmount),
    0
  );

  // 4. Active remediation plan monthly installments
  const activeRemediations = await prisma.complianceRemediationPlan.findMany({
    where: { companyId, status: "ACTIVE" },
  });

  const monthlyRemediationInstallments = activeRemediations.reduce(
    (sum, r) => sum + Number(r.installmentAmount),
    0
  );

  // 5. Total 30-Day Protected Cash Floor
  // Floor = 1 Month Payroll + Protected Commitments + Outstanding Statutory Due + Remediation Installments
  const protectedCashFloor = Number(
    (
      monthlyPayrollRequirement +
      protectedCommitmentsMonthly +
      totalOutstandingStatutory +
      monthlyRemediationInstallments
    ).toFixed(2)
  );

  // 6. Latest Cash Snapshot
  const latestSnapshot = await getLatestCashSnapshot(companyId);
  const availableCash = latestSnapshot ? Number(latestSnapshot.availableCash) : 0;

  const bufferOrShortfall = Number((availableCash - protectedCashFloor).toFixed(2));
  const isHealthy = bufferOrShortfall >= 0;
  const shortfallRatio = protectedCashFloor > 0 ? (protectedCashFloor - availableCash) / protectedCashFloor : 0;

  let status: "HEALTHY" | "TIGHT" | "CRITICAL_BREACH" = "HEALTHY";
  if (bufferOrShortfall < 0) {
    status = shortfallRatio > 0.15 ? "CRITICAL_BREACH" : "TIGHT";
  }

  const monthlyTotalBurn = monthlyPayrollRequirement + totalCommitmentsMonthly + monthlyRemediationInstallments;
  const runwayMonths = monthlyTotalBurn > 0 ? Number((availableCash / monthlyTotalBurn).toFixed(1)) : 0;

  return {
    protectedCashFloor,
    availableCash,
    bufferOrShortfall,
    status,
    runwayMonths,
    latestSnapshotAt: latestSnapshot?.capturedAt ?? null,
    breakdown: {
      monthlyPayrollRequirement: Number(monthlyPayrollRequirement.toFixed(2)),
      protectedCommitmentsMonthly: Number(protectedCommitmentsMonthly.toFixed(2)),
      totalOutstandingStatutory: Number(totalOutstandingStatutory.toFixed(2)),
      monthlyRemediationInstallments: Number(monthlyRemediationInstallments.toFixed(2)),
      totalCommitmentsMonthly: Number(totalCommitmentsMonthly.toFixed(2)),
    },
    commitmentsCount: commitments.length,
    activeRemediationPlansCount: activeRemediations.length,
  };
}
