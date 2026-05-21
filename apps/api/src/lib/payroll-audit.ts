import { createAuditLog } from "./audit.js";
import type { PayrollCalculationSnapshot } from "../services/payroll-calculation.types.js";

/** Canonical payroll audit action names for traceability. */
export const PAYROLL_AUDIT = {
  CALCULATION: "payroll.calculation",
  APPROVAL: "payroll.approval",
  LOCK: "payroll.lock",
  MARK_PAID: "payroll_run.mark_paid",
  CREATE: "payroll_run.create",
} as const;

export async function auditPayrollCalculation(params: {
  userId?: string;
  companyId: string;
  payrollRunId: string;
  snapshot: PayrollCalculationSnapshot;
}) {
  const { snapshot } = params;
  await createAuditLog({
    userId: params.userId,
    companyId: params.companyId,
    action: PAYROLL_AUDIT.CALCULATION,
    entityType: "payroll_run",
    entityId: params.payrollRunId,
    metadata: {
      version: snapshot.version,
      calculatedAt: snapshot.calculatedAt,
      periodStart: snapshot.inputs.periodStart,
      periodEnd: snapshot.inputs.periodEnd,
      employeesIncluded: snapshot.inputs.employeesIncluded,
      employeesSkipped: snapshot.inputs.employeesSkipped,
      totals: snapshot.totals,
    },
  });
}

export async function auditPayrollApproval(params: {
  userId?: string;
  companyId: string;
  payrollRunId: string;
  lockedAt: string;
  previousStatus: string;
}) {
  await createAuditLog({
    userId: params.userId,
    companyId: params.companyId,
    action: PAYROLL_AUDIT.APPROVAL,
    entityType: "payroll_run",
    entityId: params.payrollRunId,
    metadata: {
      previousStatus: params.previousStatus,
      newStatus: "approved",
    },
  });
}

export async function auditPayrollLock(params: {
  userId?: string;
  companyId: string;
  payrollRunId: string;
  lockedAt: string;
}) {
  await createAuditLog({
    userId: params.userId,
    companyId: params.companyId,
    action: PAYROLL_AUDIT.LOCK,
    entityType: "payroll_run",
    entityId: params.payrollRunId,
    metadata: { lockedAt: params.lockedAt },
  });
}
