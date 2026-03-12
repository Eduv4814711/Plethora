import type { FastifyInstance } from "fastify";
import type { PayrollStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { startOfMonth, subMonths, format } from "date-fns";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = request.user!;
    const companyId = user.companyId;

    const now = new Date();

    // Get start of current week (Monday) and build day boundaries
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    startOfWeek.setHours(0, 0, 0, 0);

    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const guardsOnDutyByDay = await Promise.all(
      dayNames.map(async (_, i) => {
        const dayStart = new Date(startOfWeek);
        dayStart.setDate(startOfWeek.getDate() + i);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        const count = await prisma.shift.count({
          where: {
            companyId,
            status: { in: ["assigned", "active", "completed", "verified"] },
            startTime: { lte: dayEnd },
            endTime: { gte: dayStart },
          },
        });
        return { name: dayNames[i], value: count };
      })
    );

    const months = 4;
    const reportStart = startOfMonth(subMonths(now, months - 1));

    const [guardsOnDuty, activeSitesCount, payrollStatus, missedShifts, pendingApprovals, employeesByStatus, shiftsByStatus] =
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
        prisma.employee.groupBy({
          by: ["status"],
          where: { companyId },
          _count: { id: true },
        }),
        prisma.shift.groupBy({
          by: ["status"],
          where: {
            companyId,
            startTime: { gte: reportStart },
          },
          _count: { id: true },
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

    const userId = user.sub;
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    const shiftsByMonth = await prisma.$queryRaw<
      { month: string; count: bigint }[]
    >(Prisma.sql`
      SELECT to_char(date_trunc('month', "startTime")::date, 'YYYY-MM') as month, count(*)::bigint
      FROM "Shift"
      WHERE "companyId" = ${companyId}
        AND "startTime" >= ${reportStart}
      GROUP BY date_trunc('month', "startTime")
      ORDER BY month ASC
    `);
    const shiftsByMonthMap = new Map<string, number>();
    for (let i = 0; i < months; i++) {
      const m = format(subMonths(now, months - 1 - i), "yyyy-MM");
      shiftsByMonthMap.set(m, 0);
    }
    for (const row of shiftsByMonth) {
      shiftsByMonthMap.set(row.month, Number(row.count));
    }
    const shiftsOverTime = Array.from(shiftsByMonthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({
        name: format(new Date(month + "-01"), "MMM"),
        value: count,
      }));

    const [tasksOverdue, tasksDueToday] =
      userId
        ? await Promise.all([
            prisma.task.count({
              where: {
                companyId,
                assigneeType: "user",
                assigneeId: userId,
                status: { not: "done" },
                dueDate: { lt: todayStart },
              },
            }),
            prisma.task.count({
              where: {
                companyId,
                assigneeType: "user",
                assigneeId: userId,
                status: { not: "done" },
                dueDate: { gte: todayStart, lte: todayEnd },
              },
            }),
          ])
        : [0, 0];

    const employeesByStatusData = employeesByStatus.map((e) => ({
      name: e.status.charAt(0).toUpperCase() + e.status.slice(1),
      value: e._count.id,
    }));

    const shiftsByStatusData = shiftsByStatus.map((s) => ({
      name: s.status.charAt(0).toUpperCase() + s.status.slice(1),
      value: s._count.id,
    }));

    return reply.send({
      guardsOnDuty,
      guardsOnDutyByDay,
      activeSitesCount,
      payrollStatus: payrollByStatus,
      alerts,
      taskStats: { overdue: tasksOverdue, dueToday: tasksDueToday },
      shiftsOverTime,
      employeesByStatus: employeesByStatusData,
      shiftsByStatus: shiftsByStatusData,
    });
  });
}
