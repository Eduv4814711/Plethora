import type { FastifyInstance } from "fastify";
import { academyProtect } from "./constants.js";
import * as financeService from "../../services/academy-finance.service.js";

function decimalJson(v: unknown): string {
  return v != null ? v.toString() : "0";
}

export async function academyReceiptsRoutes(app: FastifyInstance) {
  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };

    const receipt = await financeService.getReceiptById(companyId, id);
    if (!receipt) {
      return reply.code(404).send({
        error: "Not found",
        message: "Receipt not found",
        statusCode: 404,
      });
    }

    const raw = receipt as any;
    return {
      receipt: {
        ...raw,
        amount: decimalJson(raw.amount),
        payment: raw.payment
          ? {
              ...raw.payment,
              amount: decimalJson(raw.payment.amount),
              invoice: raw.payment.invoice
                ? {
                    ...raw.payment.invoice,
                    totalAmount: decimalJson(raw.payment.invoice.totalAmount),
                  }
                : null,
            }
          : null,
      },
    };
  });
}
