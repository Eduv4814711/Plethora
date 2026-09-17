/**
 * Contract Labour Cost Service
 *
 * Links payroll cost to sites (contracts). Allocates employee cost proportionally
 * by hours worked per site. Supports labour % and health indicators.
 *
 * Business rules:
 * - labour % <= 70% = healthy
 * - labour % > 75% = warning
 * - labour % > 80% = danger
 */

import { prisma } from "../lib/prisma.js";
import { calculateSiteBilling } from "./client-billing.service.js";

export type LabourHealthIndicator = "healthy" | "warning" | "danger";

export interface ContractLabourCostSummary {
  siteId: string;
  siteName: string;
  employeeCount: number;
  totalLabourCost: number;
  overtimeCost: number;
  allowancesCost: number;
  revenue: number | null;
  labourRatio: number | null;
  healthIndicator: LabourHealthIndicator | null;
  insufficientData: boolean;
  overtimePct: number;
}

export interface ContractLabourCostResult {
  contracts: ContractLabourCostSummary[];
  /** Labour cost that could not be allocated to any site (e.g. office staff) */
  unallocatedCost: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Get labour cost per site/contract for a period.
 * Allocates payroll cost proportionally by hours worked per site (from Shift).
 */
export async function getContractLabourCost(
  companyId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<ContractLabourCostResult> {
  const LABOUR_HEALTHY = 0.7;
  const LABOUR_WARNING = 0.75;
  const LABOUR_DANGER = 0.8;

  const runs = await prisma.payrollRun.findMany({
    where: {
      companyId,
      status: { in: ["calculated", "approved", "paid"] },
      periodEnd: { gte: periodStart },
      periodStart: { lte: periodEnd },
    },
    include: {
      items: {
        include: {
          employee: true,
          payslip: true,
        },
      },
    },
  });

  const sites = await prisma.site.findMany({
    where: { companyId },
    select: { id: true, name: true, monthlyRevenue: true },
  });

  const siteMap = new Map(sites.map((s) => [s.id, s]));

  const siteCosts = new Map<
    string,
    { labour: number; overtime: number; allowances: number; employeeIds: Set<string> }
  >();

  let unallocatedCost = 0;

  const CORE_EARNINGS = ["Basic", "Basic Salary", "Overtime", "Sunday", "Public Holiday", "Paid Leave"];

  for (const run of runs) {
    const runPeriodStart = run.periodStart;
    const runPeriodEnd = run.periodEnd;

    const shifts = await prisma.shift.findMany({
      where: {
        companyId,
        status: { in: ["completed", "verified"] },
        startTime: { lt: runPeriodEnd },
        endTime: { gt: runPeriodStart },
        attendances: {
          some: {
            clockIn: { not: null },
            clockOut: { not: null },
          },
        },
      },
      include: {
        site: { select: { id: true } },
        attendances: {
          where: {
            clockIn: { not: null },
            clockOut: { not: null },
          },
        },
      },
    });

    const employeeHoursBySite = new Map<string, Map<string, number>>();
    for (const shift of shifts) {
      const siteId = shift.siteId;
      const empId = shift.employeeId;
      const hours = shift.attendances.reduce(
        (sum, a) => sum + Number(a.hoursWorked ?? 0) + Number(a.overtimeHours ?? 0),
        0
      );

      if (!employeeHoursBySite.has(empId)) {
        employeeHoursBySite.set(empId, new Map());
      }
      const empSites = employeeHoursBySite.get(empId)!;
      empSites.set(siteId, (empSites.get(siteId) ?? 0) + hours);
    }

    for (const item of run.items) {
      const empId = item.employeeId;
      const grossPay = Number(item.grossPay);
      const overtimePay = Number(item.overtimePay);
      const earnings = (item.payslip?.earnings as Array<{ name: string; amount: number }>) ?? [];
      const allowances = earnings
        .filter((e) => !CORE_EARNINGS.some((c) => e.name.toLowerCase().includes(c.toLowerCase())))
        .reduce((sum, e) => sum + (e.amount ?? 0), 0);

      const empSites = employeeHoursBySite.get(empId);
      if (!empSites || empSites.size === 0) {
        unallocatedCost += grossPay;
        continue;
      }

      const totalHours = [...empSites.values()].reduce((a, b) => a + b, 0);
      if (totalHours <= 0) {
        unallocatedCost += grossPay;
        continue;
      }

      for (const [siteId, hours] of empSites) {
        const ratio = hours / totalHours;
        const allocatedGross = grossPay * ratio;
        const allocatedOvertime = overtimePay * ratio;
        const allocatedAllowances = allowances * ratio;

        if (!siteCosts.has(siteId)) {
          siteCosts.set(siteId, {
            labour: 0,
            overtime: 0,
            allowances: 0,
            employeeIds: new Set(),
          });
        }
        const sc = siteCosts.get(siteId)!;
        sc.labour += allocatedGross;
        sc.overtime += allocatedOvertime;
        sc.allowances += allocatedAllowances;
        sc.employeeIds.add(empId);
      }
    }
  }

  const contracts: ContractLabourCostSummary[] = [];

  for (const [siteId, costs] of siteCosts) {
    const site = siteMap.get(siteId);
    const siteName = site?.name ?? "Unknown";
    let revenue: number | null = null;
    try {
      const siteBilling = await calculateSiteBilling(companyId, siteId, periodEnd);
      if (siteBilling.billingConfigured && siteBilling.siteMonthlyTotal.gt(0)) {
        revenue = Number(siteBilling.siteMonthlyTotal);
      } else if (site?.monthlyRevenue != null) {
        revenue = Number(site.monthlyRevenue);
      }
    } catch {
      revenue = site?.monthlyRevenue != null ? Number(site.monthlyRevenue) : null;
    }

    let labourRatio: number | null = null;
    let healthIndicator: LabourHealthIndicator | null = null;
    let insufficientData = false;

    if (revenue != null && revenue > 0) {
      labourRatio = costs.labour / revenue;
      if (labourRatio <= LABOUR_HEALTHY) {
        healthIndicator = "healthy";
      } else if (labourRatio <= LABOUR_WARNING) {
        healthIndicator = "warning";
      } else {
        healthIndicator = "danger";
      }
    } else {
      insufficientData = true;
    }

    const overtimePct = costs.labour > 0 ? (costs.overtime / costs.labour) * 100 : 0;

    contracts.push({
      siteId,
      siteName,
      employeeCount: costs.employeeIds.size,
      totalLabourCost: Math.round(costs.labour * 100) / 100,
      overtimeCost: Math.round(costs.overtime * 100) / 100,
      allowancesCost: Math.round(costs.allowances * 100) / 100,
      revenue,
      labourRatio: labourRatio != null ? Math.round(labourRatio * 10000) / 10000 : null,
      healthIndicator,
      insufficientData,
      overtimePct: Math.round(overtimePct * 100) / 100,
    });
  }

  return {
    contracts: contracts.sort((a, b) => a.siteName.localeCompare(b.siteName)),
    unallocatedCost: Math.round(unallocatedCost * 100) / 100,
    periodStart,
    periodEnd,
  };
}
