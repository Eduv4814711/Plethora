/**
 * Payroll Reserve Service
 *
 * Provides management visibility into payroll burden and recommended reserves
 * for cashflow planning. Supports government-contract delayed payment scenarios.
 */

import { prisma } from "../lib/prisma.js";

export type ReserveDataSource = "paid" | "projected";

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
  /** Number of payroll periods used for burden calculation */
  periodsUsed: number;
  /** Whether figures come from paid history or calculated/approved runs */
  dataSource: ReserveDataSource;
}

export interface PayrollReserveOptions {
  /** Optional: available cash for gap calculation */
  availableCash?: number;
  /** Months to average for burden (default 3) */
  monthsToAverage?: number;
}

type ReserveRun = {
  periodEnd: Date;
  items: Array<{
    grossPay: { toString(): string } | number | string | null;
    payslip: {
      tax: { toString(): string } | number | string | null;
      uifEmployee: { toString(): string } | number | string | null;
      uifEmployer: { toString(): string } | number | string | null;
      sdl: { toString(): string } | number | string | null;
    } | null;
  }>;
};

const runInclude = {
  items: { include: { payslip: true } },
} as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function reserveCutoff(monthsToAverage: number): Date {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsToAverage);
  cutoff.setDate(1);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}

/** Load paid runs for reserve; fall back to calculated/approved when no paid history exists. */
export async function loadRunsForReserve(
  companyId: string,
  cutoff: Date
): Promise<{ runs: ReserveRun[]; dataSource: ReserveDataSource }> {
  const paidRuns = await prisma.payrollRun.findMany({
    where: {
      companyId,
      status: "paid",
      periodEnd: { gte: cutoff },
    },
    include: runInclude,
    orderBy: { periodEnd: "desc" },
  });

  if (paidRuns.length > 0) {
    return { runs: paidRuns, dataSource: "paid" };
  }

  const projectedRuns = await prisma.payrollRun.findMany({
    where: {
      companyId,
      status: { in: ["calculated", "approved"] },
      periodEnd: { gte: cutoff },
    },
    include: runInclude,
    orderBy: { periodEnd: "desc" },
  });

  return { runs: projectedRuns, dataSource: "projected" };
}

function computeMonthlyPayrollBurden(runs: ReserveRun[]): {
  monthlyPayrollBurden: number;
  periodsUsed: number;
} {
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

  const periodsUsed = monthlyBurden.size;
  if (periodsUsed === 0) {
    return { monthlyPayrollBurden: 0, periodsUsed: 0 };
  }

  const sumMonthly = [...monthlyBurden.values()].reduce((a, b) => a + b, 0);
  return {
    monthlyPayrollBurden: round2(sumMonthly / periodsUsed),
    periodsUsed,
  };
}

export function computeMonthlyStatutoryReserve(runs: ReserveRun[]): {
  statutoryReserve: number;
  threeMonthStatutoryReserve: number;
  periodsUsed: number;
} {
  const monthlyTotals = new Map<string, number>();

  for (const run of runs) {
    const monthKey = `${run.periodEnd.getFullYear()}-${String(run.periodEnd.getMonth() + 1).padStart(2, "0")}`;
    let monthTotal = monthlyTotals.get(monthKey) ?? 0;

    for (const item of run.items) {
      const pay = item.payslip;
      if (pay) {
        monthTotal += Number(pay.tax ?? 0);
        monthTotal += Number(pay.uifEmployee ?? 0);
        monthTotal += Number(pay.uifEmployer ?? 0);
        monthTotal += Number(pay.sdl ?? 0);
      }
    }
    monthlyTotals.set(monthKey, monthTotal);
  }

  const periodsUsed = monthlyTotals.size;
  if (periodsUsed === 0) {
    return { statutoryReserve: 0, threeMonthStatutoryReserve: 0, periodsUsed: 0 };
  }

  const sumMonthly = [...monthlyTotals.values()].reduce((a, b) => a + b, 0);
  const averageMonthlyStatutory = sumMonthly / periodsUsed;
  const statutoryReserve = round2(averageMonthlyStatutory);

  return {
    statutoryReserve,
    threeMonthStatutoryReserve: round2(averageMonthlyStatutory * 3),
    periodsUsed,
  };
}

/**
 * Get payroll reserve snapshot for management visibility.
 */
export async function getPayrollReserveSnapshot(
  companyId: string,
  options?: PayrollReserveOptions
): Promise<PayrollReserveSnapshot> {
  const monthsToAverage = options?.monthsToAverage ?? 3;
  const cutoff = reserveCutoff(monthsToAverage);
  const { runs, dataSource } = await loadRunsForReserve(companyId, cutoff);

  const { monthlyPayrollBurden, periodsUsed } = computeMonthlyPayrollBurden(runs);
  const { statutoryReserve } = computeMonthlyStatutoryReserve(runs);

  const oneMonthReserve = monthlyPayrollBurden;
  const threeMonthReserve = round2(monthlyPayrollBurden * 3);

  const snapshot: PayrollReserveSnapshot = {
    monthlyPayrollBurden,
    oneMonthReserve,
    threeMonthReserve,
    statutoryReserve,
    periodsUsed,
    dataSource,
  };

  if (options?.availableCash != null) {
    snapshot.reserveGap = round2(oneMonthReserve - options.availableCash);
  }

  return snapshot;
}
