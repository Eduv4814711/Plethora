import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { addDays } from "date-fns";
import { getAlertCounts } from "../modules/alerts/alerts.service.js";
import { getPeriodExportReadiness } from "../modules/attendance-exceptions/exceptions.service.js";
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

    // Timezone and cycle settings both come off the company row, so
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

    const payPeriod = getCurrentPayPeriod(parsePayrollCalendarSettings(companyRow?.settings));
    const startOfCurrentMonth = zonedMidnight(`${todayKey.slice(0, 7)}-01`, timeZone);

    const [
      guardsOnDutyByDay,
      guardsOnDuty,
      activeSitesCount,
      activeSitesLastMonth,
      employeesByStatus,
      shiftsByStatus,
      exportBatchStatus,
      latestExportBatch,
      totalPosts,
      activeClientsCount,
      onLeaveToday,
      attendanceRows14d,
    ] = await Promise.all([
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
          createdAt: { lt: startOfCurrentMonth },
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
      prisma.payrollExportBatch.groupBy({
        by: ["status"],
        where: {
          companyId,
          periodEnd: { gte: window.start, lt: window.end },
        },
        _count: { id: true },
      }),
      prisma.payrollExportBatch.findFirst({
        where: { companyId, periodKey: payPeriod.periodKey },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          periodKey: true,
          exportedAt: true,
        },
      }),
      prisma.sitePost.count({
        where: {
          isActive: true,
          site: {
            companyId,
            ...(siteIds?.length ? { id: { in: siteIds } } : {}),
          },
        },
      }),
      prisma.client.count({
        where: { companyId, isActive: true },
      }),
      prisma.leaveRequest.count({
        where: {
          companyId,
          status: "APPROVED",
          startDate: { lte: todayDateOnly },
          endDate: { gte: todayDateOnly },
        },
      }),
      prisma.siteTimesheetRow.groupBy({
        by: ["workDate", "attendanceStatus"],
        where: {
          companyId,
          workDate: { gte: addDays(todayDateOnly, -13), lte: todayDateOnly },
          ...(siteIds?.length ? { siteId: { in: siteIds } } : {}),
        },
        _count: { id: true },
      }),
    ]);

    const alerts: {
      type: string;
      message: string;
      count?: number;
      priority?: string;
      id?: string;
    }[] = [];

    // Best-effort: refresh contract expiry alerts (non-blocking for dashboard)
    void syncContractExpiryAlerts(companyId).catch(() => undefined);

    const [operationalAlertCounts, exportReadiness, pendingApprovalsInbox, openCriticalIncidents, pendingSiteTimesheetRows] =
      await Promise.all([
        // Site-scoped to match the operationalAlerts list below — otherwise the
        // priority tab counts describe the whole company while the list shows
        // only the selected sites.
        getAlertCounts(companyId, siteIds),
        getPeriodExportReadiness(companyId, payPeriod.periodStart, payPeriod.periodEnd, payPeriod.periodKey),
        prisma.approvalRequest.count({ where: { companyId, status: "PENDING" } }),
        prisma.incident.count({
          where: {
            companyId,
            severity: "CRITICAL",
            status: { in: ["SUBMITTED", "UNDER_REVIEW"] },
            ...(siteIds?.length ? { siteId: { in: siteIds } } : {}),
          },
        }),
        prisma.siteTimesheetRow.count({
          where: {
            companyId,
            approvalStatus: { in: ["pending", "partially_reviewed"] },
            workDate: { gte: payPeriod.periodStart, lte: payPeriod.periodEnd },
            ...(siteIds?.length ? { siteId: { in: siteIds } } : {}),
          },
        }),
      ]);

    if (exportReadiness && exportReadiness.openExceptions > 0) {
      alerts.push({
        type: "attendance_exceptions",
        message: "Attendance issues need review",
        count: exportReadiness.openExceptions,
        priority: "CRITICAL",
      });
    }

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
        employeeId: true,
        // Carries dateKey/shiftType/code etc. — the dashboard needs these to deep-link
        // an alert to the exact place the underlying problem is fixed.
        metadata: true,
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

    const employeesByStatusData = employeesByStatus.map((e) => ({
      name: e.status.charAt(0).toUpperCase() + e.status.slice(1),
      value: e._count.id,
    }));

    const shiftsByStatusData = shiftsByStatus.map((s) => ({
      name: s.status.charAt(0).toUpperCase() + s.status.slice(1),
      value: s._count.id,
    }));

    const exportBatchByStatus = exportBatchStatus.reduce(
      (acc: Record<string, number>, row) => ({ ...acc, [row.status]: row._count.id }),
      {}
    );

    const activeSitesDelta = activeSitesCount - activeSitesLastMonth;

    const totalEmployees = employeesByStatus.reduce((acc, row) => acc + row._count.id, 0);
    const activeEmployeesCount =
      employeesByStatus.find((row) => row.status === "active")?._count.id ?? 0;

    const ATTENDED_STATUSES = new Set([
      "present",
      "late",
      "left_early",
      "reliever",
      "shift_swapped",
      "training",
    ]);
    const trendBuckets = new Map<string, { attended: number; scheduled: number; unconfirmed: number }>();
    for (const row of attendanceRows14d) {
      const dateKey = row.workDate.toISOString().slice(0, 10);
      const entry = trendBuckets.get(dateKey) ?? { attended: 0, scheduled: 0, unconfirmed: 0 };
      const count = row._count.id;
      if (row.attendanceStatus !== "off") {
        entry.scheduled += count;
      }
      if (ATTENDED_STATUSES.has(row.attendanceStatus)) {
        entry.attended += count;
      }
      if (row.attendanceStatus === "pending") {
        entry.unconfirmed += count;
      }
      trendBuckets.set(dateKey, entry);
    }

    const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
    const attendanceTrend14d = Array.from({ length: 14 }, (_, idx) => {
      const d = addDays(todayDateOnly, -(13 - idx));
      const dateKey = d.toISOString().slice(0, 10);
      const stats = trendBuckets.get(dateKey) ?? { attended: 0, scheduled: 0, unconfirmed: 0 };
      const rate =
        stats.scheduled > 0 ? Math.round((stats.attended / stats.scheduled) * 1000) / 10 : null;
      return {
        date: dateKey,
        label: WEEKDAY_SHORT[d.getUTCDay()],
        attended: stats.attended,
        scheduled: stats.scheduled,
        unconfirmed: stats.unconfirmed,
        rate,
      };
    });

    return reply.send({
      dateRange: window.range,
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      guardsOnDuty,
      guardsOnDutyByDay,
      activeSitesCount,
      activeSitesAddedThisMonth: activeSitesDelta,
      activeSitesDelta,
      totalEmployees,
      activeEmployeesCount,
      onLeaveToday,
      totalPosts,
      activeClientsCount,
      attendanceTrend14d,
      alerts,
      alertCounts: operationalAlertCounts,
      operationalAlerts: persistedAlerts,
      /** persistedAlerts is capped at 30; the UI uses this to say "showing N of M". */
      operationalAlertsTruncated: operationalAlertCounts.allOpen > persistedAlerts.length,
      exportReadiness: {
        status: exportReadiness.status,
        openExceptions: exportReadiness.openExceptions,
        openCritical: exportReadiness.openCritical,
        periodKey: exportReadiness.periodKey,
        periodStart: exportReadiness.periodStart.toISOString(),
        periodEnd: exportReadiness.periodEnd.toISOString(),
        latestBatch: latestExportBatch
          ? {
              id: latestExportBatch.id,
              status: latestExportBatch.status,
              periodKey: latestExportBatch.periodKey,
              exportedAt: latestExportBatch.exportedAt?.toISOString() ?? null,
            }
          : null,
      },
      exportBatchByStatus,
      pendingSiteTimesheetRows,
      currentPayPeriod: {
        periodStart: payPeriod.periodStart.toISOString(),
        periodEnd: payPeriod.periodEnd.toISOString(),
        label: payPeriod.label,
        periodKey: payPeriod.periodKey,
      },
      pendingApprovalsInbox,
      openCriticalIncidents,
      shiftsOverTime,
      rosteredGuardsOverTime,
      employeesByStatus: employeesByStatusData,
      shiftsByStatus: shiftsByStatusData,
    });
  });
}
