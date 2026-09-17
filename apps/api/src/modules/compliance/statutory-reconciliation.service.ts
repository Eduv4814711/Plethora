import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import type {
  StatutoryScheme,
  StatutoryPeriodStatus,
  StatutoryPaymentStatus,
  Prisma,
} from "@prisma/client";

export interface ListStatutoryPeriodsFilter {
  scheme?: StatutoryScheme;
  status?: StatutoryPeriodStatus;
  year?: number;
  limit?: number;
  offset?: number;
}

export async function listStatutoryPeriods(
  companyId: string,
  filter: ListStatutoryPeriodsFilter = {}
) {
  const { scheme, status, year, limit = 50, offset = 0 } = filter;

  const where: Prisma.StatutoryPeriodWhereInput = {
    companyId,
    ...(scheme && { scheme }),
    ...(status && { status }),
    ...(year && {
      periodStart: {
        gte: new Date(`${year}-01-01`),
        lte: new Date(`${year}-12-31`),
      },
    }),
  };

  const [items, total] = await Promise.all([
    prisma.statutoryPeriod.findMany({
      where,
      include: {
        payments: {
          orderBy: { paymentDate: "desc" },
          take: 5,
        },
        _count: { select: { payments: true, contributions: true } },
      },
      orderBy: [{ periodStart: "desc" }, { scheme: "asc" }],
      skip: offset,
      take: limit,
    }),
    prisma.statutoryPeriod.count({ where }),
  ]);

  return { items, total, limit, offset };
}

export async function getStatutoryPeriod(companyId: string, id: string) {
  return prisma.statutoryPeriod.findFirst({
    where: { id, companyId },
    include: {
      payments: {
        include: {
          capturedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { paymentDate: "desc" },
      },
      contributions: {
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        },
        take: 100,
      },
    },
  });
}

export async function createStatutoryPeriod(
  companyId: string,
  data: {
    scheme: StatutoryScheme;
    periodStart: Date;
    periodEnd: Date;
    dueDate: Date;
    expectedEmployeeAmount?: number;
    expectedEmployerAmount?: number;
    expectedOtherAmount?: number;
    notes?: string;
    sourcePayrollRunIds?: string[];
  },
  actorUserId?: string
) {
  const expectedEmployee = data.expectedEmployeeAmount ?? 0;
  const expectedEmployer = data.expectedEmployerAmount ?? 0;
  const expectedOther = data.expectedOtherAmount ?? 0;
  const expectedTotal = expectedEmployee + expectedEmployer + expectedOther;

  const period = await prisma.statutoryPeriod.create({
    data: {
      companyId,
      scheme: data.scheme,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      dueDate: data.dueDate,
      expectedEmployeeAmount: expectedEmployee,
      expectedEmployerAmount: expectedEmployer,
      expectedOtherAmount: expectedOther,
      expectedTotal,
      outstandingAmount: expectedTotal,
      notes: data.notes,
      sourcePayrollRunIds: data.sourcePayrollRunIds ? JSON.parse(JSON.stringify(data.sourcePayrollRunIds)) : undefined,
      status: "CALCULATED",
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.statutory_period.created",
    entityType: "StatutoryPeriod",
    entityId: period.id,
    metadata: {
      scheme: period.scheme,
      periodStart: period.periodStart,
      expectedTotal,
    },
  });

  return period;
}

export async function advancePeriodStatus(
  companyId: string,
  id: string,
  data: {
    targetStatus: StatutoryPeriodStatus;
    declaredTotal?: number;
    externalReference?: string;
    notes?: string;
  },
  actorUserId?: string
) {
  const current = await prisma.statutoryPeriod.findFirstOrThrow({
    where: { id, companyId },
  });

  const declared = data.declaredTotal !== undefined ? data.declaredTotal : (current.declaredTotal ? Number(current.declaredTotal) : undefined);
  const expected = Number(current.expectedTotal);
  const paid = Number(current.successfulPaidTotal);

  let variance: number | undefined = undefined;
  let outstanding = Number(current.outstandingAmount);

  if (declared !== undefined) {
    variance = Number((declared - expected).toFixed(2));
    outstanding = Math.max(0, Number((declared - paid).toFixed(2)));
  }

  const isFiling = data.targetStatus === "DECLARED" && !current.filedAt;

  const updated = await prisma.statutoryPeriod.update({
    where: { id, companyId },
    data: {
      status: data.targetStatus,
      ...(declared !== undefined && { declaredTotal: declared }),
      ...(variance !== undefined && { varianceExpectedVsDeclared: variance }),
      outstandingAmount: outstanding,
      ...(data.externalReference && { externalReference: data.externalReference }),
      ...(data.notes && { notes: data.notes }),
      ...(isFiling && { filedAt: new Date() }),
    },
  });

  await createAuditLog({
    userId: actorUserId,
    companyId,
    action: "compliance.statutory_period.status_advanced",
    entityType: "StatutoryPeriod",
    entityId: id,
    metadata: {
      fromStatus: current.status,
      toStatus: data.targetStatus,
      declaredTotal: declared,
      outstandingAmount: outstanding,
    },
  });

  return updated;
}

export async function recordStatutoryPayment(
  companyId: string,
  periodId: string,
  data: {
    amount: number;
    paymentDate: Date;
    status: StatutoryPaymentStatus;
    paymentReference?: string;
    externalReference?: string;
    failureReason?: string;
    proofDocumentId?: string;
  },
  actorUserId: string
) {
  return await prisma.$transaction(async (tx) => {
    const period = await tx.statutoryPeriod.findFirstOrThrow({
      where: { id: periodId, companyId },
    });

    const payment = await tx.statutoryPayment.create({
      data: {
        companyId,
        statutoryPeriodId: periodId,
        amount: data.amount,
        paymentDate: data.paymentDate,
        status: data.status,
        paymentReference: data.paymentReference,
        externalReference: data.externalReference,
        failureReason: data.failureReason,
        proofDocumentId: data.proofDocumentId,
        capturedById: actorUserId,
      },
    });

    // Recompute total successful payments
    const successfulPayments = await tx.statutoryPayment.aggregate({
      where: {
        companyId,
        statutoryPeriodId: periodId,
        status: "SUCCESS",
      },
      _sum: { amount: true },
    });

    const newSuccessfulTotal = Number(successfulPayments._sum.amount ?? 0);
    const targetObligation = period.declaredTotal != null ? Number(period.declaredTotal) : Number(period.expectedTotal);
    const newOutstanding = Math.max(0, Number((targetObligation - newSuccessfulTotal).toFixed(2)));

    let newStatus: StatutoryPeriodStatus = period.status;
    if (newOutstanding <= 0.01 && newSuccessfulTotal > 0) {
      newStatus = "PAID";
    } else if (newSuccessfulTotal > 0 && newOutstanding > 0.01) {
      newStatus = "PARTIALLY_PAID";
    } else if (data.status === "FAILED" && period.status !== "PAID") {
      newStatus = "FAILED";
    }

    const updatedPeriod = await tx.statutoryPeriod.update({
      where: { id: periodId, companyId },
      data: {
        successfulPaidTotal: newSuccessfulTotal,
        outstandingAmount: newOutstanding,
        status: newStatus,
      },
    });

    await createAuditLog(
      {
        userId: actorUserId,
        companyId,
        action: "compliance.statutory_payment.recorded",
        entityType: "StatutoryPayment",
        entityId: payment.id,
        metadata: {
          statutoryPeriodId: periodId,
          amount: data.amount,
          status: data.status,
          newPeriodStatus: newStatus,
          newOutstanding,
        },
      },
      tx
    );

    return { payment, period: updatedPeriod };
  });
}
