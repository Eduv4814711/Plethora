import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { canTransitionPayroll } from "../lib/state-machines.js";
import type { PayrollStatus } from "@prisma/client";
import { aggregateTimesheets } from "./timesheet.service.js";
import { calculateDeductions } from "./deductions.service.js";
import type { PayPeriod } from "./tax.service.js";
import { getCompanyTimezone } from "../lib/timezone.js";
import {
  buildPayrollCalculationSnapshot,
  computePayrollLines,
  type PayrollCalculationContext,
  type PayrollDeductionResult,
} from "./payroll-calculation.engine.js";
import type { PayrollCalculationSnapshot } from "./payroll-calculation.types.js";

export class PayrollServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollServiceError";
  }
}

export interface CalculatePayrollResult {
  snapshot: PayrollCalculationSnapshot;
}

export async function calculatePayroll(
  payrollRunId: string,
  companyId: string
): Promise<CalculatePayrollResult> {
  const run = await prisma.payrollRun.findFirst({
    where: { id: payrollRunId, companyId },
  });

  if (!run) {
    throw new PayrollServiceError("Payroll run not found");
  }

  if (run.status !== "draft") {
    throw new PayrollServiceError(
      `Cannot calculate payroll in status ${run.status}. Must be draft.`
    );
  }

  if (run.lockedAt) {
    throw new PayrollServiceError("Payroll run is locked and cannot be modified.");
  }

  const periodStart = run.periodStart;
  const periodEnd = run.periodEnd;
  const calculatedAt = new Date();

  const [companyPayRules, companyEarningsRules, aggregates, employees, timezone, holidays] =
    await Promise.all([
      prisma.payRule.findMany({ where: { companyId } }),
      prisma.earningsRule.findMany({ where: { companyId, isActive: true } }),
      aggregateTimesheets(companyId, periodStart, periodEnd),
      prisma.employee.findMany({
        where: {
          companyId,
          status: { in: ["active", "training", "suspended"] },
        },
        include: {
          grade: true,
          siteAssignments: { take: 1, orderBy: { assignedAt: "asc" }, select: { siteId: true } },
          postAssignments: { take: 1, orderBy: { assignedAt: "asc" }, select: { postId: true } },
        },
      }),
      getCompanyTimezone(companyId),
      prisma.publicHoliday.findMany({
        where: { companyId, date: { gte: periodStart, lte: periodEnd } },
        select: { date: true },
      }),
    ]);

  const publicHolidayDates = holidays.map((h) =>
    new Date(h.date).toISOString().slice(0, 10)
  );

  const groupIds = [...new Set(employees.map((e) => e.groupId).filter(Boolean))] as string[];
  const [groupPayRulesList, groupEarningsRulesList] = await Promise.all([
    groupIds.length > 0
      ? prisma.groupPayRule.findMany({
          where: { groupId: { in: groupIds }, companyId },
        })
      : [],
    groupIds.length > 0
      ? prisma.groupEarningsRule.findMany({
          where: { groupId: { in: groupIds }, companyId, isActive: true },
        })
      : [],
  ]);

  const groupPayRulesByGroup = new Map<string, Map<string, number>>();
  for (const r of groupPayRulesList) {
    if (!groupPayRulesByGroup.has(r.groupId)) {
      groupPayRulesByGroup.set(r.groupId, new Map());
    }
    groupPayRulesByGroup.get(r.groupId)!.set(r.ruleType, Number(r.multiplier));
  }

  const groupEarningsByGroup = new Map<string, typeof groupEarningsRulesList>();
  for (const r of groupEarningsRulesList) {
    const list = groupEarningsByGroup.get(r.groupId) ?? [];
    list.push(r);
    groupEarningsByGroup.set(r.groupId, list);
  }

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { settings: true, sdlLiableFrom: true },
  });
  const settings = (company.settings as Record<string, unknown>) ?? {};
  const payPeriod = (settings.payrollPeriod as PayPeriod) ?? "monthly";
  const isSdlLiable = company.sdlLiableFrom != null;

  const ctxBase: Omit<PayrollCalculationContext, "deductionsByEmployee"> = {
    payrollRunId,
    companyId,
    periodStart,
    periodEnd,
    payPeriod,
    isSdlLiable,
    timezone,
    publicHolidayDates,
    companyPayRules: new Map(companyPayRules.map((r) => [r.ruleType, Number(r.multiplier)])),
    companyEarningsRules,
    groupPayRulesByGroup,
    groupEarningsByGroup,
    aggregates: new Map(aggregates.map((a) => [a.employeeId, a])),
    employees,
  };

  const grossPass = computePayrollLines({
    ...ctxBase,
    deductionsByEmployee: new Map(),
  });

  const deductionsByEmployee = new Map<string, PayrollDeductionResult>();
  for (const line of grossPass.lines) {
    const emp = employees.find((e) => e.id === line.employeeId);
    if (!emp) continue;
    const { total, lines: dedLines } = await calculateDeductions(
      companyId,
      emp.id,
      { employeeType: emp.employeeType },
      line.grossPay,
      periodStart,
      periodEnd,
      emp.groupId ?? undefined,
      ["UIF"]
    );
    deductionsByEmployee.set(emp.id, { total, lines: dedLines });
  }

  const { lines, employeeSnapshots } = computePayrollLines({
    ...ctxBase,
    deductionsByEmployee,
  });
  const snapshot = buildPayrollCalculationSnapshot({
    ctx: { ...ctxBase, deductionsByEmployee },
    employeeSnapshots,
    lines,
    calculatedAt,
  });

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.payslip.deleteMany({
      where: { payrollItem: { payrollRunId } },
    });
    await tx.payrollItem.deleteMany({
      where: { payrollRunId },
    });

    await tx.timesheet.updateMany({
      where: { companyId, periodStart, payrollRunId },
      data: { payrollRunId: null },
    });

    for (const item of lines) {
      const payrollItem = await tx.payrollItem.create({
        data: {
          payrollRunId,
          employeeId: item.employeeId,
          hoursWorked: item.hoursWorked,
          overtimeHours: item.overtimeHours,
          basePay: item.basePay,
          overtimePay: item.overtimePay,
          sundayPay: item.sundayPay,
          publicHolidayPay: item.publicHolidayPay,
          grossPay: item.grossPay,
          deductions: item.deductions,
          netPay: item.netPay,
        },
      });

      await tx.payslip.create({
        data: {
          payrollItemId: payrollItem.id,
          earnings: item.earningsLines,
          deductions: item.deductionLines,
          grossPay: item.grossPay,
          totalDeductions: item.deductions,
          netPay: item.netPay,
          tax: item.tax,
          taxableEarnings: item.taxableEarnings,
          uifEmployee: item.uifEmployee,
          uifEmployer: item.uifEmployer,
          sdl: item.sdl,
        },
      });
    }

    for (const agg of aggregates) {
      if (!lines.some((i) => i.employeeId === agg.employeeId)) continue;
      await tx.timesheet.upsert({
        where: {
          companyId_employeeId_periodStart: {
            companyId,
            employeeId: agg.employeeId,
            periodStart,
          },
        },
        create: {
          companyId,
          employeeId: agg.employeeId,
          periodStart,
          periodEnd,
          basicHours: agg.basicHours,
          overtimeHours: agg.overtimeHours,
          sundayHours: agg.sundayHours,
          publicHolidayHours: agg.publicHolidayHours,
          leaveDays: agg.leaveDays,
          payrollRunId,
        },
        update: { payrollRunId },
      });
    }

    await tx.payrollRun.update({
      where: { id: payrollRunId },
      data: {
        status: "calculated",
        calculatedAt,
        calculationSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
  });

  return { snapshot };
}

export function canTransitionPayrollStatus(
  from: PayrollStatus,
  to: PayrollStatus
): boolean {
  return canTransitionPayroll(from, to);
}
