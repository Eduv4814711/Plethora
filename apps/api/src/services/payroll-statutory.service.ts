/**
 * Payroll Statutory Summary Service & Tax Reserve Estimator
 *
 * Provides visibility into PAYE, UIF, SDL totals from payroll output.
 * Supports per-run and per-month summaries.
 */

import { prisma } from "../lib/prisma.js";

export interface PayrollStatutorySummary {
  /** Payroll run ID (if run-specific) */
  payrollRunId?: string;
  /** Period label (YYYY-MM) */
  period?: string;
  /** Total PAYE */
  payeTotal: number;
  /** Total UIF (employee + employer) */
  uifTotal: number;
  /** Total SDL */
  sdlTotal: number;
  /** Combined statutory liability */
  totalStatutory: number;
  /** Employee UIF portion */
  uifEmployee: number;
  /** Employer UIF portion */
  uifEmployer: number;
  /** Payroll run IDs included in aggregation */
  payrollRunIds: string[];
}

export interface TaxReserveEstimate {
  /** One month statutory reserve */
  oneMonthReserve: number;
  /** Three month statutory reserve */
  threeMonthReserve: number;
  /** Average monthly statutory from recent paid runs */
  averageMonthlyStatutory: number;
  /** Periods used for average (e.g. last 3 months) */
  periodsUsed: number;
}

/**
 * Get statutory summary for a specific payroll run.
 */
export async function getStatutorySummaryForRun(
  payrollRunId: string,
  companyId: string
): Promise<PayrollStatutorySummary | null> {
  const run = await prisma.payrollRun.findFirst({
    where: { id: payrollRunId, companyId },
    include: { items: { include: { payslip: true } } },
  });

  if (!run) return null;

  let payeTotal = 0;
  let uifEmployee = 0;
  let uifEmployer = 0;
  let sdlTotal = 0;

  for (const item of run.items) {
    const pay = item.payslip;
    if (pay) {
      payeTotal += Number(pay.tax ?? 0);
      uifEmployee += Number(pay.uifEmployee ?? 0);
      uifEmployer += Number(pay.uifEmployer ?? 0);
      sdlTotal += Number(pay.sdl ?? 0);
    }
  }

  const uifTotal = uifEmployee + uifEmployer;
  const totalStatutory = payeTotal + uifTotal + sdlTotal;

  return {
    payrollRunId,
    period: undefined,
    payeTotal: Math.round(payeTotal * 100) / 100,
    uifTotal: Math.round(uifTotal * 100) / 100,
    sdlTotal: Math.round(sdlTotal * 100) / 100,
    totalStatutory: Math.round(totalStatutory * 100) / 100,
    uifEmployee: Math.round(uifEmployee * 100) / 100,
    uifEmployer: Math.round(uifEmployer * 100) / 100,
    payrollRunIds: [payrollRunId],
  };
}

/**
 * Get statutory summary for a calendar month (all paid runs in that month).
 */
export async function getStatutorySummaryForMonth(
  companyId: string,
  year: number,
  month: number
): Promise<PayrollStatutorySummary | null> {
  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);

  const runs = await prisma.payrollRun.findMany({
    where: {
      companyId,
      status: "paid",
      periodEnd: { gte: periodStart, lte: periodEnd },
    },
    include: { items: { include: { payslip: true } } },
  });

  if (runs.length === 0) return null;

  let payeTotal = 0;
  let uifEmployee = 0;
  let uifEmployer = 0;
  let sdlTotal = 0;
  const payrollRunIds: string[] = [];

  for (const run of runs) {
    payrollRunIds.push(run.id);
    for (const item of run.items) {
      const pay = item.payslip;
      if (pay) {
        payeTotal += Number(pay.tax ?? 0);
        uifEmployee += Number(pay.uifEmployee ?? 0);
        uifEmployer += Number(pay.uifEmployer ?? 0);
        sdlTotal += Number(pay.sdl ?? 0);
      }
    }
  }

  const uifTotal = uifEmployee + uifEmployer;
  const totalStatutory = payeTotal + uifTotal + sdlTotal;

  return {
    period: `${year}-${String(month).padStart(2, "0")}`,
    payeTotal: Math.round(payeTotal * 100) / 100,
    uifTotal: Math.round(uifTotal * 100) / 100,
    sdlTotal: Math.round(sdlTotal * 100) / 100,
    totalStatutory: Math.round(totalStatutory * 100) / 100,
    uifEmployee: Math.round(uifEmployee * 100) / 100,
    uifEmployer: Math.round(uifEmployer * 100) / 100,
    payrollRunIds,
  };
}

/**
 * Estimate tax reserve for payroll cashflow planning.
 * Uses last N months of paid runs to compute average monthly statutory.
 */
export async function estimateTaxReserve(
  companyId: string,
  options?: { monthsToAverage?: number }
): Promise<TaxReserveEstimate> {
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

  const periodsUsed = monthlyTotals.size || 1;
  const sumMonthly = [...monthlyTotals.values()].reduce((a, b) => a + b, 0);
  const averageMonthlyStatutory = sumMonthly / periodsUsed;

  return {
    oneMonthReserve: Math.round(averageMonthlyStatutory * 100) / 100,
    threeMonthReserve: Math.round(averageMonthlyStatutory * 3 * 100) / 100,
    averageMonthlyStatutory: Math.round(averageMonthlyStatutory * 100) / 100,
    periodsUsed,
  };
}
