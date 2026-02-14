import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { canTransitionPayroll } from "../lib/state-machines.js";
import type { PayrollStatus } from "@prisma/client";
import { config } from "../lib/config.js";

export class PayrollServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollServiceError";
  }
}

const STANDARD_HOURS = config.overtime.standardHoursPerDay;
const OT_MULTIPLIER = config.overtime.multiplier;

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

  const periodStart = run.periodStart;
  const periodEnd = run.periodEnd;

  const shiftsWithAttendance = await prisma.shift.findMany({
    where: {
      companyId,
      status: { in: ["completed", "verified"] },
      startTime: { gte: periodStart },
      endTime: { lte: periodEnd },
      attendances: {
        some: {
          clockIn: { not: null },
          clockOut: { not: null },
        },
      },
    },
    include: {
      employee: true,
      attendances: {
        where: {
          clockIn: { not: null },
          clockOut: { not: null },
        },
      },
    },
  });

  const employeeTotals = new Map<
    string,
    { hoursWorked: number; overtimeHours: number; hourlyRate: number }
  >();

  for (const shift of shiftsWithAttendance) {
    for (const att of shift.attendances) {
      const hoursWorked = att.hoursWorked != null ? Number(att.hoursWorked) : 0;
      const overtimeHours = att.overtimeHours != null ? Number(att.overtimeHours) : 0;

      const empId = shift.employeeId;
      const hourlyRate =
        shift.employee.hourlyRate != null
          ? Number(shift.employee.hourlyRate)
          : 50;

      const existing = employeeTotals.get(empId);
      if (existing) {
        existing.hoursWorked += hoursWorked;
        existing.overtimeHours += overtimeHours;
      } else {
        employeeTotals.set(empId, {
          hoursWorked,
          overtimeHours,
          hourlyRate,
        });
      }
    }
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.payrollItem.deleteMany({
      where: { payrollRunId },
    });

    for (const [employeeId, totals] of employeeTotals) {
      const basePay = totals.hoursWorked * totals.hourlyRate;
      const overtimePay =
        totals.overtimeHours * totals.hourlyRate * OT_MULTIPLIER;
      const deductions = 0;
      const netPay = basePay + overtimePay - deductions;

      await tx.payrollItem.create({
        data: {
          payrollRunId,
          employeeId,
          hoursWorked: totals.hoursWorked,
          overtimeHours: totals.overtimeHours,
          basePay,
          overtimePay,
          deductions,
          netPay,
        },
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
