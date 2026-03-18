import type { ComplianceContext, ComplianceCheckResult } from "../types.js";

const RULE_ID_PH = "public_holiday_no_premium";
const RULE_NAME_PH = "Public holiday work with no corresponding premium";
const RULE_ID_SUNDAY = "sunday_no_premium";
const RULE_NAME_SUNDAY = "Sunday work with no corresponding premium";

/**
 * Flags when earnings show public holiday or Sunday work but premium is zero.
 * Does not flag employees who only worked weekdays (avoids false positives).
 */
export async function checkPremiumPay(context: ComplianceContext): Promise<ComplianceCheckResult[]> {
  const results: ComplianceCheckResult[] = [];

  for (const item of context.items) {
    const earnings = (item.payslip?.earnings as Array<{ name: string; amount: number }>) ?? [];

    const phEarning = earnings.find(
      (e) => e.name.toLowerCase().includes("public") || e.name.toLowerCase().includes("holiday")
    );
    const sundayEarning = earnings.find((e) => e.name.toLowerCase().includes("sunday"));

    if (phEarning && Number(phEarning.amount) === 0) {
      results.push({
        ruleId: RULE_ID_PH,
        ruleName: RULE_NAME_PH,
        severity: "info",
        message: "Public holiday earning line exists but amount is zero.",
        entityType: "payroll_item",
        entityId: item.id,
        employeeId: item.employeeId,
        suggestedAction: "Verify public holiday hours and pay rule multiplier.",
      });
    }

    if (sundayEarning && Number(sundayEarning.amount) === 0) {
      results.push({
        ruleId: RULE_ID_SUNDAY,
        ruleName: RULE_NAME_SUNDAY,
        severity: "info",
        message: "Sunday earning line exists but amount is zero.",
        entityType: "payroll_item",
        entityId: item.id,
        employeeId: item.employeeId,
        suggestedAction: "Verify Sunday hours and pay rule multiplier.",
      });
    }
  }

  return results;
}
