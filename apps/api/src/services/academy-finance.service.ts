import { Prisma } from "@prisma/client";
import type { AcademyInvoiceStatus, AcademyEnrolmentFinancialStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/** Start of UTC day for date-only comparisons. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Billed, collected, and outstanding (remaining on active invoices) for dashboard + hub.
 * Mirrors the logic in finance dashboard so figures stay consistent.
 */
export async function getAcademyReceivablesSummary(companyId: string): Promise<{
  totalBilled: Prisma.Decimal;
  totalCollected: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  overdueInvoiceCount: number;
  activeInvoiceCount: number;
}> {
  const today = startOfUtcDay(new Date());

  const activeInvoices = await prisma.academyInvoice.findMany({
    where: {
      companyId,
      status: { notIn: ["draft", "cancelled"] },
    },
    select: {
      id: true,
      totalAmount: true,
      dueDate: true,
    },
  });

  const invoiceIds = activeInvoices.map((i) => i.id);
  const verifiedByInvoice = invoiceIds.length
    ? await prisma.academyPayment.groupBy({
        by: ["invoiceId"],
        where: {
          companyId,
          invoiceId: { in: invoiceIds },
          verificationStatus: "verified",
        },
        _sum: { amount: true },
      })
    : [];

  const paidMap = new Map<string, Prisma.Decimal>();
  for (const row of verifiedByInvoice) {
    paidMap.set(row.invoiceId, row._sum.amount ?? new Prisma.Decimal(0));
  }

  let totalBilled = new Prisma.Decimal(0);
  let totalCollected = new Prisma.Decimal(0);
  let outstanding = new Prisma.Decimal(0);
  let overdueCount = 0;

  for (const inv of activeInvoices) {
    totalBilled = totalBilled.add(inv.totalAmount);
    const paid = paidMap.get(inv.id) ?? new Prisma.Decimal(0);
    totalCollected = totalCollected.add(paid);
    const remaining = inv.totalAmount.sub(paid);
    if (remaining.gt(0)) {
      outstanding = outstanding.add(remaining);
      const due = startOfUtcDay(new Date(inv.dueDate));
      if (due < today) overdueCount += 1;
    }
  }

  return {
    totalBilled,
    totalCollected,
    outstanding,
    overdueInvoiceCount: overdueCount,
    activeInvoiceCount: activeInvoices.length,
  };
}

export async function generateNextInvoiceNumber(companyId: string): Promise<string> {
  const prefix = "INV";
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  const rows = await prisma.academyInvoice.findMany({
    where: { companyId },
    select: { invoiceNumber: true },
  });
  let maxNum = 0;
  for (const r of rows) {
    const m = r.invoiceNumber.match(pattern);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  return `${prefix}-${String(maxNum + 1).padStart(4, "0")}`;
}

export async function generateNextReceiptNumber(companyId: string): Promise<string> {
  const prefix = "REC";
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  const rows = await prisma.academyReceipt.findMany({
    where: { companyId },
    select: { receiptNumber: true },
  });
  let maxNum = 0;
  for (const r of rows) {
    const m = r.receiptNumber.match(pattern);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  return `${prefix}-${String(maxNum + 1).padStart(4, "0")}`;
}

export function computeLineTotal(quantity: number, unitAmount: Prisma.Decimal): Prisma.Decimal {
  return unitAmount.mul(quantity);
}

export function computeInvoiceTotals(
  lines: { quantity: number; unitAmount: Prisma.Decimal; lineTotal: Prisma.Decimal }[],
  discountAmount: Prisma.Decimal
): { subtotal: Prisma.Decimal; totalAmount: Prisma.Decimal } {
  let subtotal = new Prisma.Decimal(0);
  for (const line of lines) {
    subtotal = subtotal.add(line.lineTotal);
  }
  const totalAmount = subtotal.sub(discountAmount);
  return { subtotal, totalAmount };
}

/**
 * Recompute invoice status from verified payments (draft/cancelled unchanged).
 * Call inside a transaction after payment changes.
 */
export async function syncInvoicePaymentStatus(
  tx: Prisma.TransactionClient,
  invoiceId: string
): Promise<AcademyInvoiceStatus> {
  const inv = await tx.academyInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      payments: {
        where: { verificationStatus: "verified" },
      },
    },
  });
  if (!inv) return "draft";
  if (inv.status === "draft" || inv.status === "cancelled") {
    return inv.status;
  }

  let paid = new Prisma.Decimal(0);
  for (const p of inv.payments) {
    paid = paid.add(p.amount);
  }

  const total = inv.totalAmount;
  let next: AcademyInvoiceStatus;
  if (paid.gte(total)) {
    next = "paid";
  } else if (paid.gt(0)) {
    next = "partially_paid";
  } else {
    const due = startOfUtcDay(new Date(inv.dueDate));
    const today = startOfUtcDay(new Date());
    next = due < today ? "overdue" : "issued";
  }

  if (next !== inv.status) {
    await tx.academyInvoice.update({
      where: { id: invoiceId },
      data: { status: next },
    });
  }
  return next;
}

/**
 * Aggregate all non-draft, non-cancelled invoices for an enrolment and set Enrolment.financialStatus.
 */
export async function syncEnrolmentFinancialStatus(
  tx: Prisma.TransactionClient,
  enrolmentId: string,
  companyId: string
): Promise<void> {
  const invoices = await tx.academyInvoice.findMany({
    where: {
      enrolmentId,
      companyId,
      status: { notIn: ["draft", "cancelled"] },
    },
    include: {
      payments: { where: { verificationStatus: "verified" } },
    },
  });

  if (invoices.length === 0) {
    await tx.enrolment.updateMany({
      where: { id: enrolmentId, companyId },
      data: { financialStatus: "unpaid" },
    });
    return;
  }

  let totalDue = new Prisma.Decimal(0);
  let totalPaid = new Prisma.Decimal(0);
  for (const inv of invoices) {
    totalDue = totalDue.add(inv.totalAmount);
    for (const p of inv.payments) {
      totalPaid = totalPaid.add(p.amount);
    }
  }

  let financial: AcademyEnrolmentFinancialStatus = "unpaid";
  if (totalDue.lte(0)) {
    financial = "unpaid";
  } else if (totalPaid.gte(totalDue)) {
    financial = "paid";
  } else if (totalPaid.gt(0)) {
    financial = "partial";
  }

  await tx.enrolment.updateMany({
    where: { id: enrolmentId, companyId },
    data: { financialStatus: financial },
  });
}

export async function afterPaymentMutation(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  companyId: string
): Promise<void> {
  const inv = await tx.academyInvoice.findFirst({
    where: { id: invoiceId, companyId },
    select: { enrolmentId: true },
  });
  await syncInvoicePaymentStatus(tx, invoiceId);
  if (inv?.enrolmentId) {
    await syncEnrolmentFinancialStatus(tx, inv.enrolmentId, companyId);
  }
}
