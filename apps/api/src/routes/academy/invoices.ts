import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability } from "../../middleware/authorization.js";
import {
  computeInvoiceTotals,
  computeLineTotal,
  generateNextInvoiceNumber,
  syncInvoicePaymentStatus,
  syncEnrolmentFinancialStatus,
} from "../../services/academy-finance.service.js";

function parseDate(v: string): Date | undefined {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
  unitAmount: z.union([z.number(), z.string()]),
});

const createInvoiceSchema = z.object({
  studentId: z.string().min(1),
  enrolmentId: z.string().optional().nullable(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().min(1),
  dueDate: z.string().min(1),
  discountAmount: z.union([z.number(), z.string()]).optional().default(0),
  items: z.array(lineSchema).min(1),
});

const updateInvoiceSchema = z.object({
  studentId: z.string().optional(),
  enrolmentId: z.string().optional().nullable(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  discountAmount: z.union([z.number(), z.string()]).optional(),
  items: z.array(lineSchema).optional(),
});

function toDec(v: unknown): Prisma.Decimal {
  if (v == null) return new Prisma.Decimal(0);
  if (typeof v === "number") return new Prisma.Decimal(v);
  return new Prisma.Decimal(String(v));
}

function decimalJson(v: Prisma.Decimal): string {
  return v.toString();
}

function serializeInvoice(inv: Record<string, unknown>) {
  const base = { ...inv };
  for (const k of ["subtotal", "discountAmount", "totalAmount"] as const) {
    const v = base[k];
    if (v instanceof Prisma.Decimal) base[k] = decimalJson(v);
  }
  return base;
}

export async function academyInvoicesRoutes(app: FastifyInstance) {
  const editProtect = [authMiddleware, requireCapability("/academy", "edit")];
  const approveProtect = [authMiddleware, requireCapability("/academy", "approve")];
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 100, 200);
    const offset = Number(q.offset) || 0;
    const where = {
      companyId,
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.enrolmentId ? { enrolmentId: q.enrolmentId } : {}),
      ...(q.status ? { status: q.status as "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "cancelled" } : {}),
    };
    const [invoices, total] = await Promise.all([
      prisma.academyInvoice.findMany({
        where,
        orderBy: { invoiceDate: "desc" },
        take: limit,
        skip: offset,
        include: {
          student: { select: { id: true, studentNumber: true, firstName: true, lastName: true } },
          items: true,
          _count: { select: { payments: true } },
        },
      }),
      prisma.academyInvoice.count({ where }),
    ]);
    return {
      invoices: invoices.map((inv) => ({
        ...serializeInvoice(inv as unknown as Record<string, unknown>),
        student: inv.student,
        items: inv.items.map((it) => ({
          ...it,
          unitAmount: decimalJson(it.unitAmount),
          lineTotal: decimalJson(it.lineTotal),
        })),
        _count: inv._count,
      })),
      total,
      limit,
      offset,
    };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const body = createInvoiceSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const d0 = body.data;
    const invoiceDate = parseDate(d0.invoiceDate);
    const dueDate = parseDate(d0.dueDate);
    if (!invoiceDate || !dueDate) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid invoiceDate or dueDate" });
    }

    const student = await prisma.student.findFirst({
      where: { id: d0.studentId, companyId },
    });
    if (!student) {
      return reply.code(400).send({ error: "Validation error", message: "studentId not found" });
    }
    if (d0.enrolmentId) {
      const enr = await prisma.enrolment.findFirst({
        where: { id: d0.enrolmentId, companyId, studentId: d0.studentId },
      });
      if (!enr) {
        return reply.code(400).send({ error: "Validation error", message: "enrolmentId not valid for student" });
      }
    }

    const discountAmount = toDec(d0.discountAmount);
    const lineRows = d0.items.map((it) => {
      const unitAmount = toDec(it.unitAmount);
      const lineTotal = computeLineTotal(it.quantity, unitAmount);
      return { description: it.description, quantity: it.quantity, unitAmount, lineTotal };
    });
    const { subtotal, totalAmount } = computeInvoiceTotals(lineRows, discountAmount);
    if (totalAmount.lt(0)) {
      return reply.code(400).send({ error: "Validation error", message: "Total cannot be negative" });
    }

    const invoiceNumber = d0.invoiceNumber?.trim() || (await generateNextInvoiceNumber(companyId));

    try {
      const invoice = await prisma.$transaction(async (tx) => {
        const inv = await tx.academyInvoice.create({
          data: {
            companyId,
            studentId: d0.studentId,
            enrolmentId: d0.enrolmentId ?? undefined,
            invoiceNumber,
            invoiceDate,
            dueDate,
            subtotal,
            discountAmount,
            totalAmount,
            status: "draft",
            items: {
              create: lineRows.map((r) => ({
                description: r.description,
                quantity: r.quantity,
                unitAmount: r.unitAmount,
                lineTotal: r.lineTotal,
              })),
            },
          },
          include: { items: true, student: { select: { studentNumber: true, firstName: true, lastName: true } } },
        });
        return inv;
      });

      await createAuditLog({
        userId,
        companyId,
        action: "academy.invoice.create",
        entityType: "AcademyInvoice",
        entityId: invoice.id,
        metadata: { invoiceNumber: invoice.invoiceNumber, totalAmount: decimalJson(invoice.totalAmount) },
      });

      return reply.code(201).send({ invoice: serializeInvoiceWithLines(invoice) });
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Invoice number already exists" });
      }
      throw e;
    }
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const invoice = await prisma.academyInvoice.findFirst({
      where: { id, companyId },
      include: {
        items: true,
        student: true,
        enrolment: {
          include: { courseRun: { include: { course: { select: { code: true, title: true } } } } },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          include: { receipt: true },
        },
      },
    });
    if (!invoice) {
      return reply.code(404).send({ error: "Not found", message: "Invoice not found" });
    }
    return {
      invoice: {
        ...serializeInvoice(invoice as unknown as Record<string, unknown>),
        items: invoice.items.map((it) => ({
          ...it,
          unitAmount: decimalJson(it.unitAmount),
          lineTotal: decimalJson(it.lineTotal),
        })),
        student: invoice.student,
        enrolment: invoice.enrolment,
        payments: invoice.payments.map((p) => ({
          ...p,
          amount: decimalJson(p.amount),
          receipt: p.receipt
            ? { ...p.receipt, amount: decimalJson(p.receipt.amount) }
            : null,
        })),
      },
    };
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const body = updateInvoiceSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }

    const existing = await prisma.academyInvoice.findFirst({ where: { id, companyId } });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Invoice not found" });
    }
    if (existing.status !== "draft") {
      return reply.code(409).send({ error: "Conflict", message: "Only draft invoices can be edited" });
    }

    const d = body.data;
    if (d.studentId) {
      const st = await prisma.student.findFirst({ where: { id: d.studentId, companyId } });
      if (!st) return reply.code(400).send({ error: "Validation error", message: "studentId not found" });
    }
    if (d.enrolmentId) {
      const sid = d.studentId ?? existing.studentId;
      const enr = await prisma.enrolment.findFirst({
        where: { id: d.enrolmentId, companyId, studentId: sid },
      });
      if (!enr) {
        return reply.code(400).send({ error: "Validation error", message: "enrolmentId not valid for student" });
      }
    }

    const invoiceDate = d.invoiceDate != null ? parseDate(d.invoiceDate) : existing.invoiceDate;
    const dueDate = d.dueDate != null ? parseDate(d.dueDate) : existing.dueDate;
    if (!invoiceDate || !dueDate) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid dates" });
    }

    const discountAmount = d.discountAmount != null ? toDec(d.discountAmount) : existing.discountAmount;

    let lineRows: { description: string; quantity: number; unitAmount: Prisma.Decimal; lineTotal: Prisma.Decimal }[];
    if (d.items) {
      lineRows = d.items.map((it) => {
        const unitAmount = toDec(it.unitAmount);
        return {
          description: it.description,
          quantity: it.quantity,
          unitAmount,
          lineTotal: computeLineTotal(it.quantity, unitAmount),
        };
      });
    } else {
      const oldLines = await prisma.academyInvoiceLine.findMany({ where: { invoiceId: id } });
      lineRows = oldLines.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        unitAmount: it.unitAmount,
        lineTotal: it.lineTotal,
      }));
    }

    const { subtotal, totalAmount } = computeInvoiceTotals(lineRows, discountAmount);
    if (totalAmount.lt(0)) {
      return reply.code(400).send({ error: "Validation error", message: "Total cannot be negative" });
    }

    const invoice = await prisma.$transaction(async (tx) => {
      await tx.academyInvoiceLine.deleteMany({ where: { invoiceId: id } });
      return tx.academyInvoice.update({
        where: { id },
        data: {
          ...(d.studentId ? { studentId: d.studentId } : {}),
          ...(d.enrolmentId !== undefined ? { enrolmentId: d.enrolmentId } : {}),
          invoiceDate,
          dueDate,
          subtotal,
          discountAmount,
          totalAmount,
          items: {
            create: lineRows.map((r) => ({
              description: r.description,
              quantity: r.quantity,
              unitAmount: r.unitAmount,
              lineTotal: r.lineTotal,
            })),
          },
        },
        include: { items: true },
      });
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.invoice.update",
      entityType: "AcademyInvoice",
      entityId: invoice.id,
      metadata: { patch: d as Record<string, unknown> },
    });

    return { invoice: serializeInvoiceWithLines(invoice) };
  });

  app.post("/:id/issue", { preHandler: approveProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    const inv = await prisma.academyInvoice.findFirst({ where: { id, companyId } });
    if (!inv) {
      return reply.code(404).send({ error: "Not found", message: "Invoice not found" });
    }
    if (inv.status !== "draft") {
      return reply.code(409).send({ error: "Conflict", message: "Only draft invoices can be issued" });
    }

    const invoice = await prisma.$transaction(async (tx) => {
      await tx.academyInvoice.update({
        where: { id },
        data: { status: "issued" },
      });
      await syncInvoicePaymentStatus(tx, id);
      const out = await tx.academyInvoice.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });
      if (out.enrolmentId) {
        await syncEnrolmentFinancialStatus(tx, out.enrolmentId, companyId);
      }
      return out;
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.invoice.issue",
      entityType: "AcademyInvoice",
      entityId: id,
      metadata: { invoiceNumber: invoice.invoiceNumber },
    });

    return { invoice: serializeInvoiceWithLines(invoice) };
  });

  app.post("/:id/cancel", { preHandler: editProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    const inv = await prisma.academyInvoice.findFirst({
      where: { id, companyId },
      include: { payments: { where: { verificationStatus: "verified" } } },
    });
    if (!inv) {
      return reply.code(404).send({ error: "Not found", message: "Invoice not found" });
    }
    if (inv.status === "cancelled") {
      return reply.code(409).send({ error: "Conflict", message: "Already cancelled" });
    }
    if (inv.payments.length > 0) {
      return reply.code(409).send({
        error: "Conflict",
        message: "Cannot cancel an invoice with verified payments",
      });
    }

    const enrolmentId = inv.enrolmentId;
    const invoice = await prisma.$transaction(async (tx) => {
      const out = await tx.academyInvoice.update({
        where: { id },
        data: { status: "cancelled" },
        include: { items: true },
      });
      if (enrolmentId) {
        await syncEnrolmentFinancialStatus(tx, enrolmentId, companyId);
      }
      return out;
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.invoice.cancel",
      entityType: "AcademyInvoice",
      entityId: id,
      metadata: { invoiceNumber: invoice.invoiceNumber },
    });

    return { invoice: serializeInvoiceWithLines(invoice) };
  });
}

function serializeInvoiceWithLines(inv: { items: Array<{ unitAmount: Prisma.Decimal; lineTotal: Prisma.Decimal }> } & Record<string, unknown>) {
  const base = serializeInvoice(inv);
  return {
    ...base,
    items: inv.items.map((it) => ({
      ...it,
      unitAmount: decimalJson(it.unitAmount),
      lineTotal: decimalJson(it.lineTotal),
    })),
  };
}
