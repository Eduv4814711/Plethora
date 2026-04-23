import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { academyProtect } from "./constants.js";

function decimalJson(v: Prisma.Decimal): string {
  return v.toString();
}

export async function academyReceiptsRoutes(app: FastifyInstance) {
  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const receipt = await prisma.academyReceipt.findFirst({
      where: { id, companyId },
      include: {
        payment: {
          include: {
            invoice: { select: { id: true, invoiceNumber: true, totalAmount: true, status: true } },
            student: { select: { id: true, studentNumber: true, firstName: true, lastName: true } },
          },
        },
        issuedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!receipt) {
      return reply.code(404).send({ error: "Not found", message: "Receipt not found" });
    }
    return {
      receipt: {
        ...receipt,
        amount: decimalJson(receipt.amount),
        payment: receipt.payment
          ? {
              ...receipt.payment,
              amount: decimalJson(receipt.payment.amount),
              invoice: receipt.payment.invoice
                ? {
                    ...receipt.payment.invoice,
                    totalAmount: decimalJson(receipt.payment.invoice.totalAmount),
                  }
                : null,
            }
          : null,
      },
    };
  });
}
