/**
 * Payroll Reserve Service
 *
 * Provides management visibility into payroll burden and recommended reserves
 * for cashflow planning. Supports government-contract delayed payment scenarios.
 *
 * CASH-FLOW EQUATION (corrected):
 *   The company's true payroll cash requirement per period is:
 *
 *     netWagesPayable       = Σ netPay          (cash wired to employees)
 *     employeeWithholdings  = Σ PAYE + Σ empUIF  (withheld FROM employees; remitted to SARS/UIF)
 *     employerContributions = Σ emplrUIF + Σ SDL  (additional employer-side costs)
 *     thirdPartyDeductions  = Σ other deductions  (e.g. pension, union, garnishee)
 *
 *     totalPayrollCash = netWagesPayable + employeeWithholdings + employerContributions + thirdPartyDeductions
 *                      = grossPay + emplrUIF + SDL
 *                      (because grossPay = netPay + deductions; deductions = PAYE + empUIF + other)
 *
 * NOTE: The legacy `computeMonthlyPayrollBurden` function below OVER-COUNTS by
 * adding PAYE and employee UIF on top of grossPay.  Those amounts are already
 * embedded in grossPay (they are employee withholdings the company deducts before
 * paying net wages — not separate additional outflows).
 * The corrected calculation is provided by `computeCorrectPayrollCashRequirement`.
 */

import { prisma } from "../lib/prisma.js";

export type ReserveDataSource = "paid" | "projected";

export interface PayrollReserveSnapshot {
  /**
   * @deprecated Over-counts: adds PAYE+empUIF on top of grossPay, but those
   * are already embedded in grossPay as employee withholdings.  Use
   * `correctedMonthlyBurden` or `components` instead.
   */
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
  /** Corrected monthly payroll cash requirement (no double-counting) */
  correctedMonthlyBurden: number;
  /** Decomposed payroll cash components (corrected) */
  components: PayrollCashComponents;
}

/**
 * Decomposed view of the company's payroll cash requirement for one average period.
 *
 * Relationships:
 *   netWagesPayable + employeeWithholdings + thirdPartyDeductions = avgGrossPay
 *   totalPayrollCashRequirement = avgGrossPay + employerContributions
 */
export interface PayrollCashComponents {
  /** Average net pay wired to employees */
  netWagesPayable: number;
  /** PAYE + employee UIF — withheld from employees and remitted to SARS/UIF */
  employeeWithholdings: number;
  /**
   * Additional pension/provident/union/garnishee deductions withheld from
   * employees and paid to third parties.
   */
  thirdPartyDeductions: number;
  /** Employer UIF contribution (additional employer cost) */
  employerUif: number;
  /** SDL contribution (additional employer cost) */
  sdl: number;
  /** Total employer-side contributions (emplrUIF + SDL) */
  employerContributions: number;
  /**
   * Total cash the company must mobilise per payroll period:
   *   grossPay + employerContributions
   *   = netWagesPayable + employeeWithholdings + thirdPartyDeductions + employerContributions
   */
  totalPayrollCashRequirement: number;
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
    netPay: { toString(): string } | number | string | null;
    deductions: { toString(): string } | number | string | null;
    payslip: {
      tax: { toString(): string } | number | string | null;
      uifEmployee: { toString(): string } | number | string | null;
      uifEmployer: { toString(): string } | number | string | null;
      sdl: { toString(): string } | number | string | null;
    } | null;
  }>;
};

const runInclude = {
  items: {
    select: {
      grossPay: true,
      netPay: true,
      deductions: true,
      payslip: true,
    },
  },
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

/**
 * @deprecated Inflated: adds PAYE + employee UIF on top of grossPay.  Those
 * amounts are already embedded in grossPay as employee withholdings — the
 * company withholds them before paying net wages and then remits to SARS/UIF.
 * Use `computeCorrectPayrollCashRequirement` for accurate cash planning.
 */
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
        // NOTE: tax + uifEmployee are withholdings already inside grossPay.
        // Adding them here over-counts by ~20-25% of gross payroll.
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
 * Computes the CORRECT average payroll cash requirement per month,
 * decomposed into its constituent components.
 *
 * Formula per period:
 *   totalPayrollCash = grossPay + emplrUIF + SDL
 *
 * This equals:
 *   netWagesPayable (to employees)
 * + employeeWithholdings (PAYE + empUIF — remitted to SARS/UIF)
 * + thirdPartyDeductions (pension, union, garnishee — remitted to third parties)
 * + employerContributions (emplrUIF + SDL — employer-only costs)
 */
export function computeCorrectPayrollCashRequirement(runs: ReserveRun[]): {
  components: PayrollCashComponents;
  correctedMonthlyBurden: number;
  periodsUsed: number;
} {
  // Accumulate per-month totals so we can average correctly over N periods.
  type MonthTotals = {
    netWages: number;
    paye: number;
    empUif: number;
    thirdParty: number;  // deductions - PAYE - empUIF (i.e. pension/union/garnishee)
    emplrUif: number;
    sdl: number;
    grossPay: number;
  };

  const monthlyMap = new Map<string, MonthTotals>();

  for (const run of runs) {
    const monthKey = `${run.periodEnd.getFullYear()}-${String(run.periodEnd.getMonth() + 1).padStart(2, "0")}`;
    const existing = monthlyMap.get(monthKey) ?? {
      netWages: 0, paye: 0, empUif: 0, thirdParty: 0, emplrUif: 0, sdl: 0, grossPay: 0,
    };

    for (const item of run.items) {
      const gross = Number(item.grossPay ?? 0);
      const net   = Number(item.netPay    ?? 0);
      const totalDeductions = Number(item.deductions ?? 0);
      const pay   = item.payslip;

      const paye   = Number(pay?.tax         ?? 0);
      const empUif = Number(pay?.uifEmployee  ?? 0);
      const emplrUif = Number(pay?.uifEmployer ?? 0);
      const sdl   = Number(pay?.sdl          ?? 0);

      // Third-party deductions = everything deducted that isn't PAYE or employee UIF.
      // e.g. pension, provident, union fees, garnishee orders.
      const thirdParty = Math.max(0, totalDeductions - paye - empUif);

      existing.grossPay  += gross;
      existing.netWages  += net;
      existing.paye      += paye;
      existing.empUif    += empUif;
      existing.thirdParty += thirdParty;
      existing.emplrUif  += emplrUif;
      existing.sdl       += sdl;
    }

    monthlyMap.set(monthKey, existing);
  }

  const periodsUsed = monthlyMap.size;
  if (periodsUsed === 0) {
    return {
      components: {
        netWagesPayable: 0,
        employeeWithholdings: 0,
        thirdPartyDeductions: 0,
        employerUif: 0,
        sdl: 0,
        employerContributions: 0,
        totalPayrollCashRequirement: 0,
      },
      correctedMonthlyBurden: 0,
      periodsUsed: 0,
    };
  }

  // Average each component across all months.
  let sumNet = 0, sumPaye = 0, sumEmpUif = 0, sumThirdParty = 0;
  let sumEmplrUif = 0, sumSdl = 0, sumGross = 0;
  for (const m of monthlyMap.values()) {
    sumNet       += m.netWages;
    sumPaye      += m.paye;
    sumEmpUif    += m.empUif;
    sumThirdParty += m.thirdParty;
    sumEmplrUif  += m.emplrUif;
    sumSdl       += m.sdl;
    sumGross     += m.grossPay;
  }

  const avgNet        = round2(sumNet        / periodsUsed);
  const avgPaye       = round2(sumPaye       / periodsUsed);
  const avgEmpUif     = round2(sumEmpUif     / periodsUsed);
  const avgThirdParty = round2(sumThirdParty / periodsUsed);
  const avgEmplrUif   = round2(sumEmplrUif   / periodsUsed);
  const avgSdl        = round2(sumSdl        / periodsUsed);
  const avgGross      = round2(sumGross      / periodsUsed);

  const employeeWithholdings  = round2(avgPaye + avgEmpUif);
  const employerContributions = round2(avgEmplrUif + avgSdl);
  // correctTotal = grossPay + emplrUIF + SDL
  // equivalently = netWages + withholdings + thirdParty + emplrContributions
  const totalPayrollCashRequirement = round2(avgGross + employerContributions);

  return {
    components: {
      netWagesPayable:            avgNet,
      employeeWithholdings,
      thirdPartyDeductions:       avgThirdParty,
      employerUif:                avgEmplrUif,
      sdl:                        avgSdl,
      employerContributions,
      totalPayrollCashRequirement,
    },
    correctedMonthlyBurden: totalPayrollCashRequirement,
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
  const { components, correctedMonthlyBurden } = computeCorrectPayrollCashRequirement(runs);

  const snapshot: PayrollReserveSnapshot = {
    monthlyPayrollBurden,
    oneMonthReserve,
    threeMonthReserve,
    statutoryReserve,
    periodsUsed,
    dataSource,
    correctedMonthlyBurden,
    components,
  };

  if (options?.availableCash != null) {
    snapshot.reserveGap = round2(oneMonthReserve - options.availableCash);
  }

  return snapshot;
}
