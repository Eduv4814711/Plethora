import type { EarningsRule, Employee, PayGrade } from "@prisma/client";
import type { TimesheetAggregate } from "./timesheet.service.js";
import {
  calculatePAYE,
  calculateSDL,
  calculateUIF,
  type PayPeriod,
} from "./tax.service.js";
import {
  PAYROLL_CALCULATION_VERSION,
  type PayrollCalculationSnapshot,
  type PayrollComputedLine,
  type PayrollEarningsRuleSnapshot,
  type PayrollEmployeeCalculationSnapshot,
  type PayrollEmployeeContextSnapshot,
  type PayrollEmployeeOutputSnapshot,
  type PayrollRuleSnapshot,
  type PayrollSdlStatusSnapshot,
  type PayrollTimesheetInputSnapshot,
} from "./payroll-calculation.types.js";

export const DEFAULT_OT_MULTIPLIER = 1.5;
export const DEFAULT_SUNDAY_MULTIPLIER = 2.0;
export const DEFAULT_PUBLIC_HOLIDAY_MULTIPLIER = 2.0;
/** Matches leave day conversion in timesheet aggregation (leave hours / 8). */
export const STANDARD_LEAVE_DAY_HOURS = 8;
const PAY_PERIODS_PER_YEAR: Record<PayPeriod, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
};

export type EmployeeForPayroll = Employee & {
  grade: PayGrade | null;
  siteAssignments?: { siteId: string }[];
  guardSiteEligibilities?: { sitePostId: string }[];
};

export interface PayrollDeductionResult {
  total: number;
  lines: Array<{ name: string; amount: number }>;
}

export interface PayrollCalculationContext {
  payrollRunId: string;
  companyId: string;
  periodStart: Date;
  periodEnd: Date;
  payPeriod: PayPeriod;
  isSdlLiable: boolean;
  timezone: string;
  publicHolidayDates: string[];
  companyPayRules: Map<string, number>;
  companyEarningsRules: EarningsRule[];
  groupPayRulesByGroup: Map<string, Map<string, number>>;
  groupEarningsByGroup: Map<string, EarningsRule[]>;
  aggregates: Map<string, TimesheetAggregate>;
  employees: EmployeeForPayroll[];
  deductionsByEmployee: Map<string, PayrollDeductionResult>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Convert a contractual monthly salary to the amount payable for this run. */
export function monthlySalaryForPayPeriod(
  monthlySalary: number,
  payPeriod: PayPeriod
): number {
  if (!Number.isFinite(monthlySalary) || monthlySalary < 0) return Number.NaN;
  return round2((monthlySalary * 12) / PAY_PERIODS_PER_YEAR[payPeriod]);
}

function resolvePayRules(
  emp: EmployeeForPayroll,
  ctx: PayrollCalculationContext
): PayrollRuleSnapshot {
  const companyRuleMap = ctx.companyPayRules;
  if (emp.groupId != null) {
    const groupRules = ctx.groupPayRulesByGroup.get(emp.groupId);
    if (groupRules && groupRules.size > 0) {
      return {
        overtimeMultiplier: groupRules.get("overtime") ?? DEFAULT_OT_MULTIPLIER,
        sundayMultiplier: groupRules.get("sunday") ?? DEFAULT_SUNDAY_MULTIPLIER,
        publicHolidayMultiplier:
          groupRules.get("public_holiday") ?? DEFAULT_PUBLIC_HOLIDAY_MULTIPLIER,
        source: "group",
        groupId: emp.groupId,
      };
    }
  }
  return {
    overtimeMultiplier: companyRuleMap.get("overtime") ?? DEFAULT_OT_MULTIPLIER,
    sundayMultiplier: companyRuleMap.get("sunday") ?? DEFAULT_SUNDAY_MULTIPLIER,
    publicHolidayMultiplier:
      companyRuleMap.get("public_holiday") ?? DEFAULT_PUBLIC_HOLIDAY_MULTIPLIER,
    source: "company",
  };
}

function resolveEarningsRules(emp: EmployeeForPayroll, ctx: PayrollCalculationContext): EarningsRule[] {
  if (emp.groupId != null) {
    const groupRules = ctx.groupEarningsByGroup.get(emp.groupId);
    if (groupRules && groupRules.length > 0) return groupRules;
  }
  return ctx.companyEarningsRules;
}

function toEarningsRuleSnapshot(er: EarningsRule): PayrollEarningsRuleSnapshot {
  return {
    id: er.id,
    name: er.name,
    type: er.type,
    amount: er.amount != null ? Number(er.amount) : null,
    rate: er.rate != null ? Number(er.rate) : null,
    appliesTo: er.appliesTo,
  };
}

function employeeContext(emp: EmployeeForPayroll): PayrollEmployeeContextSnapshot {
  return {
    employeeId: emp.id,
    employeeNumber: emp.employeeNumber,
    firstName: emp.firstName,
    lastName: emp.lastName,
    status: emp.status,
    employeeType: emp.employeeType,
    groupId: emp.groupId,
    siteId: emp.siteAssignments?.[0]?.siteId ?? null,
    postId: emp.guardSiteEligibilities?.[0]?.sitePostId ?? null,
    gradeId: emp.gradeId,
    gradeName: emp.grade?.name ?? null,
    hourlyRate:
      emp.grade != null
        ? Number(emp.grade.hourlyRate)
        : emp.hourlyRate != null
          ? Number(emp.hourlyRate)
          : 0,
    monthlySalary: emp.monthlySalary != null ? Number(emp.monthlySalary) : 0,
    taxDirectiveNumber: emp.taxDirectiveNumber ?? null,
    taxDirectiveRate:
      emp.taxDirectiveRate != null ? Number(emp.taxDirectiveRate) : null,
  };
}

function timesheetSnapshot(agg: TimesheetAggregate | undefined): PayrollTimesheetInputSnapshot | null {
  if (!agg) return null;
  return {
    basicHours: agg.basicHours,
    overtimeHours: agg.overtimeHours,
    sundayHours: agg.sundayHours,
    publicHolidayHours: agg.publicHolidayHours,
    leaveDays: agg.leaveDays,
    leaveHours: agg.leaveHours,
    unpaidLeaveHours: agg.unpaidLeaveHours ?? 0,
    uifLeaveHours: agg.uifLeaveHours ?? 0,
    iodLeaveHours: agg.iodLeaveHours ?? 0,
    informationLeaveHours: agg.informationLeaveHours ?? 0,
  };
}

/**
 * Pure payroll line computation from a frozen context. Same context yields identical outputs.
 */
export function computePayrollLines(ctx: PayrollCalculationContext): {
  lines: PayrollComputedLine[];
  employeeSnapshots: PayrollEmployeeCalculationSnapshot[];
} {
  const lines: PayrollComputedLine[] = [];
  const employeeSnapshots: PayrollEmployeeCalculationSnapshot[] = [];

  for (const emp of ctx.employees) {
    const rules = resolvePayRules(emp, ctx);
    const earningsRules = resolveEarningsRules(emp, ctx);
    const context = employeeContext(emp);
    const agg = ctx.aggregates.get(emp.id);
    const ts = timesheetSnapshot(agg);

    const hourlyRate = context.hourlyRate;
    const monthlySalary = context.monthlySalary;

    let hoursWorked = 0;
    let overtimeHours = 0;
    let basePay = 0;
    let overtimePay = 0;
    let sundayPay = 0;
    let publicHolidayPay = 0;
    let grossPay = 0;
    const earningsLines: Array<{ name: string; amount: number }> = [];
    const earningsRulesApplied: PayrollEarningsRuleSnapshot[] = [];

    let output: PayrollEmployeeOutputSnapshot;

    const isFixedMonthly = monthlySalary > 0;

    if (isFixedMonthly) {
      const periodSalary = monthlySalaryForPayPeriod(monthlySalary, ctx.payPeriod);
      const standardMonthlyHours = emp.employeeType === "office" ? 195 : 208;
      const standardPeriodHours =
        (standardMonthlyHours * 12) / PAY_PERIODS_PER_YEAR[ctx.payPeriod];
      const unpaidLeaveReduction = round2(
        Math.min(
          periodSalary,
          (agg?.unpaidLeaveHours ?? 0) * (periodSalary / standardPeriodHours)
        )
      );
      const uifLeaveReduction = round2(
        Math.min(
          periodSalary - unpaidLeaveReduction,
          (agg?.uifLeaveHours ?? 0) * (periodSalary / standardPeriodHours)
        )
      );
      grossPay = round2(periodSalary - unpaidLeaveReduction - uifLeaveReduction);
      earningsLines.push({ name: "Basic Salary", amount: periodSalary });
      if (unpaidLeaveReduction > 0) {
        earningsLines.push({ name: "Unpaid Leave Reduction", amount: -unpaidLeaveReduction });
      }
      if (uifLeaveReduction > 0) {
        earningsLines.push({ name: "UIF-supported Leave Reduction", amount: -uifLeaveReduction });
      }
    } else {
      if (hourlyRate === 0 && monthlySalary === 0) {
        const skipReason =
          emp.employeeType === "office" ? "missing_monthly_salary" : "missing_pay_rate";
        output = {
          hoursWorked: 0,
          overtimeHours: 0,
          basePay: 0,
          overtimePay: 0,
          sundayPay: 0,
          publicHolidayPay: 0,
          grossPay: 0,
          deductions: 0,
          netPay: 0,
          tax: 0,
          taxableEarnings: 0,
          uifEmployee: 0,
          uifEmployer: 0,
          sdl: 0,
          earningsLines: [],
          deductionLines: [],
          skipped: true,
          skipReason,
        };
        employeeSnapshots.push({
          context,
          rules,
          earningsRulesApplied: [],
          timesheet: ts,
          output,
        });
        continue;
      }

      const leaveHours = agg
        ? agg.leaveHours > 0
          ? agg.leaveHours
          : agg.leaveDays * STANDARD_LEAVE_DAY_HOURS
        : 0;
      const hasWorkedHours =
        !!agg &&
        (agg.basicHours > 0 ||
          agg.overtimeHours > 0 ||
          agg.sundayHours > 0 ||
          agg.publicHolidayHours > 0);

      if (!hasWorkedHours && leaveHours === 0) {
        const skipReason = "no_timesheet_hours";
        output = {
          hoursWorked: 0,
          overtimeHours: 0,
          basePay: 0,
          overtimePay: 0,
          sundayPay: 0,
          publicHolidayPay: 0,
          grossPay: 0,
          deductions: 0,
          netPay: 0,
          tax: 0,
          taxableEarnings: 0,
          uifEmployee: 0,
          uifEmployer: 0,
          sdl: 0,
          earningsLines: [],
          deductionLines: [],
          skipped: true,
          skipReason,
        };
        employeeSnapshots.push({
          context,
          rules,
          earningsRulesApplied: [],
          timesheet: ts,
          output,
        });
        continue;
      }

      const workedBasicHours = agg?.basicHours ?? 0;
      hoursWorked = round2(workedBasicHours + leaveHours);
      overtimeHours = agg?.overtimeHours ?? 0;
      const workedBasePay = round2(workedBasicHours * hourlyRate);
      const leavePay = round2(leaveHours * hourlyRate);
      basePay = round2(workedBasePay + leavePay);
      overtimePay = round2((agg?.overtimeHours ?? 0) * hourlyRate * rules.overtimeMultiplier);
      sundayPay = round2((agg?.sundayHours ?? 0) * hourlyRate * rules.sundayMultiplier);
      publicHolidayPay = round2(
        (agg?.publicHolidayHours ?? 0) * hourlyRate * rules.publicHolidayMultiplier
      );
      grossPay = round2(basePay + overtimePay + sundayPay + publicHolidayPay);

      if (workedBasePay > 0) earningsLines.push({ name: "Basic", amount: workedBasePay });
      if (leavePay > 0) earningsLines.push({ name: "Paid Leave", amount: leavePay });
      if (overtimePay > 0) earningsLines.push({ name: "Overtime", amount: overtimePay });
      if (sundayPay > 0) earningsLines.push({ name: "Sunday", amount: sundayPay });
      if (publicHolidayPay > 0) earningsLines.push({ name: "Public Holiday", amount: publicHolidayPay });
    }

    const empType = emp.employeeType ?? "security";
    const baseForPct = isFixedMonthly ? grossPay : basePay;
    for (const er of earningsRules) {
      const applies =
        er.appliesTo === "all" ||
        (er.appliesTo === "security" && empType !== "office") ||
        (er.appliesTo === "office" && empType === "office");
      if (!applies) continue;

      let amount = 0;
      if (er.type === "fixed" && er.amount != null) {
        amount = Number(er.amount);
      } else if (er.type === "percentage" && er.rate != null && baseForPct > 0) {
        amount = (Number(er.rate) / 100) * baseForPct;
      }
      if (amount > 0) {
        amount = round2(amount);
        grossPay = round2(grossPay + amount);
        earningsLines.push({ name: er.name, amount });
        earningsRulesApplied.push(toEarningsRuleSnapshot(er));
      }
    }

    const taxableEarnings = grossPay;
    const paye = calculatePAYE(taxableEarnings, ctx.payPeriod, emp);
    const { employee: uifEmployee, employer: uifEmployer } = calculateUIF(grossPay, ctx.payPeriod);
    const sdl = calculateSDL(grossPay, ctx.isSdlLiable);

    const ded = ctx.deductionsByEmployee.get(emp.id) ?? { total: 0, lines: [] };
    const deductionLines: Array<{ name: string; amount: number }> = [...ded.lines];
    if (paye > 0) deductionLines.push({ name: "PAYE", amount: paye });
    if (uifEmployee > 0) deductionLines.push({ name: "UIF", amount: uifEmployee });
    const totalDeductions = round2(ded.total + paye + uifEmployee);
    const netPay = round2(grossPay - totalDeductions);

    output = {
      hoursWorked,
      overtimeHours,
      basePay,
      overtimePay,
      sundayPay,
      publicHolidayPay,
      grossPay,
      deductions: totalDeductions,
      netPay,
      tax: paye,
      taxableEarnings,
      uifEmployee,
      uifEmployer,
      sdl,
      earningsLines,
      deductionLines,
    };

    employeeSnapshots.push({
      context,
      rules,
      earningsRulesApplied,
      timesheet: ts,
      output,
    });

    lines.push({
      employeeId: emp.id,
      hoursWorked,
      overtimeHours,
      basePay,
      overtimePay,
      sundayPay,
      publicHolidayPay,
      grossPay,
      deductions: totalDeductions,
      netPay,
      earningsLines,
      deductionLines,
      tax: paye,
      taxableEarnings,
      uifEmployee,
      uifEmployer,
      sdl,
    });
  }

  return { lines, employeeSnapshots };
}

export interface PayrollLineValidationIssue {
  employeeId: string;
  field: string;
  value: number;
  message: string;
}

/**
 * Payroll values are payment instructions. Never persist a line containing a
 * non-finite/negative value or a deduction total that would produce negative
 * net pay.
 */
export function validateComputedPayrollLines(
  lines: PayrollComputedLine[]
): PayrollLineValidationIssue[] {
  const issues: PayrollLineValidationIssue[] = [];
  const nonNegativeFields: Array<keyof PayrollComputedLine> = [
    "hoursWorked",
    "overtimeHours",
    "basePay",
    "overtimePay",
    "sundayPay",
    "publicHolidayPay",
    "grossPay",
    "deductions",
    "netPay",
    "tax",
    "taxableEarnings",
    "uifEmployee",
    "uifEmployer",
    "sdl",
  ];

  for (const line of lines) {
    for (const field of nonNegativeFields) {
      const value = line[field];
      if (typeof value !== "number") continue;
      if (!Number.isFinite(value) || value < 0) {
        issues.push({
          employeeId: line.employeeId,
          field,
          value,
          message: `${field} must be a finite, non-negative amount`,
        });
      }
    }
    if (
      Number.isFinite(line.grossPay) &&
      Number.isFinite(line.deductions) &&
      line.deductions > line.grossPay
    ) {
      issues.push({
        employeeId: line.employeeId,
        field: "deductions",
        value: line.deductions,
        message: "Deductions cannot exceed gross pay",
      });
    }
    for (const deduction of line.deductionLines) {
      if (!Number.isFinite(deduction.amount) || deduction.amount < 0) {
        issues.push({
          employeeId: line.employeeId,
          field: `deduction:${deduction.name}`,
          value: deduction.amount,
          message: "Deduction line must be a finite, non-negative amount",
        });
      }
    }
  }
  return issues;
}

export function buildPayrollCalculationSnapshot(params: {
  ctx: PayrollCalculationContext;
  employeeSnapshots: PayrollEmployeeCalculationSnapshot[];
  lines: PayrollComputedLine[];
  calculatedAt: Date;
  sdlStatus: PayrollSdlStatusSnapshot;
}): PayrollCalculationSnapshot {
  const { ctx, employeeSnapshots, lines, calculatedAt, sdlStatus } = params;
  const companyRules: Record<string, number> = {};
  for (const [k, v] of ctx.companyPayRules) {
    companyRules[k] = v;
  }

  const included = employeeSnapshots.filter((e) => !e.output.skipped);
  const skipped = employeeSnapshots.filter((e) => e.output.skipped);

  const totals = lines.reduce(
    (acc, l) => ({
      grossPay: acc.grossPay + l.grossPay,
      deductions: acc.deductions + l.deductions,
      netPay: acc.netPay + l.netPay,
      tax: acc.tax + l.tax,
      uifEmployee: acc.uifEmployee + l.uifEmployee,
      uifEmployer: acc.uifEmployer + l.uifEmployer,
      sdl: acc.sdl + l.sdl,
    }),
    { grossPay: 0, deductions: 0, netPay: 0, tax: 0, uifEmployee: 0, uifEmployer: 0, sdl: 0 }
  );

  return {
    version: PAYROLL_CALCULATION_VERSION,
    calculatedAt: calculatedAt.toISOString(),
    payrollRunId: ctx.payrollRunId,
    companyId: ctx.companyId,
    inputs: {
      periodStart: ctx.periodStart.toISOString(),
      periodEnd: ctx.periodEnd.toISOString(),
      payPeriod: ctx.payPeriod,
      isSdlLiable: ctx.isSdlLiable,
      sdlStatus,
      timezone: ctx.timezone,
      publicHolidayDates: ctx.publicHolidayDates,
      employeeCount: ctx.employees.length,
      employeesConsidered: ctx.employees.length,
      employeesIncluded: included.length,
      employeesSkipped: skipped.length,
      companyPayRules: companyRules,
      defaultMultipliers: {
        overtime: DEFAULT_OT_MULTIPLIER,
        sunday: DEFAULT_SUNDAY_MULTIPLIER,
        public_holiday: DEFAULT_PUBLIC_HOLIDAY_MULTIPLIER,
      },
    },
    employees: employeeSnapshots,
    totals: {
      grossPay: round2(totals.grossPay),
      deductions: round2(totals.deductions),
      netPay: round2(totals.netPay),
      tax: round2(totals.tax),
      uifEmployee: round2(totals.uifEmployee),
      uifEmployer: round2(totals.uifEmployer),
      sdl: round2(totals.sdl),
    },
  };
}
