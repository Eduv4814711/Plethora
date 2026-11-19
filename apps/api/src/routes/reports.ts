import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { requireCrudCapability } from "../middleware/authorization.js";
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
    requireCrudCapability({
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
      exportBatchesByStatus,
      employeesByStatus,
      shiftsByStatus,
      shiftsInRange,
      exportBatchesByMonth,
      rawAttendanceHours,
      approvedTimesheetSites,
      approvedTimesheetRows,
    ] = await Promise.all([
      prisma.payrollExportBatch.groupBy({
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
      prisma.payrollExportBatch.findMany({
        where: {
          companyId,
          periodEnd: { gte: start, lte: end },
          status: { in: ["LOCKED", "EXPORTED"] },
        },
        select: {
          periodEnd: true,
          employeeCount: true,
          totalBasicHours: true,
          totalOvertimeHours: true,
          totalSundayHours: true,
          totalPublicHolidayHours: true,
          totalNightShiftHours: true,
          totalPaidLeaveHours: true,
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
              siteId: true,
              site: {
                select: { name: true },
              },
            },
          },
        },
      }),
      // Same per-site rule as payroll's aggregateTimesheets: sites with an
      // approved/locked site timesheet report the approved hours, others fall
      // back to raw clock data. Keeps reports consistent with what gets paid.
      prisma.siteTimesheet.findMany({
        where: {
          companyId,
          status: { in: ["approved", "locked"] },
          periodStart: { lte: end },
          periodEnd: { gte: start },
        },
        select: { siteId: true },
      }),
      prisma.siteTimesheetRow.findMany({
        where: {
          companyId,
          workDate: { gte: start, lte: end },
          actualGuardId: { not: null },
          siteTimesheet: { status: { in: ["approved", "locked"] } },
        },
        select: {
          hoursWorked: true,
          overtimeHours: true,
          siteId: true,
          site: { select: { name: true } },
        },
      }),
    ]);

    const exportStatusData = exportBatchesByStatus.map((p) => ({
      name: p.status.charAt(0).toUpperCase() + p.status.slice(1).toLowerCase(),
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

    const exportsByPeriodKey = new Map<string, { workedHours: number; overtimeHours: number; leaveHours: number }>();
    for (const p of periods) {
      exportsByPeriodKey.set(p.periodKey, { workedHours: 0, overtimeHours: 0, leaveHours: 0 });
    }
    for (const batch of exportBatchesByMonth) {
      const key = getPayPeriodContaining(calendar, batch.periodEnd).periodKey;
      if (!exportsByPeriodKey.has(key)) continue;
      const existing = exportsByPeriodKey.get(key)!;
      const worked =
        Number(batch.totalBasicHours) +
        Number(batch.totalSundayHours) +
        Number(batch.totalPublicHolidayHours);
      exportsByPeriodKey.set(key, {
        workedHours: existing.workedHours + worked,
        overtimeHours: existing.overtimeHours + Number(batch.totalOvertimeHours),
        leaveHours: existing.leaveHours + Number(batch.totalPaidLeaveHours),
      });
    }
    const exportsOverTime = periods.map((p) => {
      const totals = exportsByPeriodKey.get(p.periodKey) ?? {
        workedHours: 0,
        overtimeHours: 0,
        leaveHours: 0,
      };
      return {
        month: periodLabelByKey.get(p.periodKey) ?? p.periodKey,
        workedHours: Math.round(totals.workedHours * 100) / 100,
        overtimeHours: Math.round(totals.overtimeHours * 100) / 100,
        leaveHours: Math.round(totals.leaveHours * 100) / 100,
      };
    });

    const approvedSiteIds = new Set(approvedTimesheetSites.map((t) => t.siteId));
    const siteHours = new Map<string, number>();
    for (const row of approvedTimesheetRows) {
      const siteName = row.site?.name ?? "Unknown";
      const hrs = Number(row.hoursWorked ?? 0) + Number(row.overtimeHours ?? 0);
      siteHours.set(siteName, (siteHours.get(siteName) ?? 0) + hrs);
    }
    for (const a of rawAttendanceHours) {
      if (a.shift?.siteId && approvedSiteIds.has(a.shift.siteId)) continue;
      const siteName = a.shift?.site?.name ?? "Unknown";
      const hrs = Number(a.hoursWorked ?? 0);
      siteHours.set(siteName, (siteHours.get(siteName) ?? 0) + hrs);
    }
    const hoursBySiteData = Array.from(siteHours.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, hours]) => ({ name, hours: Math.round(hours * 100) / 100 }));

    return reply.send({
      exportByStatus: exportStatusData,
      employeesByStatus: employeeStatusData,
      shiftsByStatus: shiftStatusData,
      shiftsOverTime,
      exportsOverTime,
      hoursBySite: hoursBySiteData,
    });
  });
}
