import { prisma } from "../lib/prisma.js";
import { exceedsSdlThreshold } from "./tax.service.js";

type MonthlyTotals = Record<string, number>;

/**
 * Update SDL tracking when a payroll run is marked as paid.
 * Adds the run's total leviable payroll to the company's monthly totals,
 * prunes old months, and sets sdlLiableFrom if the rolling 12-month total exceeds R500k.
 */
export async function updateSdlTrackingOnPayrollPaid(
  companyId: string,
  payrollRunId: string
): Promise<void> {
  const items = await prisma.payrollItem.findMany({
    where: { payrollRunId },
    select: { grossPay: true },
  });

  const totalLeviable = items.reduce((sum, i) => sum + Number(i.grossPay), 0);
  if (totalLeviable <= 0) return;

  const run = await prisma.payrollRun.findFirst({
    where: { id: payrollRunId, companyId },
    select: { periodEnd: true },
  });
  if (!run) return;

  const periodEnd = new Date(run.periodEnd);
  const monthKey = `${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, "0")}`;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { monthlyPayrollTotals: true, sdlLiableFrom: true },
  });
  if (!company) return;

  const existing = (company.monthlyPayrollTotals as MonthlyTotals) ?? {};
  const currentMonthTotal = existing[monthKey] ?? 0;
  const updated: MonthlyTotals = {
    ...existing,
    [monthKey]: currentMonthTotal + totalLeviable,
  };

  // Prune months older than 12 months
  const cutoff = new Date(periodEnd);
  cutoff.setMonth(cutoff.getMonth() - 12);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}`;

  const pruned: MonthlyTotals = {};
  for (const [key, val] of Object.entries(updated)) {
    if (key >= cutoffKey) pruned[key] = val;
  }

  const rollingTotal = Object.values(pruned).reduce((a, b) => a + b, 0);
  let sdlLiableFrom = company.sdlLiableFrom;

  if (!sdlLiableFrom && exceedsSdlThreshold(rollingTotal)) {
    sdlLiableFrom = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
  }

  await prisma.company.update({
    where: { id: companyId },
    data: {
      monthlyPayrollTotals: pruned,
      ...(sdlLiableFrom != null && company.sdlLiableFrom == null
        ? { sdlLiableFrom }
        : {}),
    },
  });
}

/**
 * Get the rolling 12-month payroll total for a company (for display in settings).
 */
export async function getRolling12MonthPayroll(companyId: string): Promise<number> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { monthlyPayrollTotals: true },
  });
  if (!company?.monthlyPayrollTotals) return 0;
  const totals = company.monthlyPayrollTotals as MonthlyTotals;
  return Object.values(totals).reduce((a, b) => a + b, 0);
}
