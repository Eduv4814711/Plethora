import type { FastifyInstance } from "fastify";
import { addDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability } from "../../middleware/authorization.js";
import { prisma } from "../../lib/prisma.js";
import { parsePayrollCalendarSettings } from "../../lib/payroll-calendar-settings.js";
import { listPayPeriods } from "../../services/payroll-period.service.js";
import { dateKeyInTimeZone, getCompanyTimezone, parseDateOnly } from "../../lib/timezone.js";
import { buildApprovedSiteDateCoverage } from "../../services/timesheet.service.js";
import {
  getExceptionAnalytics,
  getPeriodExportReadiness,
} from "../attendance-exceptions/exceptions.service.js";
import { toCsv } from "../../lib/csv.js";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseRange(
  q: Record<string, string | undefined>,
  timeZone: string
): { start: Date; end: Date } | { error: string } {
  const now = new Date();
  let end: Date;
  if (q.endDate) {
    if (DATE_ONLY_PATTERN.test(q.endDate)) {
      const nextDayKey = addDays(parseDateOnly(q.endDate), 1).toISOString().slice(0, 10);
      end = new Date(fromZonedTime(`${nextDayKey}T00:00:00`, timeZone).getTime() - 1);
    } else {
      end = new Date(q.endDate);
    }
    if (Number.isNaN(end.getTime())) {
      return { error: "Invalid endDate" };
    }
  } else {
    end = now;
  }

  let start: Date;
  if (q.startDate) {
    start = DATE_ONLY_PATTERN.test(q.startDate)
      ? fromZonedTime(`${q.startDate}T00:00:00`, timeZone)
      : new Date(q.startDate);
    if (Number.isNaN(start.getTime())) {
      return { error: "Invalid startDate" };
    }
  } else {
    const endKey = dateKeyInTimeZone(end, timeZone);
    start = fromZonedTime(`${endKey.slice(0, 7)}-01T00:00:00`, timeZone);
  }

  if (start > end) {
    return { error: "startDate must not be after endDate" };
  }

  return { start, end };
}

export async function reportsExtendedRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCapability("/reports", "view"),
  ];
  const exportProtect = [authMiddleware, requireCapability("/reports", "export")];

  app.get("/types", { preHandler: protect }, async (_request, reply) => {
    return reply.send({
      types: [
        { id: "attendance-summary", name: "Attendance Summary" },
        { id: "late-arrivals", name: "Late Arrival Report" },
        { id: "missed-clock-ins", name: "Missed Clock-In Report" },
        { id: "missed-clock-outs", name: "Missed Clock-Out Report" },
        { id: "absenteeism", name: "Absenteeism Report" },
        { id: "overtime", name: "Overtime Report" },
        { id: "leave", name: "Leave Report" },
        { id: "export-readiness", name: "Payroll Export Readiness & Exceptions Report" },
        { id: "site-performance", name: "Site Performance Report" },
        { id: "employee-attendance", name: "Employee Attendance Report" },
        { id: "incidents", name: "Incident Report" },
        { id: "client-monthly", name: "Client Monthly Report" },
        { id: "equipment-inspections", name: "Equipment Inspection Report" },
        { id: "supervisor-activity", name: "Supervisor Activity Report" },
      ],
    });
  });

  app.get("/:type", { preHandler: exportProtect }, async (request, reply) => {
    const user = request.user!;
    const { type } = request.params as { type: string };
    const q = request.query as Record<string, string | undefined>;
    const timeZone = await getCompanyTimezone(user.companyId);
    const range = parseRange(q, timeZone);
    if ("error" in range) {
      return reply.code(400).send({ error: "Validation error", message: range.error });
    }
    const { start, end } = range;
    const startKey = dateKeyInTimeZone(start, timeZone);
    const endKey = dateKeyInTimeZone(end, timeZone);
    const startDateOnly = parseDateOnly(startKey);
    const endDateOnly = parseDateOnly(endKey);
    const format = q.format ?? "json";
    const siteId = q.siteId;
    const employeeId = q.employeeId;
    const clientId = q.clientId;

    let headers: string[] = [];
    let rows: unknown[][] = [];
    let summary: Record<string, unknown> = {};

    if (
      [
        "attendance-summary",
        "late-arrivals",
        "missed-clock-ins",
        "missed-clock-outs",
        "absenteeism",
        "employee-attendance",
      ].includes(type)
    ) {
      const analytics = await getExceptionAnalytics(user.companyId, start, end);
      const typeFilter: Record<string, string | undefined> = {
        "late-arrivals": "LATE_ARRIVAL",
        "missed-clock-ins": "MISSED_CLOCK_IN",
        "missed-clock-outs": "MISSED_CLOCK_OUT",
        absenteeism: "ABSENT",
      };
      const filterType = typeFilter[type];
      const exceptions = await prisma.attendanceException.findMany({
        where: {
          companyId: user.companyId,
          detectedAt: { gte: start, lte: end },
          ...(filterType ? { exceptionType: filterType as never } : {}),
          ...(siteId ? { siteId } : {}),
          ...(employeeId ? { employeeId } : {}),
        },
        include: {
          site: { select: { name: true } },
          employee: { select: { firstName: true, lastName: true } },
        },
        orderBy: { detectedAt: "desc" },
        take: 1000,
      });
      headers = ["Date", "Type", "Severity", "Guard", "Site", "Description", "Status"];
      rows = exceptions.map((e) => [
        e.detectedAt.toISOString(),
        e.exceptionType,
        e.severity,
        e.employee ? `${e.employee.firstName} ${e.employee.lastName}` : "",
        e.site?.name ?? "",
        e.description,
        e.status,
      ]);
      summary = {
        completionRate: analytics.completionRate,
        absenteePercentage: analytics.absenteePercentage,
        lateArrivals: analytics.lateArrivals,
        missedClockIns: analytics.missedClockIns,
        missedClockOuts: analytics.missedClockOuts,
        absences: analytics.absences,
        total: exceptions.length,
      };
    } else if (type === "overtime") {
      const [approvedSheets, approvedOtRows, rawAttendances] = await Promise.all([
        prisma.siteTimesheet.findMany({
          where: {
            companyId: user.companyId,
            status: { in: ["approved", "locked"] },
            periodStart: { lte: endDateOnly },
            periodEnd: { gte: startDateOnly },
            ...(siteId ? { siteId } : {}),
            ...(clientId ? { site: { clientId } } : {}),
          },
          select: { siteId: true, periodStart: true, periodEnd: true },
        }),
        prisma.siteTimesheetRow.findMany({
          where: {
            companyId: user.companyId,
            workDate: { gte: startDateOnly, lte: endDateOnly },
            overtimeHours: { gt: 0 },
            actualGuardId: { not: null },
            siteTimesheet: { status: { in: ["approved", "locked"] } },
            ...(siteId ? { siteId } : {}),
            ...(employeeId ? { actualGuardId: employeeId } : {}),
            ...(clientId ? { site: { clientId } } : {}),
          },
          include: {
            actualGuard: { select: { firstName: true, lastName: true } },
            site: { select: { name: true } },
          },
          take: 1000,
        }),
        prisma.attendance.findMany({
          where: {
            overtimeHours: { gt: 0 },
            shift: {
              companyId: user.companyId,
              startTime: { gte: start, lte: end },
              ...(siteId ? { siteId } : {}),
              ...(employeeId ? { employeeId } : {}),
              ...(clientId ? { site: { clientId } } : {}),
            },
          },
          include: {
            shift: {
              include: {
                employee: { select: { firstName: true, lastName: true } },
                site: { select: { name: true } },
              },
            },
          },
          take: 1000,
        }),
      ]);
      const approvedCoverage = buildApprovedSiteDateCoverage(approvedSheets);
      const uncoveredRaw = rawAttendances.filter((a) => {
        const dk = dateKeyInTimeZone(a.shift.startTime, timeZone);
        return !approvedCoverage.has(`${a.shift.siteId}:${dk}`);
      });
      headers = ["Date", "Guard", "Site", "Hours Worked", "Overtime Hours"];
      rows = [
        ...approvedOtRows.map((r) => [
          r.workDate.toISOString().slice(0, 10),
          r.actualGuard ? `${r.actualGuard.firstName} ${r.actualGuard.lastName}` : "",
          r.site?.name ?? "",
          r.hoursWorked?.toString() ?? "",
          r.overtimeHours?.toString() ?? "",
        ]),
        ...uncoveredRaw.map((a) => [
          a.shift.startTime.toISOString(),
          a.shift.employee
            ? `${a.shift.employee.firstName} ${a.shift.employee.lastName}`
            : "",
          a.shift.site?.name ?? "",
          a.hoursWorked?.toString() ?? "",
          a.overtimeHours?.toString() ?? "",
        ]),
      ];
      summary = { total: rows.length };
    } else if (type === "leave") {
      const leaves = await prisma.leaveRequest.findMany({
        where: {
          companyId: user.companyId,
          startDate: { lte: end },
          endDate: { gte: start },
          ...(employeeId ? { employeeId } : {}),
        },
        include: {
          employee: { select: { firstName: true, lastName: true } },
        },
        take: 1000,
      });
      headers = ["Employee", "Type", "Period", "Units", "Status", "Reason"];
      rows = leaves.map((l) => [
        `${l.employee.firstName} ${l.employee.lastName}`,
        l.leaveType,
        `${l.startDate.toISOString().slice(0, 10)} - ${l.endDate.toISOString().slice(0, 10)}`,
        l.unitsRequested.toString(),
        l.status,
        l.reason ?? "",
      ]);
      summary = { total: leaves.length };
    } else if (type === "export-readiness" || type === "payroll-exceptions") {
      const company = await prisma.company.findUnique({
        where: { id: user.companyId },
        select: { settings: true },
      });
      const calendar = parsePayrollCalendarSettings(company?.settings);
      const periods = listPayPeriods(calendar, { before: 5, after: 0 }).reverse();
      const readiness = await Promise.all(
        periods.map((p) =>
          getPeriodExportReadiness(user.companyId, p.periodStart, p.periodEnd, p.periodKey)
        )
      );
      const openEx = await prisma.attendanceException.findMany({
        where: {
          companyId: user.companyId,
          status: { in: ["OPEN", "UNDER_REVIEW"] },
          severity: "CRITICAL",
        },
        include: {
          site: { select: { name: true } },
          employee: { select: { firstName: true, lastName: true } },
        },
        take: 500,
      });
      headers = ["Period Key", "Period Start", "Period End", "Readiness", "Open Exceptions"];
      rows = readiness.map((r) => [
        r.periodKey,
        r.periodStart.toISOString().slice(0, 10),
        r.periodEnd.toISOString().slice(0, 10),
        r.status,
        r.openExceptions,
      ]);
      summary = {
        blockedPeriods: readiness.filter((r) => r.status === "PENDING_ATTENDANCE_REVIEW").length,
        openCriticalExceptions: openEx.length,
        exceptions: openEx.map((e) => ({
          id: e.id,
          type: e.exceptionType,
          site: e.site?.name,
          guard: e.employee
            ? `${e.employee.firstName} ${e.employee.lastName}`
            : null,
        })),
      };
    } else if (type === "site-performance" || type === "client-monthly") {
      const sites = await prisma.site.findMany({
        where: {
          companyId: user.companyId,
          ...(siteId ? { id: siteId } : {}),
          ...(clientId ? { clientId } : {}),
        },
        select: {
          id: true,
          name: true,
          riskLevel: true,
          siteStatus: true,
          clientId: true,
          _count: { select: { assignedGuards: { where: { isActive: true } } } },
        },
      });
      headers = ["Site", "Status", "Risk", "Guards", "Shifts", "Attendance %"];
      rows = [];
      for (const site of sites) {
        const [shifts, approvedSheets, approvedWorkedRows, rawAttendances] = await Promise.all([
          prisma.shift.findMany({
            where: {
              companyId: user.companyId,
              siteId: site.id,
              startTime: { gte: start, lte: end },
            },
            select: { id: true, startTime: true },
          }),
          prisma.siteTimesheet.findMany({
            where: {
              companyId: user.companyId,
              siteId: site.id,
              status: { in: ["approved", "locked"] },
              periodStart: { lte: endDateOnly },
              periodEnd: { gte: startDateOnly },
            },
            select: { siteId: true, periodStart: true, periodEnd: true },
          }),
          prisma.siteTimesheetRow.count({
            where: {
              companyId: user.companyId,
              siteId: site.id,
              workDate: { gte: startDateOnly, lte: endDateOnly },
              siteTimesheet: { status: { in: ["approved", "locked"] } },
              attendanceStatus: {
                in: ["present", "late", "left_early", "reliever", "shift_swapped", "training"],
              },
            },
          }),
          prisma.shift.findMany({
            where: {
              companyId: user.companyId,
              siteId: site.id,
              startTime: { gte: start, lte: end },
              attendances: {
                some: {
                  clockIn: { not: null },
                  validationStatus: { not: "REJECTED_GEOFENCE" },
                },
              },
            },
            select: { id: true, startTime: true },
          }),
        ]);
        const siteCoverage = buildApprovedSiteDateCoverage(approvedSheets);
        const uncoveredAttended = rawAttendances.filter((s) => {
          const dk = dateKeyInTimeZone(s.startTime, timeZone);
          return !siteCoverage.has(`${site.id}:${dk}`);
        }).length;
        const attended = Math.min(shifts.length, approvedWorkedRows + uncoveredAttended);
        const pct = shifts.length > 0 ? Math.round((attended / shifts.length) * 1000) / 10 : 0;
        rows.push([
          site.name,
          site.siteStatus,
          site.riskLevel,
          site._count.assignedGuards,
          shifts.length,
          pct,
        ]);
      }
      summary = { sites: sites.length };
    } else if (type === "incidents") {
      const incidents = await prisma.incident.findMany({
        where: {
          companyId: user.companyId,
          incidentDateTime: { gte: start, lte: end },
          ...(siteId ? { siteId } : {}),
          ...(clientId ? { site: { clientId } } : {}),
          ...(q.clientVisible === "true" ? { clientVisible: true } : {}),
        },
        include: { site: { select: { name: true } } },
        orderBy: { incidentDateTime: "desc" },
        take: 1000,
      });
      headers = [
        "Number",
        "Date",
        "Site",
        "Type",
        "Severity",
        "Status",
        "Title",
        "Client Visible",
      ];
      rows = incidents.map((i) => [
        i.incidentNumber,
        i.incidentDateTime.toISOString(),
        i.site.name,
        i.incidentType,
        i.severity,
        i.status,
        i.title,
        i.clientVisible ? "Yes" : "No",
      ]);
      summary = { total: incidents.length };
    } else if (type === "equipment-inspections") {
      const docs = await prisma.managedDocument.findMany({
        where: {
          companyId: user.companyId,
          category: "EQUIPMENT",
          createdAt: { gte: start, lte: end },
          ...(siteId ? { siteId } : {}),
        },
        include: { site: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 1000,
      });
      headers = ["Date", "Title", "Type", "Site", "Status", "Expiry"];
      rows = docs.map((d) => [
        d.createdAt.toISOString(),
        d.title,
        d.documentType,
        d.site?.name ?? "",
        d.status,
        d.expiryDate?.toISOString().slice(0, 10) ?? "",
      ]);
      summary = { total: docs.length };
    } else if (type === "supervisor-activity") {
      const audits = await prisma.auditLog.findMany({
        where: {
          companyId: user.companyId,
          timestamp: { gte: start, lte: end },
          action: {
            in: [
              "attendance_exception.approve",
              "attendance_exception.reject",
              "incident.approve",
              "incident.reject",
              "incident.close",
              "approval.approve",
              "approval.reject",
              "alert.resolve",
            ],
          },
        },
        include: { user: { select: { name: true } } },
        orderBy: { timestamp: "desc" },
        take: 1000,
      });
      headers = ["Date", "Supervisor", "Action", "Entity", "Entity ID"];
      rows = audits.map((a) => [
        a.timestamp.toISOString(),
        a.user?.name ?? "",
        a.action,
        a.entityType,
        a.entityId ?? "",
      ]);
      summary = { total: audits.length };
    } else {
      return reply.code(404).send({
        error: "Not found",
        message: "Unknown report type. GET /reports/extended/types for the list.",
      });
    }

    if (format === "csv") {
      const csv = toCsv(headers, rows);
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="${type}-${start.toISOString().slice(0, 10)}.csv"`
        )
        .send(csv);
    }

    // Excel-compatible: same CSV with .xls disposition hint when requested
    if (format === "excel" || format === "xlsx") {
      const csv = toCsv(headers, rows);
      return reply
        .header("Content-Type", "application/vnd.ms-excel; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="${type}-${start.toISOString().slice(0, 10)}.xls"`
        )
        .send(csv);
    }

    if (format === "pdf") {
      // Lightweight printable HTML — clients can print to PDF; full branded PDF can reuse puppeteer later
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(type)}</title>
        <style>body{font-family:system-ui,sans-serif;padding:24px}table{border-collapse:collapse;width:100%;font-size:12px}
        th,td{border:1px solid #ccc;padding:6px;text-align:left}th{background:#f5f5f5}h1{font-size:18px}</style></head>
        <body><h1>Plethora — ${escapeHtml(type)}</h1><p>${escapeHtml(start.toISOString().slice(0, 10))} to ${escapeHtml(end.toISOString().slice(0, 10))}</p>
        <table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
        </body></html>`;
      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header(
          "Content-Disposition",
          `inline; filename="${type}-${start.toISOString().slice(0, 10)}.html"`
        )
        .send(html);
    }

    return reply.send({ type, start, end, summary, headers, rows });
  });
}
