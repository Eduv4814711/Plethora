import type { ComplianceContext, ComplianceCheckResult } from "../types.js";

const RULE_ID = "missing_tax_identifier";
const RULE_NAME = "Missing employee tax identifier";

export async function checkMissingTaxId(context: ComplianceContext): Promise<ComplianceCheckResult[]> {
  const results: ComplianceCheckResult[] = [];

  for (const item of context.items) {
    const emp = item.employee;
    const idNumber = emp.idNumber?.trim();
    const taxNumber = emp.taxNumber?.trim();

    if (!idNumber && !taxNumber) {
      results.push({
        ruleId: RULE_ID,
        ruleName: RULE_NAME,
        severity: "warning",
        message: "Employee has no ID number or tax number on file. Required for PAYE and IRP5.",
        entityType: "employee",
        entityId: emp.id,
        suggestedAction: "Obtain and record employee ID number. Update employee record.",
      });
    }
  }

  return results;
}
