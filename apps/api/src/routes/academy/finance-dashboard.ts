import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { getAcademyReceivablesSummary } from "../../services/academy-finance.service.js";
import { academyProtect } from "./constants.js";

export async function academyFinanceDashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;

    const {
      totalBilled,
      totalCollected,
      outstanding,
      overdueInvoiceCount: overdueCount,
      activeInvoiceCount,
    } = await getAcademyReceivablesSummary(companyId);

    const pendingPayments = await prisma.academyPayment.count({
      where: { companyId, verificationStatus: "pending" },
    });

    const recentPayments = await prisma.academyPayment.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: {
        invoice: { select: { invoiceNumber: true } },
        student: { select: { studentNumber: true, firstName: true, lastName: true } },
        receipt: { select: { receiptNumber: true } },
      },
    });

    return {
      summary: {
        totalBilled: totalBilled.toString(),
        totalCollected: totalCollected.toString(),
        outstanding: outstanding.toString(),
        overdueInvoiceCount: overdueCount,
        pendingVerificationCount: pendingPayments,
        activeInvoiceCount,
      },
      recentPayments: recentPayments.map((p) => ({
        id: p.id,
        amount: p.amount.toString(),
        verificationStatus: p.verificationStatus,
        paymentDate: p.paymentDate,
        createdAt: p.createdAt,
        invoiceNumber: p.invoice?.invoiceNumber,
        studentLabel: p.student
          ? `${p.student.studentNumber} ${p.student.firstName} ${p.student.lastName}`
          : null,
        receiptNumber: p.receipt?.receiptNumber ?? null,
      })),
    };
  });
}
