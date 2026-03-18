import type { ComplianceContext, ComplianceCheckResult } from "../types.js";

const RULE_ID = "missing_uif_fields";
const RULE_NAME = "Missing UIF-related payroll fields";

export async function checkMissingUifFields(context: ComplianceContext): Promise<ComplianceCheckResult[]> {
  const results: ComplianceCheckResult[] = [];

  for (const item of context.items) {
    const payslip = item.payslip;
    if (!payslip) continue;

    const grossPay = Number(item.grossPay);
    if (grossPay <= 0) continue;

    const uifEmployee = payslip.uifEmployee;
    const uifEmployer = payslip.uifEmployer;

    const hasUifEmployee = uifEmployee != null && Number(uifEmployee) >= 0;
    const hasUifEmployer = uifEmployer != null && Number(uifEmployer) >= 0;

    if (!hasUifEmployee || !hasUifEmployer) {
      results.push({
        ruleId: RULE_ID,
        ruleName: RULE_NAME,
        severity: "critical",
        message: "Payslip is missing UIF employee or employer contribution. Required for statutory compliance.",
        entityType: "payroll_item",
        entityId: item.id,
        employeeId: item.employeeId,
        suggestedAction: "Verify tax calculation includes UIF. Recalculate payroll if needed.",
      });
    }
  }

  return results;
}
