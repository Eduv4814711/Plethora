import type { FastifyInstance } from "fastify";
import type { PayrollStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { startOfMonth, addDays } from "date-fns";
import { getAlertCounts } from "../modules/alerts/alerts.service.js";
import { getPayrollReadiness } from "../modules/attendance-exceptions/exceptions.service.js";
import { syncContractExpiryAlerts } from "../modules/documents/documents.service.js";
import { parsePayrollCalendarSettings } from "../lib/payroll-calendar-settings.js";
import { getCurrentPayPeriod } from "../services/payroll-period.service.js";
import { dateKeyInTimeZone, parseDateOnly } from "../lib/timezone.js";
import {
  bucketFormat,
  enumerateBuckets,
  resolveDashboardWindow,
  zonedMidnight,
} from "../lib/dashboard-window.js";
import {
  getGuardsOnDutyByDay as computeGuardsOnDutyByDay,
  getGuardsOnDutyNow,
} from "../services/dashboard-guards-on-duty.service.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/", {
    preHandler: [
      authMiddleware,
      requireCrudCapability({ module: "/" }),
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

    // Timezone and payroll-calendar settings both come off the company row, so
    // load it up front: the date window below is company-local, not server-local.
    const companyRow = await prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    const companySettings = (companyRow?.settings as Record<string, unknown>) ?? {};
    const timeZone =
      (typeof companySettings.timezone === "string" && companySettings.timezone.trim()) ||
      "Africa/Johannesburg";

    const window = resolveDashboardWindow(q.dateRange, now, timeZone);

    const shiftWhereBase = {
      companyId,
      ...(siteIds?.length ? { siteId: { in: siteIds } } : {}),
    };

    // Start of the current week (Monday) in company-local time. The
    // guards-on-duty chart is always a fixed Mon–Sun view and does not follow
    // the Today/Week/Month toggle.
    const todayKey = dateKeyInTimeZone(now, timeZone);
    const todayDateOnly = parseDateOnly(todayKey);
    const weekStartKey = addDays(todayDateOnly, -((todayDateOnly.getUTCDay() + 6) % 7))
      .toISOString()
      .slice(0, 10);
    const startOfWeek = zonedMidnight(weekStartKey, timeZone);

    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    const activeSitesWhere = siteIds?.length
      ? { companyId, id: { in: siteIds } }
      : { companyId };

    const [guardsOnDutyByDay, guardsOnDuty, activeSitesCount, activeSitesLastMonth, payrollStatus, pendingApprovals, employeesByStatus, shiftsByStatus] =
      await Promise.all([
        computeGuardsOnDutyByDay(companyId, startOfWeek, dayNames, timeZone, { siteIds }),
        getGuardsOnDutyNow(companyId, now, { siteIds }),
        prisma.site.count({
          where: {
            ...activeSitesWhere,
            siteStatus: "ACTIVE",
          },
        }),
        prisma.site.count({
          where: {
            ...activeSitesWhere,
            siteStatus: "ACTIVE",
            createdAt: { lt: startOfMonth(now) },
          },
        }),
        // Pay runs whose period *ends* inside the selected window. Without this
        // the "Pending payroll" KPI is an all-time tally that only ever grows.
        // PayrollRun has no siteId, so it cannot be site-scoped.
        prisma.payrollRun.groupBy({
          by: ["status"],
          where: {
            companyId,
            periodEnd: { gte: window.start, lt: window.end },
          },
          _count: { id: true },
        }),
        prisma.payrollRun.count({
          where: {
            companyId,
            status: "calculated",
            periodEnd: { gte: window.start, lt: window.end },
          },
        }),
        // Employee has no siteId in the schema, so headcount is always
        // company-wide. The UI labels it as such when a site filter is active.
        prisma.employee.groupBy({
          by: ["status"],
          where: { companyId },
          _count: { id: true },
        }),
        prisma.shift.groupBy({
          by: ["status"],
          where: {
            ...shiftWhereBase,
            startTime: { gte: window.start, lt: window.end },
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
    if (pendingApprovals > 0) {
      alerts.push({
        type: "pending_payroll_run_approvals",
        message: "Payroll run awaiting final approval",
        count: pendingApprovals,
        priority: "MEDIUM",
      });
    }

    // Best-effort: refresh contract expiry alerts (non-blocking for dashboard)
    void syncContractExpiryAlerts(companyId).catch(() => undefined);

    const [operationalAlertCounts, payrollReadiness, pendingApprovalsInbox, openCriticalIncidents, pendingSiteTimesheetRows] =
      await Promise.all([
        // Site-scoped to match the operationalAlerts list below — otherwise the
        // priority tab counts describe the whole company while the list shows
        // only the selected sites.
        getAlertCounts(companyId, siteIds),
        getPayrollReadiness(companyId),
        prisma.approvalRequest.count({ where: { companyId, status: "PENDING" } }),
        prisma.incident.count({
          where: {
            companyId,
            severity: "CRITICAL",
            status: { in: ["SUBMITTED", "UNDER_REVIEW"] },
          },
        }),
        prisma.siteTimesheetRow.count({
          where: {
            companyId,
            approvalStatus: { in: ["pending", "partially_reviewed"] },
            ...(siteIds?.length ? { siteId: { in: siteIds } } : {}),
          },
        }),
      ]);

    if (payrollReadiness && payrollReadiness.openExceptions > 0) {
      alerts.push({
        type: "attendance_exceptions",
        message: "Attendance issues need review",
        count: payrollReadiness.openExceptions,
        priority: "CRITICAL",
      });
    }

    const payPeriod = getCurrentPayPeriod(parsePayrollCalendarSettings(companyRow?.settings));

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

    // NOTE: persisted alerts are deliberately *not* pushed into `alerts`.
    // They are returned separately as `operationalAlerts`, and the dashboard
    // renders that list on its own. Duplicating them here made every alert
    // count two to three times in the "Needs attention" KPI.

    const userId = user.sub;
    const todayStart = zonedMidnight(todayKey, timeZone);
    const todayEnd = zonedMidnight(
      addDays(todayDateOnly, 1).toISOString().slice(0, 10),
      timeZone
    );

    // Shift volume and distinct rostered guards, bucketed across the selected
    // window. Both `date_trunc` and `to_char` run against the company-local
    // timestamp so the buckets line up with `enumerateBuckets` below.
    const truncUnit = Prisma.raw(`'${window.bucket}'`);
    const keyFormat = Prisma.raw(`'${bucketFormat(window.bucket)}'`);
    const zone = Prisma.sql`${timeZone}`;
    const siteClause = siteIds?.length
      ? Prisma.sql`AND s."siteId" IN (${Prisma.join(siteIds)})`
      : Prisma.empty;

    const shiftBuckets = await prisma.$queryRaw<
      { bucket: string; shifts: bigint; guards: bigint }[]
    >(Prisma.sql`
      SELECT
        to_char(date_trunc(${truncUnit}, s."startTime" AT TIME ZONE ${zone}::text), ${keyFormat}) AS bucket,
        count(*)::bigint AS shifts,
        count(DISTINCT s."employeeId")::bigint AS guards
      FROM "Shift" s
      WHERE s."companyId" = ${companyId}
        AND s."startTime" >= ${window.start}
        AND s."startTime" < ${window.end}
        ${siteClause}
      GROUP BY 1
      ORDER BY 1 ASC
    `);

    const shiftCountByBucket = new Map<string, number>();
    const guardCountByBucket = new Map<string, number>();
    for (const row of shiftBuckets) {
      shiftCountByBucket.set(row.bucket, Number(row.shifts));
      guardCountByBucket.set(row.bucket, Number(row.guards));
    }

    const buckets = enumerateBuckets(window, timeZone);
    const shiftsOverTime = buckets.map(({ key, label }) => ({
      name: label,
      value: shiftCountByBucket.get(key) ?? 0,
    }));
    const rosteredGuardsOverTime = buckets.map(({ key, label }) => ({
      name: label,
      value: guardCountByBucket.get(key) ?? 0,
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
                dueDate: { gte: todayStart, lt: todayEnd },
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
      dateRange: window.range,
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      guardsOnDuty,
      guardsOnDutyByDay,
      activeSitesCount,
      activeSitesAddedThisMonth: activeSitesDelta,
      activeSitesDelta,
      payrollStatus: payrollByStatus,
      alerts,
      alertCounts: operationalAlertCounts,
      operationalAlerts: persistedAlerts,
      /** persistedAlerts is capped at 30; the UI uses this to say "showing N of M". */
      operationalAlertsTruncated: operationalAlertCounts.allOpen > persistedAlerts.length,
      payrollReadiness: payrollReadiness
        ? {
            status: payrollReadiness.status,
            openExceptions: payrollReadiness.openExceptions,
            periodStart: payrollReadiness.periodStart.toISOString(),
            periodEnd: payrollReadiness.periodEnd.toISOString(),
          }
        : null,
      pendingPayrollRunApprovals: pendingApprovals,
      pendingSiteTimesheetRows,
      currentPayPeriod: {
        periodStart: payPeriod.periodStart.toISOString(),
        periodEnd: payPeriod.periodEnd.toISOString(),
        label: payPeriod.label,
      },
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
      rosteredGuardsOverTime,
      employeesByStatus: employeesByStatusData,
      shiftsByStatus: shiftsByStatusData,
    });
  });
}
