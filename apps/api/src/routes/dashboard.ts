import type { FastifyInstance } from "fastify";
import type { PayrollStatus } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = request.user!;
    const companyId = user.companyId;

    const now = new Date();

    const [guardsOnDuty, activeSitesCount, payrollStatus, missedShifts, pendingApprovals] =
      await Promise.all([
        prisma.shift.count({
          where: {
            companyId,
            status: "active",
            startTime: { lte: now },
            endTime: { gte: now },
          },
        }),
        prisma.site.count({
          where: {
            companyId,
            posts: {
              some: {
                shifts: {
                  some: {
                    status: "active",
                    startTime: { lte: now },
                    endTime: { gte: now },
                  },
                },
              },
            },
          },
        }),
        prisma.payrollRun.groupBy({
          by: ["status"],
          where: { companyId },
          _count: { id: true },
        }),
        prisma.shift.count({
          where: {
            companyId,
            status: { in: ["assigned", "created"] },
            endTime: { lt: now },
            attendances: { none: { clockIn: { not: null } } },
          },
        }),
        prisma.payrollRun.count({
          where: { companyId, status: "calculated" },
        }),
      ]);

    const payrollByStatus = payrollStatus.reduce(
      (acc: Record<string, number>, p: { status: PayrollStatus; _count: { id: number } }) =>
        ({ ...acc, [p.status]: p._count.id }),
      {} as Record<string, number>
    );

    const alerts: { type: string; message: string; count?: number }[] = [];
    if (missedShifts > 0) {
      alerts.push({ type: "missed_shifts", message: "Missed shifts", count: missedShifts });
    }
    if (pendingApprovals > 0) {
      alerts.push({
        type: "pending_approvals",
        message: "Payroll runs pending approval",
        count: pendingApprovals,
      });
    }

    return reply.send({
      guardsOnDuty,
      activeSitesCount,
      payrollStatus: payrollByStatus,
      alerts,
    });
  });
}
