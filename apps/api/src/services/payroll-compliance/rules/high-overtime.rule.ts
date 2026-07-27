import type { ComplianceContext, ComplianceCheckResult } from "../types.js";

const RULE_ID = "high_overtime";
const RULE_NAME = "Unusually high overtime";
const RULE_ID_WEEKLY_HOURS = "excessive_weekly_hours";
const RULE_NAME_WEEKLY_HOURS = "Average weekly hours exceed configured limit";

/** Whole weeks in the payroll period, rounded to the nearest week (minimum 1). */
function weeksInPeriod(periodStart: Date, periodEnd: Date): number {
  const days = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1;
  return Math.max(1, Math.round(days / 7));
}

export async function checkHighOvertime(
  context: ComplianceContext,
  overtimeThresholdPct: number = 0.25,
  maxWeeklyHours?: number
): Promise<ComplianceCheckResult[]> {
  const results: ComplianceCheckResult[] = [];
  const weeks = weeksInPeriod(context.payrollRun.periodStart, context.payrollRun.periodEnd);

  for (const item of context.items) {
    const grossPay = Number(item.grossPay);
    const overtimePay = Number(item.overtimePay);

    if (grossPay > 0) {
      const overtimePct = overtimePay / grossPay;
      if (overtimePct > overtimeThresholdPct) {
        results.push({
          ruleId: RULE_ID,
          ruleName: RULE_NAME,
          severity: overtimePct > 0.4 ? "critical" : "warning",
          message: `Overtime is ${(overtimePct * 100).toFixed(1)}% of gross pay (threshold: ${(overtimeThresholdPct * 100)}%). May indicate overwork or BCEA compliance risk.`,
          entityType: "payroll_item",
          entityId: item.id,
          employeeId: item.employeeId,
          suggestedAction: "Review shift patterns and overtime authorisation. Ensure BCEA limits are not exceeded.",
        });
      }
    }

    // Approximate: this payroll period's total hours spread evenly across its weeks —
    // not a true per-week breakdown, so a spike concentrated in one week within a longer
    // period can go undetected. Flag as an average, not a confirmed weekly-limit breach.
    if (maxWeeklyHours != null && maxWeeklyHours > 0) {
      const totalHours = Number(item.hoursWorked) + Number(item.overtimeHours);
      const avgWeeklyHours = totalHours / weeks;
      if (avgWeeklyHours > maxWeeklyHours) {
        results.push({
          ruleId: RULE_ID_WEEKLY_HOURS,
          ruleName: RULE_NAME_WEEKLY_HOURS,
          severity: "warning",
          message: `Average ${avgWeeklyHours.toFixed(1)} hours/week over this ${weeks}-week period exceeds the configured limit of ${maxWeeklyHours} hours/week.`,
          entityType: "payroll_item",
          entityId: item.id,
          employeeId: item.employeeId,
          suggestedAction: "Review weekly shift schedules — this is a period average, not a confirmed single-week breach. Check individual weeks for BCEA compliance.",
        });
      }
    }
  }

  return results;
}
