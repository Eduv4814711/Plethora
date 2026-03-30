import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { startOfMonth, subMonths, format } from "date-fns";

export async function reportsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireRole(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"], {
      module: "/reports",
    }),
  ];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const companyId = user.companyId;
    const q = request.query as Record<string, string | undefined>;
    const months = Math.min(Math.max(Number(q.months) || 6, 1), 24);

    const now = new Date();
    const start = startOfMonth(subMonths(now, months - 1));

    const [
      payrollByStatus,
      employeesByStatus,
      shiftsByStatus,
      shiftsByMonth,
      payrollByMonth,
      hoursBySite,
    ] = await Promise.all([
      prisma.payrollRun.groupBy({
        by: ["status"],
        where: { companyId },
        _count: { id: true },
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
          startTime: { gte: start },
        },
        _count: { id: true },
      }),
      prisma.$queryRaw<
        { month: string; count: bigint }[]
      >(Prisma.sql`
        SELECT to_char(date_trunc('month', "startTime")::date, 'YYYY-MM') as month, count(*)::bigint
        FROM "Shift"
        WHERE "companyId" = ${companyId}
          AND "startTime" >= ${start}
        GROUP BY date_trunc('month', "startTime")
        ORDER BY month ASC
      `),
      prisma.payrollRun.findMany({
        where: {
          companyId,
          periodStart: { gte: start },
          status: { in: ["calculated", "approved", "paid"] },
        },
        include: {
          items: {
            select: { grossPay: true, netPay: true },
          },
        },
      }),
      prisma.attendance.findMany({
        where: {
          shift: {
            companyId,
            startTime: { gte: start },
          },
          clockIn: { not: null },
          clockOut: { not: null },
        },
        select: {
          hoursWorked: true,
          shift: {
            select: {
              post: {
                select: {
                  site: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const payrollStatusData = payrollByStatus.map((p) => ({
      name: p.status.charAt(0).toUpperCase() + p.status.slice(1),
      value: p._count.id,
    }));

    const employeeStatusData = employeesByStatus.map((e) => ({
      name: e.status.charAt(0).toUpperCase() + e.status.slice(1),
      value: e._count.id,
    }));

    const shiftStatusData = shiftsByStatus.map((s) => ({
      name: s.status.charAt(0).toUpperCase() + s.status.slice(1),
      value: Number(s._count.id),
    }));

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
        month: format(new Date(month + "-01"), "MMM yyyy"),
        shifts: count,
      }));

    const payrollByMonthMap = new Map<string, { gross: number; net: number }>();
    for (const run of payrollByMonth) {
      const m = format(run.periodStart, "yyyy-MM");
      const gross = run.items.reduce((s, i) => s + Number(i.grossPay), 0);
      const net = run.items.reduce((s, i) => s + Number(i.netPay), 0);
      const existing = payrollByMonthMap.get(m) ?? { gross: 0, net: 0 };
      payrollByMonthMap.set(m, {
        gross: existing.gross + gross,
        net: existing.net + net,
      });
    }
    const payrollOverTime = Array.from(payrollByMonthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, { gross, net }]) => ({
        month: format(new Date(month + "-01"), "MMM yyyy"),
        gross,
        net,
      }));

    const siteHours = new Map<string, number>();
    for (const a of hoursBySite) {
      const siteName = a.shift?.post?.site?.name ?? "Unknown";
      const hrs = Number(a.hoursWorked ?? 0);
      siteHours.set(siteName, (siteHours.get(siteName) ?? 0) + hrs);
    }
    const hoursBySiteData = Array.from(siteHours.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, hours]) => ({ name, hours: Math.round(hours * 100) / 100 }));

    return reply.send({
      payrollByStatus: payrollStatusData,
      employeesByStatus: employeeStatusData,
      shiftsByStatus: shiftStatusData,
      shiftsOverTime,
      payrollOverTime,
      hoursBySite: hoursBySiteData,
    });
  });
}
