import type { PayPeriod } from "./tax.service.js";

/** Version bumps when snapshot shape or formula semantics change intentionally. */
export const PAYROLL_CALCULATION_VERSION = "1.0.0";

export interface PayrollRuleSnapshot {
  overtimeMultiplier: number;
  sundayMultiplier: number;
  publicHolidayMultiplier: number;
  source: "company" | "group";
  groupId?: string;
}

export interface PayrollEarningsRuleSnapshot {
  id: string;
  name: string;
  type: string;
  amount: number | null;
  rate: number | null;
  appliesTo: string;
}

export interface PayrollTimesheetInputSnapshot {
  basicHours: number;
  overtimeHours: number;
  sundayHours: number;
  publicHolidayHours: number;
  leaveDays: number;
}

export interface PayrollEmployeeContextSnapshot {
  employeeId: string;
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  status: string;
  employeeType: string | null;
  groupId: string | null;
  siteId: string | null;
  postId: string | null;
  gradeId: string | null;
  gradeName: string | null;
  hourlyRate: number;
  monthlySalary: number;
}

export interface PayrollEmployeeOutputSnapshot {
  hoursWorked: number;
  overtimeHours: number;
  basePay: number;
  overtimePay: number;
  sundayPay: number;
  publicHolidayPay: number;
  grossPay: number;
  deductions: number;
  netPay: number;
  tax: number;
  taxableEarnings: number;
  uifEmployee: number;
  uifEmployer: number;
  sdl: number;
  earningsLines: Array<{ name: string; amount: number }>;
  deductionLines: Array<{ name: string; amount: number }>;
  skipped?: boolean;
  skipReason?: string;
}

export interface PayrollEmployeeCalculationSnapshot {
  context: PayrollEmployeeContextSnapshot;
  rules: PayrollRuleSnapshot;
  earningsRulesApplied: PayrollEarningsRuleSnapshot[];
  timesheet: PayrollTimesheetInputSnapshot | null;
  output: PayrollEmployeeOutputSnapshot;
}

export interface PayrollCalculationInputsSnapshot {
  periodStart: string;
  periodEnd: string;
  payPeriod: PayPeriod;
  isSdlLiable: boolean;
  timezone: string;
  publicHolidayDates: string[];
  employeeCount: number;
  employeesConsidered: number;
  employeesIncluded: number;
  employeesSkipped: number;
  companyPayRules: Record<string, number>;
  defaultMultipliers: {
    overtime: number;
    sunday: number;
    public_holiday: number;
  };
}

export interface PayrollCalculationTotalsSnapshot {
  grossPay: number;
  deductions: number;
  netPay: number;
  tax: number;
  uifEmployee: number;
  uifEmployer: number;
  sdl: number;
}

export interface PayrollCalculationSnapshot {
  version: string;
  calculatedAt: string;
  payrollRunId: string;
  companyId: string;
  inputs: PayrollCalculationInputsSnapshot;
  employees: PayrollEmployeeCalculationSnapshot[];
  totals: PayrollCalculationTotalsSnapshot;
}

export interface PayrollComputedLine {
  employeeId: string;
  hoursWorked: number;
  overtimeHours: number;
  basePay: number;
  overtimePay: number;
  sundayPay: number;
  publicHolidayPay: number;
  grossPay: number;
  deductions: number;
  netPay: number;
  earningsLines: Array<{ name: string; amount: number }>;
  deductionLines: Array<{ name: string; amount: number }>;
  tax: number;
  taxableEarnings: number;
  uifEmployee: number;
  uifEmployer: number;
  sdl: number;
}
