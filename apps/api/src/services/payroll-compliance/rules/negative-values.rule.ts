import type { ComplianceContext, ComplianceCheckResult } from "../types.js";

const RULE_ID = "negative_suspicious_values";
const RULE_NAME = "Negative or suspicious payroll values";

export async function checkNegativeValues(context: ComplianceContext): Promise<ComplianceCheckResult[]> {
  const results: ComplianceCheckResult[] = [];

  for (const item of context.items) {
    const grossPay = Number(item.grossPay);
    const netPay = Number(item.netPay);
    const deductions = Number(item.deductions);
    const basePay = Number(item.basePay);
    const overtimePay = Number(item.overtimePay);

    if (grossPay < 0 || netPay < 0 || deductions < 0) {
      results.push({
        ruleId: RULE_ID,
        ruleName: RULE_NAME,
        severity: "critical",
        message: `Negative value detected: gross=${grossPay}, net=${netPay}, deductions=${deductions}`,
        entityType: "payroll_item",
        entityId: item.id,
        employeeId: item.employeeId,
        suggestedAction: "Investigate and correct payroll calculation. Negative values indicate an error.",
      });
    }

    if (basePay < 0 || overtimePay < 0) {
      results.push({
        ruleId: RULE_ID,
        ruleName: RULE_NAME,
        severity: "critical",
        message: `Negative pay component: basePay=${basePay}, overtimePay=${overtimePay}`,
        entityType: "payroll_item",
        entityId: item.id,
        employeeId: item.employeeId,
        suggestedAction: "Check timesheet and pay rule configuration.",
      });
    }

    const payslip = item.payslip;
    if (payslip) {
      const tax = Number(payslip.tax ?? 0);
      const uifE = Number(payslip.uifEmployee ?? 0);
      const uifEr = Number(payslip.uifEmployer ?? 0);
      const sdl = Number(payslip.sdl ?? 0);
      if (tax < 0 || uifE < 0 || uifEr < 0 || sdl < 0) {
        results.push({
          ruleId: RULE_ID,
          ruleName: RULE_NAME,
          severity: "critical",
          message: "Negative statutory deduction on payslip.",
          entityType: "payroll_item",
          entityId: item.id,
          employeeId: item.employeeId,
          suggestedAction: "Verify tax service calculation.",
        });
      }
    }
  }

  return results;
}
