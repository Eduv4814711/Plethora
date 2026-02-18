import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { canTransitionPayroll } from "../lib/state-machines.js";
import type { PayrollStatus } from "@prisma/client";
import { aggregateTimesheets } from "./timesheet.service.js";
import { calculateDeductions } from "./deductions.service.js";

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

  const payRules = await prisma.payRule.findMany({
    where: { companyId },
  });
  const earningsRules = await prisma.earningsRule.findMany({
    where: { companyId, isActive: true },
  });
  const ruleMap = new Map(payRules.map((r) => [r.ruleType, Number(r.multiplier)]));
  const otMult = ruleMap.get("overtime") ?? DEFAULT_OT_MULTIPLIER;
  const sundayMult = ruleMap.get("sunday") ?? DEFAULT_SUNDAY_MULTIPLIER;
  const phMult = ruleMap.get("public_holiday") ?? DEFAULT_PUBLIC_HOLIDAY_MULTIPLIER;

  const aggregates = await aggregateTimesheets(companyId, periodStart, periodEnd);
  const aggMap = new Map(aggregates.map((a) => [a.employeeId, a]));

  const employees = await prisma.employee.findMany({
    where: {
      companyId,
      status: { in: ["active", "training", "suspended"] },
    },
    include: { grade: true },
  });

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
  }> = [];

  for (const emp of employees) {
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

    const { total: totalDeductions, lines: deductionLines } = await calculateDeductions(
      companyId,
      emp.id,
      { employeeType: emp.employeeType },
      grossPay,
      periodStart,
      periodEnd
    );

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
