import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { canTransitionPayroll } from "../lib/state-machines.js";
import type { PayrollStatus } from "@prisma/client";
import { aggregateTimesheets } from "./timesheet.service.js";
import { calculateDeductions } from "./deductions.service.js";
import {
  calculatePAYE,
  calculateUIF,
  calculateSDL,
  type PayPeriod,
} from "./tax.service.js";

export class PayrollServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollServiceError";
  }
}

const DEFAULT_OT_MULTIPLIER = 1.5;
const DEFAULT_SUNDAY_MULTIPLIER = 2.0;
const DEFAULT_PUBLIC_HOLIDAY_MULTIPLIER = 2.0;

export async function calculatePayroll(
  payrollRunId: string,
  companyId: string
): Promise<void> {
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

  const [companyPayRules, companyEarningsRules, aggregates, employees] = await Promise.all([
    prisma.payRule.findMany({ where: { companyId } }),
    prisma.earningsRule.findMany({ where: { companyId, isActive: true } }),
    aggregateTimesheets(companyId, periodStart, periodEnd),
    prisma.employee.findMany({
      where: {
        companyId,
        status: { in: ["active", "training", "suspended"] },
      },
      include: { grade: true },
    }),
  ]);

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

  const companyRuleMap = new Map(companyPayRules.map((r) => [r.ruleType, Number(r.multiplier)]));
  const aggMap = new Map(aggregates.map((a) => [a.employeeId, a]));

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { settings: true, sdlLiableFrom: true },
  });
  const settings = (company.settings as Record<string, unknown>) ?? {};
  const payPeriod = (settings.payrollPeriod as PayPeriod) ?? "monthly";
  const isSdlLiable = company.sdlLiableFrom != null;

  const itemsToCreate: Array<{
    employeeId: string;
    employee: (typeof employees)[0];
    hoursWorked: number;
    overtimeHours: number;
    basePay: number;
    overtimePay: number;
    sundayPay: number;
    publicHolidayPay: number;
    grossPay: number;
    deductions: number;
    netPay: number;
    earningsLines: Array<{ name: string; amount: number }>;
    deductionLines: Array<{ name: string; amount: number }>;
    tax: number;
    taxableEarnings: number;
    uifEmployee: number;
    uifEmployer: number;
    sdl: number;
  }> = [];

  for (const emp of employees) {
    const payRuleMap =
      emp.groupId != null
        ? groupPayRulesByGroup.get(emp.groupId) ?? companyRuleMap
        : companyRuleMap;
    const otMult = payRuleMap.get("overtime") ?? DEFAULT_OT_MULTIPLIER;
    const sundayMult = payRuleMap.get("sunday") ?? DEFAULT_SUNDAY_MULTIPLIER;
    const phMult = payRuleMap.get("public_holiday") ?? DEFAULT_PUBLIC_HOLIDAY_MULTIPLIER;

    const earningsRules =
      emp.groupId != null
        ? groupEarningsByGroup.get(emp.groupId) ?? companyEarningsRules
        : companyEarningsRules;

    const hourlyRate =
      emp.grade != null
        ? Number(emp.grade.hourlyRate)
        : emp.hourlyRate != null
          ? Number(emp.hourlyRate)
          : 0;
    const monthlySalary = emp.monthlySalary != null ? Number(emp.monthlySalary) : 0;

    let hoursWorked = 0;
    let overtimeHours = 0;
    let basePay = 0;
    let overtimePay = 0;
    let sundayPay = 0;
    let publicHolidayPay = 0;
    let grossPay = 0;
    const earningsLines: Array<{ name: string; amount: number }> = [];

    if (emp.employeeType === "office" && monthlySalary > 0) {
      grossPay = monthlySalary;
      earningsLines.push({ name: "Basic Salary", amount: monthlySalary });
    } else {
      const agg = aggMap.get(emp.id);
      if (!agg || (agg.basicHours === 0 && agg.overtimeHours === 0 && agg.sundayHours === 0 && agg.publicHolidayHours === 0)) {
        continue;
      }

      hoursWorked = agg.basicHours;
      overtimeHours = agg.overtimeHours;
      basePay = agg.basicHours * hourlyRate;
      overtimePay = agg.overtimeHours * hourlyRate * otMult;
      sundayPay = agg.sundayHours * hourlyRate * sundayMult;
      publicHolidayPay = agg.publicHolidayHours * hourlyRate * phMult;
      grossPay = basePay + overtimePay + sundayPay + publicHolidayPay;

      basePay = Math.round(basePay * 100) / 100;
      overtimePay = Math.round(overtimePay * 100) / 100;
      sundayPay = Math.round(sundayPay * 100) / 100;
      publicHolidayPay = Math.round(publicHolidayPay * 100) / 100;
      grossPay = Math.round(grossPay * 100) / 100;

      if (basePay > 0) earningsLines.push({ name: "Basic", amount: basePay });
      if (overtimePay > 0) earningsLines.push({ name: "Overtime", amount: overtimePay });
      if (sundayPay > 0) earningsLines.push({ name: "Sunday", amount: sundayPay });
      if (publicHolidayPay > 0) earningsLines.push({ name: "Public Holiday", amount: publicHolidayPay });
    }

    const empType = emp.employeeType ?? "security";
    const baseForPct = emp.employeeType === "office" ? grossPay : basePay;
    for (const er of earningsRules) {
      const applies =
        er.appliesTo === "all" ||
        (er.appliesTo === "security" && empType !== "office") ||
        (er.appliesTo === "office" && empType === "office");
      if (!applies) continue;

      let amount = 0;
      if (er.type === "fixed" && er.amount != null) {
        amount = Number(er.amount);
      } else if (er.type === "percentage" && er.rate != null && baseForPct > 0) {
        amount = (Number(er.rate) / 100) * baseForPct;
      }
      if (amount > 0) {
        amount = Math.round(amount * 100) / 100;
        grossPay += amount;
        earningsLines.push({ name: er.name, amount });
      }
    }
    grossPay = Math.round(grossPay * 100) / 100;

    const taxableEarnings = grossPay;
    const paye = calculatePAYE(taxableEarnings, payPeriod, emp);
    const { employee: uifEmployee, employer: uifEmployer } = calculateUIF(grossPay);
    const sdl = calculateSDL(grossPay, isSdlLiable);

    const { total: otherDeductions, lines: otherDeductionLines } = await calculateDeductions(
      companyId,
      emp.id,
      { employeeType: emp.employeeType },
      grossPay,
      periodStart,
      periodEnd,
      emp.groupId ?? undefined,
      ["UIF"]
    );

    const deductionLines: Array<{ name: string; amount: number }> = [...otherDeductionLines];
    if (paye > 0) deductionLines.push({ name: "PAYE", amount: paye });
    if (uifEmployee > 0) deductionLines.push({ name: "UIF", amount: uifEmployee });
    const totalDeductions = otherDeductions + paye + uifEmployee;

    const netPay = Math.round((grossPay - totalDeductions) * 100) / 100;

    itemsToCreate.push({
      employeeId: emp.id,
      employee: emp,
      hoursWorked,
      overtimeHours,
      basePay,
      overtimePay,
      sundayPay,
      publicHolidayPay,
      grossPay,
      deductions: totalDeductions,
      netPay,
      earningsLines,
      deductionLines,
      tax: paye,
      taxableEarnings,
      uifEmployee,
      uifEmployer,
      sdl,
    });
  }

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

    for (const item of itemsToCreate) {
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
      if (!itemsToCreate.some((i) => i.employeeId === agg.employeeId)) continue;
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
      data: { status: "calculated" },
    });
  });
}

export function canTransitionPayrollStatus(
  from: PayrollStatus,
  to: PayrollStatus
): boolean {
  return canTransitionPayroll(from, to);
}
