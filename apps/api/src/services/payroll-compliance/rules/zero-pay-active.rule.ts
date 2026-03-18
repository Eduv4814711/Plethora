import type { ComplianceContext, ComplianceCheckResult } from "../types.js";

const RULE_ID = "zero_pay_active_employee";
const RULE_NAME = "Active employee with zero pay";

export async function checkZeroPayActive(context: ComplianceContext): Promise<ComplianceCheckResult[]> {
  const results: ComplianceCheckResult[] = [];

  for (const item of context.items) {
    const grossPay = Number(item.grossPay);
    const status = item.employee.status;

    if (status === "active" && grossPay === 0) {
      results.push({
        ruleId: RULE_ID,
        ruleName: RULE_NAME,
        severity: "warning",
        message: "Active employee has zero gross pay. May indicate missing timesheet or incorrect status.",
        entityType: "employee",
        entityId: item.employeeId,
        suggestedAction: "Verify employee status and timesheet. Ensure hours are captured.",
      });
    }
  }

  return results;
}
