import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { parsePayrollCalendarSettings } from "../lib/payroll-calendar-settings.js";
import {
  formatPayPeriodLabel,
  getPayPeriodContaining,
  listPayPeriods,
} from "../services/payroll-period.service.js";

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
    const payPeriodCount = Math.min(Math.max(Number(q.payPeriodCount ?? q.months) || 6, 1), 24);

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    const calendar = parsePayrollCalendarSettings(company?.settings);
    const periods = listPayPeriods(calendar, {
      before: payPeriodCount - 1,
      after: 0,
    });
    const start = periods[0].periodStart;
    const end = periods[periods.length - 1].periodEnd;

    const periodLabelByKey = new Map(
      periods.map((p) => [p.periodKey, formatPayPeriodLabel(p.periodEnd, "pay").replace(" Pay Period", "")])
    );

    const [
      payrollByStatus,
      employeesByStatus,
      shiftsByStatus,
      shiftsInRange,
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
          startTime: { gte: start, lte: end },
        },
        _count: { id: true },
      }),
      prisma.shift.findMany({
        where: {
          companyId,
          startTime: { gte: start, lte: end },
        },
        select: { startTime: true },
      }),
      prisma.payrollRun.findMany({
        where: {
          companyId,
          periodEnd: { gte: start, lte: end },
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
            startTime: { gte: start, lte: end },
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

    const shiftsByPeriodKey = new Map<string, number>();
    for (const p of periods) {
      shiftsByPeriodKey.set(p.periodKey, 0);
    }
    for (const shift of shiftsInRange) {
      const key = getPayPeriodContaining(calendar, shift.startTime).periodKey;
      if (shiftsByPeriodKey.has(key)) {
        shiftsByPeriodKey.set(key, (shiftsByPeriodKey.get(key) ?? 0) + 1);
      }
    }
    const shiftsOverTime = periods.map((p) => ({
      month: periodLabelByKey.get(p.periodKey) ?? p.periodKey,
      shifts: shiftsByPeriodKey.get(p.periodKey) ?? 0,
    }));

    const payrollByPeriodKey = new Map<string, { gross: number; net: number }>();
    for (const p of periods) {
      payrollByPeriodKey.set(p.periodKey, { gross: 0, net: 0 });
    }
    for (const run of payrollByMonth) {
      const key = getPayPeriodContaining(calendar, run.periodEnd).periodKey;
      if (!payrollByPeriodKey.has(key)) continue;
      const gross = run.items.reduce((s, i) => s + Number(i.grossPay), 0);
      const net = run.items.reduce((s, i) => s + Number(i.netPay), 0);
      const existing = payrollByPeriodKey.get(key)!;
      payrollByPeriodKey.set(key, {
        gross: existing.gross + gross,
        net: existing.net + net,
      });
    }
    const payrollOverTime = periods.map((p) => {
      const totals = payrollByPeriodKey.get(p.periodKey) ?? { gross: 0, net: 0 };
      return {
        month: periodLabelByKey.get(p.periodKey) ?? p.periodKey,
        gross: totals.gross,
        net: totals.net,
      };
    });

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
