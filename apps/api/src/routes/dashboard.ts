import type { FastifyInstance } from "fastify";
import type { PayrollStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { startOfMonth, subMonths, format, startOfDay, endOfDay } from "date-fns";
import { getAlertCounts } from "../modules/alerts/alerts.service.js";
import { getPayrollReadiness } from "../modules/attendance-exceptions/exceptions.service.js";
import { syncContractExpiryAlerts } from "../modules/documents/documents.service.js";

function parseDateRange(q: Record<string, string | undefined>): { start: Date; end: Date } {
  const now = new Date();
  const range = q.dateRange || "month";
  const customStart = q.startDate ? new Date(q.startDate) : null;
  const customEnd = q.endDate ? new Date(q.endDate) : null;

  if (range === "custom" && customStart && customEnd && !Number.isNaN(customStart.getTime()) && !Number.isNaN(customEnd.getTime())) {
    return { start: startOfDay(customStart), end: endOfDay(customEnd) };
  }
  if (range === "today") {
    return { start: startOfDay(now), end: endOfDay(now) };
  }
  if (range === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  // month (default)
  return {
    start: startOfMonth(now),
    end: endOfDay(now),
  };
}

async function getGuardsOnDutyByDay(
  companyId: string,
  siteIds: string[] | undefined,
  weekStart: Date,
  dayNames: string[]
): Promise<{ name: string; value: number }[]> {
  const rows = siteIds?.length
    ? await prisma.$queryRaw<{ dayIndex: number; count: bigint }[]>(Prisma.sql`
        SELECT d.day_index::int AS "dayIndex", count(s.id)::bigint AS count
        FROM generate_series(0, 6) AS d(day_index)
        LEFT JOIN "Shift" s
          ON s."companyId" = ${companyId}
          AND s."status" IN ('assigned', 'active', 'completed', 'verified')
          AND s."startTime" <= (${weekStart}::timestamp + ((d.day_index + 1) * interval '1 day') - interval '1 millisecond')
          AND s."endTime" >= (${weekStart}::timestamp + (d.day_index * interval '1 day'))
          AND s."siteId" IN (${Prisma.join(siteIds)})
        GROUP BY d.day_index
        ORDER BY d.day_index ASC
      `)
    : await prisma.$queryRaw<{ dayIndex: number; count: bigint }[]>(Prisma.sql`
        SELECT d.day_index::int AS "dayIndex", count(s.id)::bigint AS count
        FROM generate_series(0, 6) AS d(day_index)
        LEFT JOIN "Shift" s
          ON s."companyId" = ${companyId}
          AND s."status" IN ('assigned', 'active', 'completed', 'verified')
          AND s."startTime" <= (${weekStart}::timestamp + ((d.day_index + 1) * interval '1 day') - interval '1 millisecond')
          AND s."endTime" >= (${weekStart}::timestamp + (d.day_index * interval '1 day'))
        GROUP BY d.day_index
        ORDER BY d.day_index ASC
      `);

  const counts = new Map(rows.map((row) => [Number(row.dayIndex), Number(row.count)]));
  return dayNames.map((name, index) => ({ name, value: counts.get(index) ?? 0 }));
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/", {
    preHandler: [
      authMiddleware,
      requireRole(["admin", "operations_manager", "hr_payroll", "supervisor"], { module: "/" }),
    ],
  }, async (request, reply) => {
    const user = request.user!;
    const companyId = user.companyId;
    const q = request.query as Record<string, string | undefined>;
    const siteIdsRaw = q.siteIds;
    const siteIds: string[] | undefined = siteIdsRaw
      ? siteIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const now = new Date();
    const { start: dateStart, end: dateEnd } = parseDateRange(q);

    const shiftWhereBase = {
      companyId,
      ...(siteIds?.length ? { siteId: { in: siteIds } } : {}),
    };

    // Get start of current week (Monday) and build day boundaries
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    startOfWeek.setHours(0, 0, 0, 0);

    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    const months = 4;
    const reportStart = startOfMonth(subMonths(now, months - 1));

    const activeSitesWhere = siteIds?.length
      ? { companyId, id: { in: siteIds } }
      : { companyId };

    const [guardsOnDutyByDay, guardsOnDuty, activeSitesCount, activeSitesLastMonth, payrollStatus, missedShifts, pendingApprovals, employeesByStatus, shiftsByStatus] =
      await Promise.all([
        getGuardsOnDutyByDay(companyId, siteIds, startOfWeek, dayNames),
        prisma.shift.count({
          where: {
            ...shiftWhereBase,
            status: "active",
            startTime: { lte: now },
            endTime: { gte: now },
          },
        }),
        prisma.site.count({
          where: {
            ...activeSitesWhere,
            shifts: {
              some: {
                status: "active",
                startTime: { lte: now },
                endTime: { gte: now },
              },
            },
          },
        }),
        prisma.site.count({
          where: {
            ...activeSitesWhere,
            shifts: {
              some: {
                status: { in: ["assigned", "active", "completed", "verified"] },
                startTime: {
                  gte: startOfMonth(subMonths(now, 1)),
                  lte: endOfDay(subMonths(now, 1)),
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
            ...shiftWhereBase,
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

    const alerts: {
      type: string;
      message: string;
      count?: number;
      priority?: string;
      id?: string;
    }[] = [];
    if (missedShifts > 0) {
      alerts.push({
        type: "missed_shifts",
        message: "Guard missed clock-in",
        count: missedShifts,
        priority: "CRITICAL",
      });
    }
    if (pendingApprovals > 0) {
      alerts.push({
        type: "pending_approvals",
        message: "Payroll approval pending",
        count: pendingApprovals,
        priority: "MEDIUM",
      });
    }

    // Best-effort: refresh contract expiry alerts (non-blocking for dashboard)
    void syncContractExpiryAlerts(companyId).catch(() => undefined);

    const [operationalAlertCounts, payrollReadiness, pendingApprovalsInbox, openCriticalIncidents] =
      await Promise.all([
        getAlertCounts(companyId),
        getPayrollReadiness(companyId),
        prisma.approvalRequest.count({ where: { companyId, status: "PENDING" } }),
        prisma.incident.count({
          where: {
            companyId,
            severity: "CRITICAL",
            status: { in: ["SUBMITTED", "UNDER_REVIEW"] },
          },
        }),
      ]);

    const persistedAlerts = await prisma.operationalAlert.findMany({
      where: {
        companyId,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
        ...(siteIds?.length ? { siteId: { in: siteIds } } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 30,
      select: {
        id: true,
        title: true,
        message: true,
        priority: true,
        status: true,
        sourceModule: true,
        sourceId: true,
        siteId: true,
        createdAt: true,
      },
    });

    const priorityOrder = { CRITICAL: 0, MEDIUM: 1, LOW: 2 } as const;
    persistedAlerts.sort(
      (a, b) =>
        priorityOrder[a.priority] - priorityOrder[b.priority] ||
        b.createdAt.getTime() - a.createdAt.getTime()
    );

    for (const a of persistedAlerts) {
      alerts.push({
        type: a.sourceModule.toLowerCase(),
        message: a.title,
        priority: a.priority,
        id: a.id,
        count: 1,
      });
    }

    const userId = user.sub;
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    const shiftsByMonth = siteIds?.length
      ? await prisma.$queryRaw<
          { month: string; count: bigint }[]
        >(Prisma.sql`
      SELECT to_char(date_trunc('month', s."startTime")::date, 'YYYY-MM') as month, count(*)::bigint
      FROM "Shift" s
      WHERE s."companyId" = ${companyId}
        AND s."siteId" IN (${Prisma.join(siteIds)})
        AND s."startTime" >= ${reportStart}
      GROUP BY date_trunc('month', s."startTime")
      ORDER BY month ASC
    `)
      : await prisma.$queryRaw<
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

    const [tasksOverdue, tasksDueToday, topPriorityTasks] =
      userId
        ? await Promise.all([
            prisma.task.count({
              where: {
                companyId,
                assigneeType: "user",
                assigneeId: userId,
                status: { notIn: ["done", "cancelled"] },
                dueDate: { lt: todayStart },
              },
            }),
            prisma.task.count({
              where: {
                companyId,
                assigneeType: "user",
                assigneeId: userId,
                status: { notIn: ["done", "cancelled"] },
                dueDate: { gte: todayStart, lte: todayEnd },
              },
            }),
            prisma.task.findMany({
              where: {
                companyId,
                assigneeType: "user",
                assigneeId: userId,
                status: { notIn: ["done", "cancelled"] },
              },
              select: { id: true, title: true, dueDate: true, priority: true },
              orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
              take: 3,
            }),
          ])
        : [0, 0, [] as { id: string; title: string; dueDate: Date | null; priority: string }[]];

    const employeesByStatusData = employeesByStatus.map((e) => ({
      name: e.status.charAt(0).toUpperCase() + e.status.slice(1),
      value: e._count.id,
    }));

    const shiftsByStatusData = shiftsByStatus.map((s) => ({
      name: s.status.charAt(0).toUpperCase() + s.status.slice(1),
      value: s._count.id,
    }));

    const activeSitesDelta = activeSitesCount - activeSitesLastMonth;

    return reply.send({
      guardsOnDuty,
      guardsOnDutyByDay,
      activeSitesCount,
      activeSitesDelta,
      payrollStatus: payrollByStatus,
      alerts,
      alertCounts: operationalAlertCounts,
      operationalAlerts: persistedAlerts,
      payrollReadiness: payrollReadiness
        ? {
            status: payrollReadiness.status,
            openExceptions: payrollReadiness.openExceptions,
          }
        : null,
      pendingApprovalsInbox,
      openCriticalIncidents,
      taskStats: { overdue: tasksOverdue, dueToday: tasksDueToday },
      topPriorityTasks: topPriorityTasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate?.toISOString() ?? null,
        priority: t.priority,
      })),
      shiftsOverTime,
      employeesByStatus: employeesByStatusData,
      shiftsByStatus: shiftsByStatusData,
    });
  });
}
