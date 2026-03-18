/**
 * Payroll Compliance Check - Types
 *
 * Rule-based structure for BCEA-aligned payroll validation.
 * Configurable rules, structured results.
 */

export type ComplianceSeverity = "info" | "warning" | "critical";

export type ComplianceEntityType = "employee" | "payroll_run" | "contract" | "payroll_item";

export interface ComplianceCheckResult {
  ruleId: string;
  ruleName: string;
  severity: ComplianceSeverity;
  message: string;
  entityType: ComplianceEntityType;
  entityId: string;
  suggestedAction: string;
  /** When entityType is payroll_item, the related employee ID */
  employeeId?: string;
}

export interface PayrollRiskFlag {
  payrollRunId: string;
  employeeId?: string;
  contractId?: string;
  ruleName: string;
  severity: ComplianceSeverity;
  message: string;
  createdAt: Date;
}

export interface ComplianceRuleConfig {
  enabled: boolean;
  /** e.g. 0.25 for 25% overtime threshold */
  overtimeThresholdPct?: number;
  /** Minimum hours that triggers overwork check */
  maxWeeklyHours?: number;
}

export interface ComplianceContext {
  companyId: string;
  payrollRunId: string;
  payrollRun: {
    periodStart: Date;
    periodEnd: Date;
    status: string;
  };
  items: Array<{
    id: string;
    employeeId: string;
    grossPay: number;
    basePay: number;
    overtimePay: number;
    sundayPay: number | null;
    publicHolidayPay: number | null;
    deductions: number;
    netPay: number;
    hoursWorked: number;
    overtimeHours: number;
    employee: {
      id: string;
      idNumber: string | null;
      taxNumber: string | null;
      status: string;
      employeeType: string;
    };
    payslip: {
      tax: number | null;
      uifEmployee: number | null;
      uifEmployer: number | null;
      sdl: number | null;
      earnings: unknown;
      deductions: unknown;
    } | null;
  }>;
}

export interface ComplianceRule {
  id: string;
  name: string;
  check: (context: ComplianceContext) => Promise<ComplianceCheckResult[]>;
  defaultSeverity: ComplianceSeverity;
  enabled: boolean;
}
