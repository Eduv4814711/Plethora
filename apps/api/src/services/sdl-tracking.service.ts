import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { exceedsSdlThreshold } from "./tax.service.js";

type MonthlyTotals = Record<string, number>;

function monthKeyUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Update SDL tracking when a payroll run is marked as paid.
 * Adds the run's total leviable payroll to the company's monthly totals,
 * prunes old months, and sets sdlLiableFrom if the rolling 12-month total exceeds R500k.
 */
export async function updateSdlTrackingOnPayrollPaid(
  companyId: string,
  payrollRunId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  const items = await db.payrollItem.findMany({
    where: { payrollRunId },
    select: { grossPay: true },
  });

  const totalLeviable = items.reduce((sum, i) => sum + Number(i.grossPay), 0);
  if (totalLeviable <= 0) return;

  const run = await db.payrollRun.findFirst({
    where: { id: payrollRunId, companyId },
    select: { periodEnd: true },
  });
  if (!run) return;

  const periodEnd = new Date(run.periodEnd);
  const monthKey = monthKeyUtc(periodEnd);

  const company = await db.company.findUnique({
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

  // The current month plus the preceding 11 months is a 12-month window.
  // Use UTC because payroll period timestamps are stored as UTC instants and
  // must not move into another month based on the API server's timezone.
  const cutoff = new Date(
    Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() - 11, 1)
  );
  const cutoffKey = monthKeyUtc(cutoff);

  const pruned: MonthlyTotals = {};
  for (const [key, val] of Object.entries(updated)) {
    if (key >= cutoffKey) pruned[key] = val;
  }

  const rollingTotal = Object.values(pruned).reduce((a, b) => a + b, 0);
  let sdlLiableFrom = company.sdlLiableFrom;

  if (!sdlLiableFrom && exceedsSdlThreshold(rollingTotal)) {
    sdlLiableFrom = new Date(
      Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1)
    );
  }

  await db.company.update({
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
