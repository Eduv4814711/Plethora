import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability } from "../../middleware/authorization.js";
import { academyProtect } from "./constants.js";
import * as financeService from "../../services/academy-finance.service.js";
import { AcademyServiceError } from "../../services/academy-student.service.js";

function decimalJson(v: unknown): string {
  return v != null ? v.toString() : "0";
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

function serializePayment(p: any) {
  return {
    ...p,
    amount: decimalJson(p.amount),
    invoice: p.invoice
      ? {
          ...p.invoice,
          subtotal: p.invoice.subtotal != null ? decimalJson(p.invoice.subtotal) : undefined,
          discountAmount: p.invoice.discountAmount != null ? decimalJson(p.invoice.discountAmount) : undefined,
          totalAmount: decimalJson(p.invoice.totalAmount),
        }
      : null,
    receipt: p.receipt
      ? {
          ...p.receipt,
          amount: decimalJson(p.receipt.amount),
        }
      : null,
  };
}

export async function academyPaymentsRoutes(app: FastifyInstance) {
  const approveProtect = [
    authMiddleware,
    requireCapability("/academy", "approve"),
  ];

  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;

    const res = await financeService.listPayments({
      companyId,
      invoiceId: q.invoiceId,
      studentId: q.studentId,
      verificationStatus: q.verificationStatus as any,
      limit: Number(q.limit) || 100,
      offset: Number(q.offset) || 0,
    });

    return {
      payments: res.payments.map((p) => serializePayment(p)),
      total: res.total,
      limit: res.limit,
      offset: res.offset,
    };
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };

    const payment = await financeService.getPaymentById(companyId, id);
    if (!payment) {
      return reply.code(404).send({
        error: "Not found",
        message: "Payment not found",
        statusCode: 404,
      });
    }

    return { payment: serializePayment(payment) };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const body = createPaymentSchema.safeParse(request.body);
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
      const payment = await financeService.recordPayment(companyId, userId, body.data);
      return reply.code(201).send({ payment: serializePayment(payment) });
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

  app.post("/:id/verify", { preHandler: approveProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    try {
      const payment = await financeService.verifyPayment(companyId, userId, id);
      return { payment: serializePayment(payment) };
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

  app.post("/:id/reject", { preHandler: approveProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    const body = rejectSchema.safeParse(request.body ?? {});
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
      const payment = await financeService.rejectPayment(companyId, userId, id, body.data.remarks);
      return { payment: serializePayment(payment) };
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
