import type { ComplianceContext, ComplianceCheckResult } from "../types.js";

const RULE_ID = "high_overtime";
const RULE_NAME = "Unusually high overtime";

export async function checkHighOvertime(
  context: ComplianceContext,
  overtimeThresholdPct: number = 0.25
): Promise<ComplianceCheckResult[]> {
  const results: ComplianceCheckResult[] = [];

  for (const item of context.items) {
    const grossPay = Number(item.grossPay);
    const overtimePay = Number(item.overtimePay);

    if (grossPay <= 0) continue;

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

  return results;
}
