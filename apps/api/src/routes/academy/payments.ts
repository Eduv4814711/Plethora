import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability } from "../../middleware/authorization.js";
import { academyProtect } from "./constants.js";
import {
  generateNextReceiptNumber,
  afterPaymentMutation,
} from "../../services/academy-finance.service.js";

function parseDate(v: string): Date | undefined {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function toDec(v: unknown): Prisma.Decimal {
  if (typeof v === "number") return new Prisma.Decimal(v);
  return new Prisma.Decimal(String(v));
}

function decimalJson(v: Prisma.Decimal): string {
  return v.toString();
}

const createPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  paymentDate: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  paymentMethod: z.string().optional().nullable(),
  referenceNumber: z.string().optional().nullable(),
  proofDocumentId: z.string().optional().nullable(),
});

const rejectSchema = z.object({
  remarks: z.string().optional().nullable(),
});

export async function academyPaymentsRoutes(app: FastifyInstance) {
  const approveProtect = [
    authMiddleware,
    requireCapability("/academy", "approve"),
  ];
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 100, 200);
    const offset = Number(q.offset) || 0;
    const where = {
      companyId,
      ...(q.invoiceId ? { invoiceId: q.invoiceId } : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.verificationStatus ? { verificationStatus: q.verificationStatus as "pending" | "verified" | "rejected" } : {}),
    };
    const [payments, total] = await Promise.all([
      prisma.academyPayment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          invoice: { select: { id: true, invoiceNumber: true, totalAmount: true, status: true } },
          student: { select: { id: true, studentNumber: true, firstName: true, lastName: true } },
          receipt: { select: { id: true, receiptNumber: true } },
        },
      }),
      prisma.academyPayment.count({ where }),
    ]);
    return {
      payments: payments.map((p) => ({
        ...p,
        amount: decimalJson(p.amount),
        invoice: p.invoice
          ? {
              ...p.invoice,
              totalAmount: decimalJson(p.invoice.totalAmount),
            }
          : null,
      })),
      total,
      limit,
      offset,
    };
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const payment = await prisma.academyPayment.findFirst({
      where: { id, companyId },
      include: {
        invoice: true,
        student: { select: { id: true, studentNumber: true, firstName: true, lastName: true } },
        receipt: true,
      },
    });
    if (!payment) {
      return reply.code(404).send({ error: "Not found", message: "Payment not found" });
    }
    return {
      payment: {
        ...payment,
        amount: decimalJson(payment.amount),
        invoice: payment.invoice
          ? {
              ...payment.invoice,
              subtotal: decimalJson(payment.invoice.subtotal),
              discountAmount: decimalJson(payment.invoice.discountAmount),
              totalAmount: decimalJson(payment.invoice.totalAmount),
            }
          : null,
        receipt: payment.receipt
          ? {
              ...payment.receipt,
              amount: decimalJson(payment.receipt.amount),
            }
          : null,
      },
    };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const body = createPaymentSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const d = body.data;
    const paymentDate = parseDate(d.paymentDate);
    if (!paymentDate) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid paymentDate" });
    }
    const amount = toDec(d.amount);
    if (amount.lte(0)) {
      return reply.code(400).send({ error: "Validation error", message: "Amount must be positive" });
    }

    const invoice = await prisma.academyInvoice.findFirst({
      where: { id: d.invoiceId, companyId },
    });
    if (!invoice) {
      return reply.code(400).send({ error: "Validation error", message: "invoiceId not found" });
    }
    if (invoice.status === "draft" || invoice.status === "cancelled") {
      return reply.code(409).send({
        error: "Conflict",
        message: "Cannot record payments against draft or cancelled invoices",
      });
    }

    const studentId = invoice.studentId;

    if (d.proofDocumentId) {
      const doc = await prisma.studentDocument.findFirst({
        where: {
          id: d.proofDocumentId,
          companyId,
          studentId,
          deletedAt: null,
        },
      });
      if (!doc) {
        return reply.code(400).send({ error: "Validation error", message: "proofDocumentId not found" });
      }
    }

    const payment = await prisma.academyPayment.create({
      data: {
        companyId,
        invoiceId: d.invoiceId,
        studentId,
        paymentDate,
        amount,
        paymentMethod: d.paymentMethod ?? undefined,
        referenceNumber: d.referenceNumber ?? undefined,
        proofDocumentId: d.proofDocumentId ?? undefined,
        verificationStatus: "pending",
      },
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.payment.create",
      entityType: "AcademyPayment",
      entityId: payment.id,
      metadata: { invoiceId: d.invoiceId, amount: decimalJson(amount) },
    });

    return reply.code(201).send({
      payment: { ...payment, amount: decimalJson(payment.amount) },
    });
  });

  app.post("/:id/verify", { preHandler: approveProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    const existing = await prisma.academyPayment.findFirst({
      where: { id, companyId },
      include: { receipt: true },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Payment not found" });
    }
    if (existing.verificationStatus !== "pending") {
      return reply.code(409).send({ error: "Conflict", message: "Payment is not pending verification" });
    }
    if (existing.receipt) {
      return reply.code(409).send({ error: "Conflict", message: "Receipt already exists" });
    }

    const receiptNumber = await generateNextReceiptNumber(companyId);
    const receiptDate = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.academyPayment.update({
        where: { id },
        data: {
          verificationStatus: "verified",
          verifiedByUserId: userId,
          verifiedAt: new Date(),
          rejectionRemarks: null,
        },
      });
      await tx.academyReceipt.create({
        data: {
          companyId,
          paymentId: id,
          receiptNumber,
          receiptDate,
          amount: existing.amount,
          issuedByUserId: userId,
        },
      });
      await afterPaymentMutation(tx, existing.invoiceId, companyId);
    });

    const payment = await prisma.academyPayment.findFirstOrThrow({
      where: { id, companyId },
      include: { receipt: true },
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.payment.verify",
      entityType: "AcademyPayment",
      entityId: id,
      metadata: { receiptNumber, amount: decimalJson(existing.amount) },
    });

    return {
      payment: {
        ...payment,
        amount: decimalJson(payment.amount),
        receipt: payment.receipt
          ? { ...payment.receipt, amount: decimalJson(payment.receipt.amount) }
          : null,
      },
    };
  });

  app.post("/:id/reject", { preHandler: approveProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const body = rejectSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }

    const existing = await prisma.academyPayment.findFirst({
      where: { id, companyId },
      include: { receipt: true },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Payment not found" });
    }
    if (existing.verificationStatus !== "pending") {
      return reply.code(409).send({ error: "Conflict", message: "Payment is not pending verification" });
    }
    if (existing.receipt) {
      return reply.code(409).send({ error: "Conflict", message: "Cannot reject a verified payment" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.academyPayment.update({
        where: { id },
        data: {
          verificationStatus: "rejected",
          verifiedByUserId: userId,
          verifiedAt: new Date(),
          rejectionRemarks: body.data.remarks ?? undefined,
        },
      });
      await afterPaymentMutation(tx, existing.invoiceId, companyId);
    });

    const payment = await prisma.academyPayment.findFirstOrThrow({ where: { id, companyId } });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.payment.reject",
      entityType: "AcademyPayment",
      entityId: id,
      metadata: { remarks: body.data.remarks },
    });

    return { payment: { ...payment, amount: decimalJson(payment.amount) } };
  });
}
