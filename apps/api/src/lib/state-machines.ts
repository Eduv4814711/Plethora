import type { EmployeeStatus, ShiftStatus, PayrollExportBatchStatus } from "@prisma/client";

// Employee lifecycle: Applicant → Hired → Training → Active / Reliever → Suspended → Offboarded
export const EMPLOYEE_TRANSITIONS: Record<EmployeeStatus, EmployeeStatus[]> = {
  applicant: ["hired", "offboarded"],
  hired: ["training", "offboarded"],
  training: ["active", "reliever", "offboarded"],
  active: ["suspended", "reliever", "offboarded"],
  reliever: ["active", "suspended", "offboarded"],
  suspended: ["active", "reliever", "offboarded"],
  offboarded: [],
};

export function canTransitionEmployee(
  from: EmployeeStatus,
  to: EmployeeStatus
): boolean {
  return EMPLOYEE_TRANSITIONS[from]?.includes(to) ?? false;
}

// Shift lifecycle: Created → Assigned → Active → Completed → Verified
export const SHIFT_TRANSITIONS: Record<ShiftStatus, ShiftStatus[]> = {
  created: ["assigned"],
  assigned: ["active", "created"],
  active: ["completed"],
  completed: ["verified"],
  verified: [],
};

export function canTransitionShift(
  from: ShiftStatus,
  to: ShiftStatus
): boolean {
  return SHIFT_TRANSITIONS[from]?.includes(to) ?? false;
}

// Payroll export batch lifecycle: DRAFT -> LOCKED -> EXPORTED (voidable until superseded)
export const PAYROLL_EXPORT_TRANSITIONS: Record<PayrollExportBatchStatus, PayrollExportBatchStatus[]> = {
  DRAFT: ["LOCKED", "VOIDED"],
  LOCKED: ["EXPORTED", "VOIDED"],
  EXPORTED: ["VOIDED"],
  VOIDED: [],
};

export function canTransitionPayrollExport(
  from: PayrollExportBatchStatus,
  to: PayrollExportBatchStatus
): boolean {
  return PAYROLL_EXPORT_TRANSITIONS[from]?.includes(to) ?? false;
}
