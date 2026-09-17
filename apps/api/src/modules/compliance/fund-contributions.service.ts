import { prisma } from "../../lib/prisma.js";
import { getEffectiveRate } from "./statutory-rates.service.js";
import type { StatutoryScheme, Prisma } from "@prisma/client";

export interface ListContributionsFilter {
  scheme?: StatutoryScheme;
  employeeId?: string;
  limit?: number;
  offset?: number;
}

export async function listContributions(
  companyId: string,
  statutoryPeriodId: string,
  filter: ListContributionsFilter = {}
) {
  const { scheme, employeeId, limit = 100, offset = 0 } = filter;
  const where: Prisma.EmployeeStatutoryContributionWhereInput = {
    companyId,
    statutoryPeriodId,
    ...(scheme && { scheme }),
    ...(employeeId && { employeeId }),
  };

  const [items, total] = await Promise.all([
    prisma.employeeStatutoryContribution.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
            idNumber: true,
          },
        },
      },
      orderBy: { employee: { lastName: "asc" } },
      skip: offset,
      take: limit,
    }),
    prisma.employeeStatutoryContribution.count({ where }),
  ]);

  return { items, total, limit, offset };
}

export async function getFundSummary(companyId: string, statutoryPeriodId: string) {
  const period = await prisma.statutoryPeriod.findFirstOrThrow({
    where: { id: statutoryPeriodId, companyId },
  });

  const totals = await prisma.employeeStatutoryContribution.aggregate({
    where: { companyId, statutoryPeriodId },
    _sum: {
      pensionableOrFundEarnings: true,
      employeeAmount: true,
      employerAmount: true,
      totalAmount: true,
    },
    _count: { id: true },
  });

  return {
    period,
    totalEmployees: totals._count.id,
    pensionableEarnings: Number(totals._sum.pensionableOrFundEarnings ?? 0),
    employeeTotal: Number(totals._sum.employeeAmount ?? 0),
    employerTotal: Number(totals._sum.employerAmount ?? 0),
    combinedTotal: Number(totals._sum.totalAmount ?? 0),
  };
}

export async function captureContributionsFromRun(
  companyId: string,
  statutoryPeriodId: string,
  payrollRunId: string,
  scheme: StatutoryScheme = "PSSPF"
) {
  const period = await prisma.statutoryPeriod.findFirstOrThrow({
    where: { id: statutoryPeriodId, companyId },
  });

  const rate = await getEffectiveRate(companyId, scheme, period.periodStart);

  // Fetch all payroll items for this run
  const payrollItems = await prisma.payrollItem.findMany({
    where: { payrollRunId },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeNumber: true,
          idNumber: true,
        },
      },
      payslip: true,
    },
  });

  const createdRecords: Array<{
    companyId: string;
    statutoryPeriodId: string;
    employeeId: string;
    scheme: StatutoryScheme;
    pensionableOrFundEarnings: number;
    employeeRate: number;
    employerRate: number;
    employeeAmount: number;
    employerAmount: number;
    totalAmount: number;
    rateConfigId: string | null;
    rateSnapshot: object;
  }> = [];

  for (const item of payrollItems) {
    const gross = Number(item.grossPay ?? 0);
    if (gross <= 0) continue;

    // Use pensionable earnings if capped, else gross
    let fundEarnings = gross;
    if (rate.earningsCeiling && fundEarnings > rate.earningsCeiling) {
      fundEarnings = rate.earningsCeiling;
    }

    const employeeAmt = Number((fundEarnings * rate.employeeRate).toFixed(2));
    const employerAmt = Number((fundEarnings * rate.employerRate).toFixed(2));
    const totalAmt = Number((employeeAmt + employerAmt).toFixed(2));

    createdRecords.push({
      companyId,
      statutoryPeriodId,
      employeeId: item.employeeId,
      scheme,
      pensionableOrFundEarnings: fundEarnings,
      employeeRate: rate.employeeRate,
      employerRate: rate.employerRate,
      employeeAmount: employeeAmt,
      employerAmount: employerAmt,
      totalAmount: totalAmt,
      rateConfigId: rate.configId,
      rateSnapshot: {
        scheme,
        source: rate.source,
        employeeRate: rate.employeeRate,
        employerRate: rate.employerRate,
        ceiling: rate.earningsCeiling,
      },
    });
  }

  // Upsert all contributions
  await prisma.$transaction(
    createdRecords.map((r) =>
      prisma.employeeStatutoryContribution.upsert({
        where: {
          companyId_statutoryPeriodId_employeeId_scheme: {
            companyId,
            statutoryPeriodId,
            employeeId: r.employeeId,
            scheme: r.scheme,
          },
        },
        create: {
          ...r,
          rateSnapshot: JSON.parse(JSON.stringify(r.rateSnapshot)),
        },
        update: {
          pensionableOrFundEarnings: r.pensionableOrFundEarnings,
          employeeAmount: r.employeeAmount,
          employerAmount: r.employerAmount,
          totalAmount: r.totalAmount,
          rateSnapshot: JSON.parse(JSON.stringify(r.rateSnapshot)),
        },
      })
    )
  );

  // Update statutory period totals
  const totalEmployee = createdRecords.reduce((sum, r) => sum + r.employeeAmount, 0);
  const totalEmployer = createdRecords.reduce((sum, r) => sum + r.employerAmount, 0);
  const totalFund = Number((totalEmployee + totalEmployer).toFixed(2));

  await prisma.statutoryPeriod.update({
    where: { id: statutoryPeriodId, companyId },
    data: {
      expectedEmployeeAmount: totalEmployee,
      expectedEmployerAmount: totalEmployer,
      expectedTotal: totalFund,
      outstandingAmount: totalFund,
    },
  });

  return {
    count: createdRecords.length,
    totalEmployee,
    totalEmployer,
    totalFund,
  };
}
