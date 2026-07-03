import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { canTransitionPayroll } from "../lib/state-machines.js";
import type { PayrollStatus } from "@prisma/client";
import { aggregateTimesheets, type TimesheetAggregate } from "./timesheet.service.js";
import { calculateDeductions } from "./deductions.service.js";
import { exceedsSdlThreshold, type PayPeriod } from "./tax.service.js";
import { getCompanyTimezone, dateKeyInTimeZone } from "../lib/timezone.js";
import { parsePayrollSettings } from "../lib/payroll-settings.js";
import { SDL_THRESHOLD_ANNUAL } from "../lib/tax-brackets.js";
import { getRolling12MonthPayroll } from "./sdl-tracking.service.js";
import {
  buildPayrollCalculationSnapshot,
  computePayrollLines,
  type PayrollCalculationContext,
  type PayrollDeductionResult,
} from "./payroll-calculation.engine.js";
import type {
  PayrollCalculationSnapshot,
  PayrollSdlStatusSnapshot,
} from "./payroll-calculation.types.js";

export class PayrollServiceError extends Error {
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "PayrollServiceError";
    this.details = details;
  }
}

/**
 * Sites that have shift activity in the period but whose site timesheet is not yet
 * approved/locked. Payroll must not run until attendance is verified for all of them.
 */
export async function findSitesNeedingApproval(
  companyId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<Array<{ id: string; name: string }>> {
  // Only worked shifts can contribute payable hours (matches aggregateTimesheets),
  // so only they require an approved site timesheet. Planned-but-unworked shifts
  // (created/assigned/active) must not block payroll for the whole company.
  const shifts = await prisma.shift.findMany({
    where: {
      companyId,
      status: { in: ["completed", "verified"] },
      startTime: { lt: periodEnd },
      endTime: { gt: periodStart },
    },
    select: { siteId: true },
    distinct: ["siteId"],
  });
  const siteIds = shifts.map((s) => s.siteId);
  if (siteIds.length === 0) return [];

  const approved = await prisma.siteTimesheet.findMany({
    where: {
      companyId,
      siteId: { in: siteIds },
      status: { in: ["approved", "locked"] },
      periodStart: { lte: periodEnd },
      periodEnd: { gte: periodStart },
    },
    select: { siteId: true },
  });
  const approvedSet = new Set(approved.map((a) => a.siteId));
  const missingIds = siteIds.filter((id) => !approvedSet.has(id));
  if (missingIds.length === 0) return [];

  return prisma.site.findMany({
    where: { id: { in: missingIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export interface CalculatePayrollResult {
  snapshot: PayrollCalculationSnapshot;
}

const employeeInclude = {
  grade: true,
  siteAssignments: { take: 1, orderBy: { assignedAt: "asc" as const }, select: { siteId: true } },
  // Post membership lives on GuardSiteEligibility (primary post first).
  guardSiteEligibilities: {
    take: 1,
    orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
    select: { sitePostId: true },
  },
};

/**
 * Standard payroll cohort plus relievers who worked approved shifts or leave in the period.
 * Relievers are never included solely because of status — only when they have period activity.
 */
export async function loadEmployeesForPayroll(
  companyId: string,
  aggregates: TimesheetAggregate[],
  includeRelieversWithAttendance: boolean
) {
  const baseEmployees = await prisma.employee.findMany({
    where: {
      companyId,
      status: { in: ["active", "training", "suspended"] },
    },
    include: employeeInclude,
  });

  if (!includeRelieversWithAttendance) {
    return baseEmployees;
  }

  const baseIds = new Set(baseEmployees.map((e) => e.id));
  const relieverIds = aggregates
    .map((a) => a.employeeId)
    .filter((id) => !baseIds.has(id));

  if (relieverIds.length === 0) {
    return baseEmployees;
  }

  const relievers = await prisma.employee.findMany({
    where: {
      companyId,
      status: "reliever",
      id: { in: relieverIds },
    },
    include: employeeInclude,
  });

  return [...baseEmployees, ...relievers];
}

function buildSdlStatus(params: {
  rolling12MonthPayroll: number;
  projectedRunGross: number;
  sdlLiableFrom: Date | null;
  includeRelieversWithAttendance: boolean;
}): PayrollSdlStatusSnapshot {
  const projectedRolling12Month =
    Math.round((params.rolling12MonthPayroll + params.projectedRunGross) * 100) / 100;
  const isLiable =
    params.sdlLiableFrom != null || exceedsSdlThreshold(projectedRolling12Month);

  return {
    isLiable,
    liableFrom: params.sdlLiableFrom?.toISOString() ?? null,
    rolling12MonthPayroll: Math.round(params.rolling12MonthPayroll * 100) / 100,
    projectedRolling12Month,
    threshold: SDL_THRESHOLD_ANNUAL,
    includeRelieversWithAttendance: params.includeRelieversWithAttendance,
  };
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

  const sitesNeedingApproval = await findSitesNeedingApproval(companyId, periodStart, periodEnd);
  if (sitesNeedingApproval.length > 0) {
    const names = sitesNeedingApproval.map((s) => s.name).join(", ");
    throw new PayrollServiceError(
      `Cannot calculate payroll until attendance is approved for every site with shifts in this period. ` +
        `Approve the site timesheet(s) for: ${names}.`,
      { sitesNeedingApproval }
    );
  }

  const [companyPayRules, companyEarningsRules, aggregates, timezone, holidays, company, rolling12MonthPayroll] =
    await Promise.all([
      prisma.payRule.findMany({ where: { companyId } }),
      prisma.earningsRule.findMany({ where: { companyId, isActive: true } }),
      aggregateTimesheets(companyId, periodStart, periodEnd),
      getCompanyTimezone(companyId),
      prisma.publicHoliday.findMany({
        where: { companyId, date: { gte: periodStart, lte: periodEnd } },
        select: { date: true },
      }),
      prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { settings: true, sdlLiableFrom: true },
      }),
      getRolling12MonthPayroll(companyId),
    ]);

  const payrollSettings = parsePayrollSettings(company.settings);
  const employees = await loadEmployeesForPayroll(
    companyId,
    aggregates,
    payrollSettings.includeRelieversWithAttendance
  );

  const publicHolidayDates = holidays.map((h) =>
    dateKeyInTimeZone(new Date(h.date), timezone)
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

  const settings = (company.settings as Record<string, unknown>) ?? {};
  const payPeriod = (settings.payrollPeriod as PayPeriod) ?? "monthly";

  const ctxBase: Omit<PayrollCalculationContext, "deductionsByEmployee" | "isSdlLiable"> = {
    payrollRunId,
    companyId,
    periodStart,
    periodEnd,
    payPeriod,
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
    isSdlLiable: false,
    deductionsByEmployee: new Map(),
  });

  const projectedRunGross = grossPass.lines.reduce((sum, line) => sum + line.grossPay, 0);
  const sdlStatus = buildSdlStatus({
    rolling12MonthPayroll,
    projectedRunGross,
    sdlLiableFrom: company.sdlLiableFrom,
    includeRelieversWithAttendance: payrollSettings.includeRelieversWithAttendance,
  });
  const isSdlLiable = sdlStatus.isLiable;

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
    isSdlLiable,
    deductionsByEmployee,
  });

  const snapshot = buildPayrollCalculationSnapshot({
    ctx: { ...ctxBase, isSdlLiable, deductionsByEmployee },
    employeeSnapshots,
    lines,
    calculatedAt,
    sdlStatus,
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
  }, { timeout: 120_000, maxWait: 30_000 });

  return { snapshot };
}

/** Revert a calculated or approved (unpaid) payroll run back to draft for recalculation. */
export async function revertPayrollToDraft(
  payrollRunId: string,
  companyId: string,
  reason: string
): Promise<void> {
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 5) {
    throw new PayrollServiceError("A revert reason of at least 5 characters is required.");
  }

  const run = await prisma.payrollRun.findFirst({
    where: { id: payrollRunId, companyId },
  });

  if (!run) {
    throw new PayrollServiceError("Payroll run not found");
  }

  if (run.status === "paid") {
    throw new PayrollServiceError(
      "Paid payroll runs cannot be reverted. Create a correction run instead."
    );
  }

  if (run.status === "draft") {
    throw new PayrollServiceError("Payroll run is already in draft status.");
  }

  if (!canTransitionPayroll(run.status, "draft")) {
    throw new PayrollServiceError(
      `Cannot revert payroll in status ${run.status}.`
    );
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.payslip.deleteMany({
      where: { payrollItem: { payrollRunId } },
    });
    await tx.payrollItem.deleteMany({
      where: { payrollRunId },
    });

    await tx.timesheet.updateMany({
      where: { companyId, periodStart: run.periodStart, payrollRunId },
      data: { payrollRunId: null },
    });

    await tx.payrollRun.update({
      where: { id: payrollRunId },
      data: {
        status: "draft",
        lockedAt: null,
        calculatedAt: null,
        calculationSnapshot: Prisma.DbNull,
      },
    });
  });
}

export function canTransitionPayrollStatus(
  from: PayrollStatus,
  to: PayrollStatus
): boolean {
  return canTransitionPayroll(from, to);
}
