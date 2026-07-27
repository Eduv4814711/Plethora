import type { ComplianceContext, ComplianceCheckResult } from "../types.js";

const RULE_ID_PH = "public_holiday_no_premium";
const RULE_NAME_PH = "Public holiday work with no corresponding premium";
const RULE_ID_SUNDAY = "sunday_no_premium";
const RULE_NAME_SUNDAY = "Sunday work with no corresponding premium";

/**
 * Flags when the timesheet shows public holiday or Sunday hours worked but the resulting
 * premium pay is zero. Compares raw hours from the timesheet aggregate (`sundayHours`/
 * `publicHolidayHours`) against the persisted `sundayPay`/`publicHolidayPay` amounts —
 * an earnings-line-name scan can't do this because the payroll engine only ever pushes a
 * "Sunday"/"Public Holiday" earnings line when its amount is greater than zero, so a
 * genuinely-missing premium never has a zero-amount line to find.
 */
export async function checkPremiumPay(context: ComplianceContext): Promise<ComplianceCheckResult[]> {
  const results: ComplianceCheckResult[] = [];

  for (const item of context.items) {
    const publicHolidayPay = Number(item.publicHolidayPay ?? 0);
    if ((item.publicHolidayHours ?? 0) > 0 && publicHolidayPay <= 0) {
      results.push({
        ruleId: RULE_ID_PH,
        ruleName: RULE_NAME_PH,
        severity: "info",
        message: `Timesheet shows ${item.publicHolidayHours} public holiday hour(s) worked, but public holiday pay is zero.`,
        entityType: "payroll_item",
        entityId: item.id,
        employeeId: item.employeeId,
        suggestedAction: "Verify the public holiday pay rule multiplier for this employee.",
      });
    }

    const sundayPay = Number(item.sundayPay ?? 0);
    if ((item.sundayHours ?? 0) > 0 && sundayPay <= 0) {
      results.push({
        ruleId: RULE_ID_SUNDAY,
        ruleName: RULE_NAME_SUNDAY,
        severity: "info",
        message: `Timesheet shows ${item.sundayHours} Sunday hour(s) worked, but Sunday pay is zero.`,
        entityType: "payroll_item",
        entityId: item.id,
        employeeId: item.employeeId,
        suggestedAction: "Verify the Sunday pay rule multiplier for this employee.",
      });
    }
  }

  return results;
}
