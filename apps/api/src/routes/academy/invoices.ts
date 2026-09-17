import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { academyProtect } from "./constants.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability } from "../../middleware/authorization.js";
import * as financeService from "../../services/academy-finance.service.js";
import { AcademyServiceError } from "../../services/academy-student.service.js";

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
  unitAmount: z.union([z.number(), z.string()]),
});

const discountAmountSchema = z.union([z.number(), z.string()]).refine(
  (val) => {
    const n = Number(val);
    return !Number.isNaN(n) && n >= 0;
  },
  { message: "Discount amount cannot be negative" }
);

const createInvoiceSchema = z.object({
  studentId: z.string().min(1),
  enrolmentId: z.string().optional().nullable(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().min(1),
  dueDate: z.string().min(1),
  discountAmount: discountAmountSchema.optional().default(0),
  items: z.array(lineSchema).min(1),
});

const updateInvoiceSchema = z.object({
  studentId: z.string().optional(),
  enrolmentId: z.string().optional().nullable(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  discountAmount: discountAmountSchema.optional(),
  items: z.array(lineSchema).optional(),
});

function decimalJson(v: unknown): string {
  return v != null ? v.toString() : "0";
}

function serializeInvoice(inv: Record<string, unknown>) {
  const base = { ...inv };
  for (const k of ["subtotal", "discountAmount", "totalAmount"] as const) {
    const v = base[k];
    if (v instanceof Prisma.Decimal || (v && typeof v === "object" && "toFixed" in v)) {
      base[k] = decimalJson(v);
    }
  }
  return base;
}

function serializeInvoiceWithLines(
  inv: { items?: Array<{ unitAmount: Prisma.Decimal | unknown; lineTotal: Prisma.Decimal | unknown }> } & Record<
    string,
    unknown
  >
) {
  const base = serializeInvoice(inv);
  return {
    ...base,
    items: (inv.items ?? []).map((it) => ({
      ...it,
      unitAmount: decimalJson(it.unitAmount),
      lineTotal: decimalJson(it.lineTotal),
    })),
  };
}

export async function academyInvoicesRoutes(app: FastifyInstance) {
  const editProtect = [authMiddleware, requireCapability("/academy", "edit")];
  const approveProtect = [authMiddleware, requireCapability("/academy", "approve")];

  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;

    const res = await financeService.listInvoices({
      companyId,
      studentId: q.studentId,
      enrolmentId: q.enrolmentId,
      status: q.status as any,
      limit: Number(q.limit) || 100,
      offset: Number(q.offset) || 0,
    });

    return {
      invoices: res.invoices.map((inv) => ({
        ...serializeInvoiceWithLines(inv as any),
        student: (inv as any).student,
        _count: (inv as any)._count,
      })),
      total: res.total,
      limit: res.limit,
      offset: res.offset,
    };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const body = createInvoiceSchema.safeParse(request.body);
    if (!body.success) {
      const flattened = body.error.flatten();
      const firstError =
        Object.values(flattened.fieldErrors).flat()[0] ||
        flattened.formErrors[0] ||
        "Validation failed";
      return reply.code(400).send({
        error: "Validation error",
        message: firstError,
        statusCode: 400,
        details: flattened,
      });
    }

    try {
      const invoice = await financeService.createInvoice(companyId, userId, body.data);
      return reply.code(201).send({ invoice: serializeInvoiceWithLines(invoice as any) });
    } catch (err) {
      if (err instanceof AcademyServiceError) {
        return reply.code(err.statusCode).send({
          error: err.error,
          message: err.message,
          statusCode: err.statusCode,
          ...(err.details !== undefined ? { details: err.details } : {}),
        });
      }
      throw err;
    }
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };

    const invoice = await financeService.getInvoiceById(companyId, id);
    if (!invoice) {
      return reply.code(404).send({
        error: "Not found",
        message: "Invoice not found",
        statusCode: 404,
      });
    }

    const raw = invoice as any;
    return {
      invoice: {
        ...serializeInvoiceWithLines(raw),
        student: raw.student,
        enrolment: raw.enrolment,
        payments: (raw.payments ?? []).map((p: any) => ({
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
      const flattened = body.error.flatten();
      const firstError =
        Object.values(flattened.fieldErrors).flat()[0] ||
        flattened.formErrors[0] ||
        "Validation failed";
      return reply.code(400).send({
        error: "Validation error",
        message: firstError,
        statusCode: 400,
        details: flattened,
      });
    }

    try {
      const invoice = await financeService.updateInvoice(companyId, userId, id, body.data);
      return { invoice: serializeInvoiceWithLines(invoice as any) };
    } catch (err) {
      if (err instanceof AcademyServiceError) {
        return reply.code(err.statusCode).send({
          error: err.error,
          message: err.message,
          statusCode: err.statusCode,
          ...(err.details !== undefined ? { details: err.details } : {}),
        });
      }
      throw err;
    }
  });

  app.post("/:id/issue", { preHandler: approveProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    try {
      const invoice = await financeService.issueInvoice(companyId, userId, id);
      return { invoice: serializeInvoiceWithLines(invoice as any) };
    } catch (err) {
      if (err instanceof AcademyServiceError) {
        return reply.code(err.statusCode).send({
          error: err.error,
          message: err.message,
          statusCode: err.statusCode,
        });
      }
      throw err;
    }
  });

  app.post("/:id/cancel", { preHandler: editProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    try {
      const invoice = await financeService.cancelInvoice(companyId, userId, id);
      return { invoice: serializeInvoiceWithLines(invoice as any) };
    } catch (err) {
      if (err instanceof AcademyServiceError) {
        return reply.code(err.statusCode).send({
          error: err.error,
          message: err.message,
          statusCode: err.statusCode,
        });
      }
      throw err;
    }
  });
}
