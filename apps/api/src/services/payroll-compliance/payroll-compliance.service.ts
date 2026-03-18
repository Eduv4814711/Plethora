/**
 * Payroll Compliance Checker
 *
 * Runs configurable rules against payroll output and returns structured results.
 * Does not modify payroll - read-only validation.
 */

import { prisma } from "../../lib/prisma.js";
import type {
  ComplianceCheckResult,
  ComplianceContext,
  ComplianceRuleConfig,
  PayrollRiskFlag,
} from "./types.js";
import {
  checkHighOvertime,
  checkMissingTaxId,
  checkMissingUifFields,
  checkNegativeValues,
  checkPremiumPay,
  checkZeroPayActive,
} from "./rules/index.js";

const DEFAULT_CONFIG: ComplianceRuleConfig = {
  enabled: true,
  overtimeThresholdPct: 0.25,
  maxWeeklyHours: 45,
};

function getRuleConfig(companyId: string, companySettings: unknown): ComplianceRuleConfig {
  const settings = companySettings as Record<string, unknown> | null;
  const payrollCompliance = settings?.payrollCompliance as Partial<ComplianceRuleConfig> | undefined;
  return {
    ...DEFAULT_CONFIG,
    ...payrollCompliance,
  };
}

export async function runPayrollComplianceChecks(
  payrollRunId: string,
  companyId: string
): Promise<ComplianceCheckResult[]> {
  const run = await prisma.payrollRun.findFirst({
    where: { id: payrollRunId, companyId },
    include: {
      items: {
        include: {
          employee: {
            select: {
              id: true,
              idNumber: true,
              taxNumber: true,
              status: true,
              employeeType: true,
            },
          },
          payslip: true,
        },
      },
    },
  });

  if (!run) return [];

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });

  const config = getRuleConfig(companyId, company?.settings);

  const context: ComplianceContext = {
    companyId,
    payrollRunId,
    payrollRun: {
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: run.status,
    },
    items: run.items.map((item) => ({
      id: item.id,
      employeeId: item.employeeId,
      grossPay: Number(item.grossPay),
      basePay: Number(item.basePay),
      overtimePay: Number(item.overtimePay),
      sundayPay: item.sundayPay != null ? Number(item.sundayPay) : null,
      publicHolidayPay: item.publicHolidayPay != null ? Number(item.publicHolidayPay) : null,
      deductions: Number(item.deductions),
      netPay: Number(item.netPay),
      hoursWorked: Number(item.hoursWorked),
      overtimeHours: Number(item.overtimeHours),
      employee: item.employee,
      payslip: item.payslip
        ? {
            tax: item.payslip.tax != null ? Number(item.payslip.tax) : null,
            uifEmployee: item.payslip.uifEmployee != null ? Number(item.payslip.uifEmployee) : null,
            uifEmployer: item.payslip.uifEmployer != null ? Number(item.payslip.uifEmployer) : null,
            sdl: item.payslip.sdl != null ? Number(item.payslip.sdl) : null,
            earnings: item.payslip.earnings,
            deductions: item.payslip.deductions,
          }
        : null,
    })),
  };

  const allResults: ComplianceCheckResult[] = [];

  const rules = [
    { fn: () => checkNegativeValues(context), id: "negative_values" },
    { fn: () => checkMissingUifFields(context), id: "missing_uif" },
    { fn: () => checkMissingTaxId(context), id: "missing_tax_id" },
    { fn: () => checkHighOvertime(context, config.overtimeThresholdPct), id: "high_overtime" },
    { fn: () => checkZeroPayActive(context), id: "zero_pay_active" },
    { fn: () => checkPremiumPay(context), id: "premium_checks" },
  ];

  for (const rule of rules) {
    const results = await rule.fn();
    allResults.push(...results);
  }

  return allResults;
}

/**
 * Convert compliance results to risk flags for dashboard display.
 */
export function complianceResultsToRiskFlags(
  payrollRunId: string,
  results: ComplianceCheckResult[]
): PayrollRiskFlag[] {
  return results.map((r) => ({
    payrollRunId,
    employeeId: r.employeeId ?? (r.entityType === "employee" ? r.entityId : undefined),
    ruleName: r.ruleName,
    severity: r.severity,
    message: r.message,
    createdAt: new Date(),
  }));
}
