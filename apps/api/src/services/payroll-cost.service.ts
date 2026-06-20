/**
 * Employee True Cost / Payroll Cost Calculator
 *
 * Calculates the true cost of an employee to the employer, not just gross pay.
 * Includes: base pay, overtime, Sunday, public holiday, allowances, employer UIF, SDL.
 *
 * Does NOT modify payroll calculation - reads from existing PayrollItem + Payslip.
 */

import { prisma } from "../lib/prisma.js";

/** Earnings line from payslip JSON */
const CORE_EARNINGS = ["Basic", "Basic Salary", "Overtime", "Sunday", "Public Holiday", "Paid Leave"];

export interface EmployeeCostBreakdown {
  /** Base pay (regular hours) */
  basePay: number;
  /** Overtime pay */
  overtimePay: number;
  /** Sunday premium pay */
  sundayPay: number;
  /** Public holiday premium pay */
  publicHolidayPay: number;
  /** Allowances (transport, uniform, etc. - from earnings rules) */
  allowances: number;
  /** Total gross pay */
  grossPay: number;
  /** Total deductions (employee-side) */
  deductions: number;
  /** Net pay to employee */
  netPay: number;
  /** Employer UIF contribution */
  uifEmployer: number;
  /** Employer SDL contribution */
  sdl: number;
  /** Total employer cost (gross + uifEmployer + sdl) */
  totalEmployerCost: number;
  /** Optional overhead allocation - placeholder for future extension */
  overheadAllocation?: number;
  /** Employee ID for reference */
  employeeId: string;
  /** Payroll run ID for reference */
  payrollRunId: string;
}

/**
 * Calculate the true cost of an employee for a given payroll item.
 * Returns a structured breakdown including employer-side statutory costs.
 */
export async function calculateEmployeeTrueCost(
  payrollItemId: string,
  companyId: string
): Promise<EmployeeCostBreakdown | null> {
  const item = await prisma.payrollItem.findFirst({
    where: { id: payrollItemId, payrollRun: { companyId } },
    include: { payslip: true, employee: true },
  });

  if (!item) return null;

  const basePay = Number(item.basePay);
  const overtimePay = Number(item.overtimePay);
  const sundayPay = Number(item.sundayPay ?? 0);
  const publicHolidayPay = Number(item.publicHolidayPay ?? 0);
  const grossPay = Number(item.grossPay);
  const deductions = Number(item.deductions);
  const netPay = Number(item.netPay);

  const earnings = (item.payslip?.earnings as Array<{ name: string; amount: number }>) ?? [];
  const allowances = earnings
    .filter((e) => !CORE_EARNINGS.some((c) => e.name.toLowerCase().includes(c.toLowerCase())))
    .reduce((sum, e) => sum + (e.amount ?? 0), 0);

  const uifEmployer = Number(item.payslip?.uifEmployer ?? 0);
  const sdl = Number(item.payslip?.sdl ?? 0);

  const totalEmployerCost = grossPay + uifEmployer + sdl;

  return {
    basePay,
    overtimePay,
    sundayPay,
    publicHolidayPay,
    allowances: Math.round(allowances * 100) / 100,
    grossPay,
    deductions,
    netPay,
    uifEmployer,
    sdl,
    totalEmployerCost: Math.round(totalEmployerCost * 100) / 100,
    employeeId: item.employeeId,
    payrollRunId: item.payrollRunId,
  };
}

/**
 * Get cost breakdown for all employees in a payroll run.
 */
export async function getEmployeeCostBreakdownsForRun(
  payrollRunId: string,
  companyId: string
): Promise<EmployeeCostBreakdown[]> {
  const items = await prisma.payrollItem.findMany({
    where: { payrollRunId, payrollRun: { companyId } },
    include: { payslip: true },
  });

  const results: EmployeeCostBreakdown[] = [];
  for (const item of items) {
    const breakdown = await calculateEmployeeTrueCost(item.id, companyId);
    if (breakdown) results.push(breakdown);
  }
  return results;
}
