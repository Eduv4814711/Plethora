/**
 * Payroll Intelligence / Management Reporting Routes
 *
 * Exposes summary endpoints for dashboards and decision support.
 */

import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { getEmployeeCostBreakdownsForRun } from "../services/payroll-cost.service.js";
import {
  getStatutorySummaryForRun,
  getStatutorySummaryForMonth,
  estimateTaxReserve,
} from "../services/payroll-statutory.service.js";
import { getContractLabourCost } from "../services/contract-labour-cost.service.js";
import {
  runPayrollComplianceChecks,
  complianceResultsToRiskFlags,
} from "../services/payroll-compliance/payroll-compliance.service.js";
import { getPayrollReserveSnapshot } from "../services/payroll-reserve.service.js";

const CORE_EARNINGS = ["Basic", "Basic Salary", "Overtime", "Sunday", "Public Holiday"];

export async function payrollIntelligenceRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "operations_manager", "hr_payroll"])];

  app.get("/runs/:id/summary", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        items: {
          include: { employee: true, payslip: true },
        },
      },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    let totalGrossPay = 0;
    let totalNetPay = 0;
    let totalOvertime = 0;
    let totalAllowances = 0;
    let totalDeductions = 0;
    let totalPAYE = 0;
    let totalUIF = 0;
    let totalSDL = 0;

    for (const item of run.items) {
      totalGrossPay += Number(item.grossPay);
      totalNetPay += Number(item.netPay);
      totalOvertime += Number(item.overtimePay ?? 0);
      totalDeductions += Number(item.deductions);

      const earnings = (item.payslip?.earnings as Array<{ name: string; amount: number }>) ?? [];
      const allowances = earnings
        .filter((e) => !CORE_EARNINGS.some((c) => e.name.toLowerCase().includes(c.toLowerCase())))
        .reduce((sum, e) => sum + (e.amount ?? 0), 0);
      totalAllowances += allowances;

      if (item.payslip) {
        totalPAYE += Number(item.payslip.tax ?? 0);
        totalUIF += Number(item.payslip.uifEmployee ?? 0) + Number(item.payslip.uifEmployer ?? 0);
        totalSDL += Number(item.payslip.sdl ?? 0);
      }
    }

    const complianceResults = await runPayrollComplianceChecks(id, user.companyId);
    const criticalCount = complianceResults.filter((r) => r.severity === "critical").length;
    const warningCount = complianceResults.filter((r) => r.severity === "warning").length;

    return reply.send({
      payrollRunId: id,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: run.status,
      totalGrossPay: Math.round(totalGrossPay * 100) / 100,
      totalNetPay: Math.round(totalNetPay * 100) / 100,
      totalOvertime: Math.round(totalOvertime * 100) / 100,
      totalAllowances: Math.round(totalAllowances * 100) / 100,
      totalDeductions: Math.round(totalDeductions * 100) / 100,
      totalPAYE: Math.round(totalPAYE * 100) / 100,
      totalUIF: Math.round(totalUIF * 100) / 100,
      totalSDL: Math.round(totalSDL * 100) / 100,
      employeeCount: run.items.length,
      complianceIssueCount: complianceResults.length,
      criticalComplianceCount: criticalCount,
      warningComplianceCount: warningCount,
    });
  });

  app.get("/runs/:id/compliance", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    const results = await runPayrollComplianceChecks(id, user.companyId);
    const riskFlags = complianceResultsToRiskFlags(id, results);

    return reply.send({
      payrollRunId: id,
      results,
      riskFlags,
    });
  });

  app.get("/contracts/labour-cost", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { periodStart?: string; periodEnd?: string };

    const periodStart = q.periodStart ? new Date(q.periodStart) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const periodEnd = q.periodEnd ? new Date(q.periodEnd) : new Date();

    if (periodStart >= periodEnd) {
      return reply.code(400).send({
        error: "Invalid period",
        message: "periodEnd must be after periodStart",
      });
    }

    const result = await getContractLabourCost(user.companyId, periodStart, periodEnd);

    return reply.send(result);
  });

  app.get("/employees/cost-summary", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { payrollRunId?: string };

    if (!q.payrollRunId) {
      return reply.code(400).send({
        error: "Missing parameter",
        message: "payrollRunId is required",
      });
    }

    const run = await prisma.payrollRun.findFirst({
      where: { id: q.payrollRunId, companyId: user.companyId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    const breakdowns = await getEmployeeCostBreakdownsForRun(q.payrollRunId, user.companyId);

    const employeeIds = breakdowns.map((b) => b.employeeId);
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds }, companyId: user.companyId },
      select: { id: true, firstName: true, lastName: true, employeeNumber: true },
    });
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const summary = breakdowns.map((b) => {
      const emp = empMap.get(b.employeeId);
      return {
        employeeId: b.employeeId,
        employeeName: emp ? `${emp.firstName} ${emp.lastName}`.trim() : null,
        employeeNumber: emp?.employeeNumber ?? null,
        basePay: b.basePay,
        overtimePay: b.overtimePay,
        allowances: b.allowances,
        deductions: b.deductions,
        totalEmployerCost: b.totalEmployerCost,
        grossPay: b.grossPay,
        netPay: b.netPay,
      };
    });

    return reply.send({
      payrollRunId: q.payrollRunId,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      employees: summary,
    });
  });

  app.get("/reserve", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { availableCash?: string };

    const availableCash = q.availableCash != null ? parseFloat(q.availableCash) : undefined;

    const snapshot = await getPayrollReserveSnapshot(user.companyId, {
      availableCash: !Number.isNaN(availableCash!) ? availableCash : undefined,
    });

    return reply.send(snapshot);
  });

  app.get("/statutory", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { period?: string; payrollRunId?: string };

    if (q.payrollRunId) {
      const summary = await getStatutorySummaryForRun(q.payrollRunId, user.companyId);
      if (!summary) {
        return reply.code(404).send({ error: "Payroll run not found" });
      }
      return reply.send(summary);
    }

    const period = q.period ?? new Date().toISOString().slice(0, 7);
    const [yearStr, monthStr] = period.split("-");
    const year = parseInt(yearStr ?? "0", 10);
    const month = parseInt(monthStr ?? "0", 10);

    if (!year || !month || month < 1 || month > 12) {
      return reply.code(400).send({
        error: "Invalid period",
        message: "Use period=YYYY-MM (e.g. 2025-03) or payrollRunId",
      });
    }

    const summary = await getStatutorySummaryForMonth(user.companyId, year, month);
    if (!summary) {
      return reply.send({
        period: `${year}-${String(month).padStart(2, "0")}`,
        payeTotal: 0,
        uifTotal: 0,
        sdlTotal: 0,
        totalStatutory: 0,
        uifEmployee: 0,
        uifEmployer: 0,
        payrollRunIds: [],
        message: "No paid payroll runs in this period",
      });
    }

    return reply.send(summary);
  });

  app.get("/statutory/reserve-estimate", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { monthsToAverage?: string };

    const monthsToAverage = q.monthsToAverage ? parseInt(q.monthsToAverage, 10) : undefined;

    const estimate = await estimateTaxReserve(user.companyId, {
      monthsToAverage: !Number.isNaN(monthsToAverage!) ? monthsToAverage : undefined,
    });

    return reply.send(estimate);
  });
}
