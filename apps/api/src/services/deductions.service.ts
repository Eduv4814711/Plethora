import { prisma } from "../lib/prisma.js";
import type { Employee } from "@prisma/client";

export interface DeductionLine {
  name: string;
  amount: number;
}

export class InvalidDeductionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDeductionConfigurationError";
  }
}

function assertFiniteDeductionValue(
  value: number,
  label: string,
  options: { max?: number } = {}
): void {
  if (!Number.isFinite(value) || value < 0 || (options.max != null && value > options.max)) {
    throw new InvalidDeductionConfigurationError(
      `${label} must be a finite value between 0 and ${options.max ?? "the configured limit"}`
    );
  }
}

/**
 * Calculate total deductions for an employee given gross pay and period.
 * Includes: DeductionRules (or GroupDeductionRules when groupId provided) + EmployeeDeductions
 * @param excludeDeductionNames - Rule names to skip (e.g. ["UIF"] when tax service handles them)
 */
export async function calculateDeductions(
  companyId: string,
  employeeId: string,
  employee: Pick<Employee, "employeeType">,
  grossPay: number,
  periodStart: Date,
  periodEnd: Date,
  groupId?: string,
  excludeDeductionNames?: string[]
): Promise<{ total: number; lines: DeductionLine[] }> {
  const lines: DeductionLine[] = [];
  let total = 0;

  const empType = employee.employeeType ?? "security";
  const appliesFilter = [
    { appliesTo: "all" as const },
    { appliesTo: empType },
  ];

  let rules: Array<{
    id: string;
    name: string;
    type: string;
    amount: { toString(): string } | null;
    rate: { toString(): string } | null;
    appliesTo: string;
    employeeIds: unknown;
    isOptional: boolean;
  }> = [];
  let rulesFromGroup = false;

  if (groupId) {
    const groupRules = await prisma.groupDeductionRule.findMany({
      where: {
        companyId,
        groupId,
        isActive: true,
        OR: appliesFilter,
      },
    });
    if (groupRules.length > 0) {
      rules = groupRules;
      rulesFromGroup = true;
    }
  }

  if (rules.length === 0) {
    rules = await prisma.deductionRule.findMany({
      where: {
        companyId,
        isActive: true,
        OR: appliesFilter,
      },
    });
  }

  const excludeSet = excludeDeductionNames
    ? new Set(excludeDeductionNames.map((n) => n.toLowerCase()))
    : null;

  for (const rule of rules) {
    if (excludeSet?.has(rule.name.toLowerCase())) continue;

    if (rule.isOptional) {
      const optedIn = await prisma.employeeDeduction.findFirst({
        where: rulesFromGroup
          ? {
              employeeId,
              name: rule.name,
              appliesFrom: { lte: periodEnd },
              OR: [{ appliesTo: null }, { appliesTo: { gte: periodStart } }],
            }
          : {
              employeeId,
              deductionRuleId: rule.id,
              appliesFrom: { lte: periodEnd },
              OR: [{ appliesTo: null }, { appliesTo: { gte: periodStart } }],
            },
      });
      if (!optedIn) continue;
    }

    const employeeIds = rule.employeeIds as string[] | null;
    if (employeeIds && employeeIds.length > 0 && !employeeIds.includes(employeeId)) {
      continue;
    }

    let amount = 0;
    if (rule.type === "fixed" && rule.amount != null) {
      amount = Number(rule.amount);
      assertFiniteDeductionValue(amount, `Deduction rule "${rule.name}" amount`);
    } else if (rule.type === "percentage" && rule.rate != null) {
      const rate = Number(rule.rate);
      assertFiniteDeductionValue(rate, `Deduction rule "${rule.name}" rate`, { max: 100 });
      amount = grossPay * (rate / 100);
    } else {
      throw new InvalidDeductionConfigurationError(
        `Deduction rule "${rule.name}" has no valid ${rule.type === "fixed" ? "amount" : "percentage rate"}`
      );
    }
    if (amount > 0) {
      amount = Math.round(amount * 100) / 100;
      lines.push({ name: rule.name, amount });
      total += amount;
    }
  }

  const manualDeductions = await prisma.employeeDeduction.findMany({
    where: {
      employeeId,
      deductionRuleId: null,
      appliesFrom: { lte: periodEnd },
      OR: [{ appliesTo: null }, { appliesTo: { gte: periodStart } }],
    },
  });

  for (const ed of manualDeductions) {
    let amount = 0;
    if (ed.type === "fixed") {
      amount = Number(ed.amount);
      assertFiniteDeductionValue(amount, `Employee deduction "${ed.name}" amount`);
    } else if (ed.type === "percentage" && ed.rate != null) {
      const rate = Number(ed.rate);
      assertFiniteDeductionValue(rate, `Employee deduction "${ed.name}" rate`, { max: 100 });
      amount = grossPay * (rate / 100);
    } else {
      throw new InvalidDeductionConfigurationError(
        `Employee deduction "${ed.name}" has no valid ${ed.type === "fixed" ? "amount" : "percentage rate"}`
      );
    }
    if (amount > 0) {
      amount = Math.round(amount * 100) / 100;
      lines.push({ name: ed.name, amount });
      total += amount;
    }
  }

  total = Math.round(total * 100) / 100;
  return { total, lines };
}
