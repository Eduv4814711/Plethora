/**
 * Payroll Reserve Service
 *
 * Provides management visibility into payroll burden and recommended reserves
 * for cashflow planning. Supports government-contract delayed payment scenarios.
 */

import { prisma } from "../lib/prisma.js";
import { estimateTaxReserve } from "./payroll-statutory.service.js";

export interface PayrollReserveSnapshot {
  /** Current/average monthly payroll burden (gross + statutory) */
  monthlyPayrollBurden: number;
  /** Recommended 1-month reserve */
  oneMonthReserve: number;
  /** Recommended 3-month reserve */
  threeMonthReserve: number;
  /** Statutory reserve (PAYE + UIF + SDL) for 1 month */
  statutoryReserve: number;
  /** Gap between recommended reserve and available cash (if provided) */
  reserveGap?: number;
  /** Number of paid runs used for burden calculation */
  periodsUsed: number;
}

export interface PayrollReserveOptions {
  /** Optional: available cash for gap calculation */
  availableCash?: number;
  /** Months to average for burden (default 3) */
  monthsToAverage?: number;
}

/**
 * Get payroll reserve snapshot for management visibility.
 */
export async function getPayrollReserveSnapshot(
  companyId: string,
  options?: PayrollReserveOptions
): Promise<PayrollReserveSnapshot> {
  const monthsToAverage = options?.monthsToAverage ?? 3;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsToAverage);
  cutoff.setDate(1);
  cutoff.setHours(0, 0, 0, 0);

  const runs = await prisma.payrollRun.findMany({
    where: {
      companyId,
      status: "paid",
      periodEnd: { gte: cutoff },
    },
    include: { items: { include: { payslip: true } } },
    orderBy: { periodEnd: "desc" },
  });

  const monthlyBurden = new Map<string, number>();

  for (const run of runs) {
    const monthKey = `${run.periodEnd.getFullYear()}-${String(run.periodEnd.getMonth() + 1).padStart(2, "0")}`;
    let monthTotal = monthlyBurden.get(monthKey) ?? 0;

    for (const item of run.items) {
      monthTotal += Number(item.grossPay);
      const pay = item.payslip;
      if (pay) {
        monthTotal += Number(pay.tax ?? 0);
        monthTotal += Number(pay.uifEmployee ?? 0);
        monthTotal += Number(pay.uifEmployer ?? 0);
        monthTotal += Number(pay.sdl ?? 0);
      }
    }
    monthlyBurden.set(monthKey, monthTotal);
  }

  const periodsUsed = monthlyBurden.size || 1;
  const sumMonthly = [...monthlyBurden.values()].reduce((a, b) => a + b, 0);
  const monthlyPayrollBurden = sumMonthly / periodsUsed;

  const taxReserve = await estimateTaxReserve(companyId, { monthsToAverage });

  const oneMonthReserve = Math.round(monthlyPayrollBurden * 100) / 100;
  const threeMonthReserve = Math.round(monthlyPayrollBurden * 3 * 100) / 100;

  const snapshot: PayrollReserveSnapshot = {
    monthlyPayrollBurden: Math.round(monthlyPayrollBurden * 100) / 100,
    oneMonthReserve,
    threeMonthReserve,
    statutoryReserve: taxReserve.oneMonthReserve,
    periodsUsed,
  };

  if (options?.availableCash != null) {
    snapshot.reserveGap = Math.round((oneMonthReserve - options.availableCash) * 100) / 100;
  }

  return snapshot;
}
