import type { EmployeeStatus, ShiftStatus, PayrollStatus } from "@prisma/client";

// Employee lifecycle: Applicant → Hired → Training → Active → Suspended → Offboarded
export const EMPLOYEE_TRANSITIONS: Record<EmployeeStatus, EmployeeStatus[]> = {
  applicant: ["hired"],
  hired: ["training", "offboarded"],
  training: ["active", "offboarded"],
  active: ["suspended", "offboarded"],
  suspended: ["active", "offboarded"],
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

// Payroll lifecycle: Draft → Calculated → Approved → Paid
export const PAYROLL_TRANSITIONS: Record<PayrollStatus, PayrollStatus[]> = {
  draft: ["calculated"],
  calculated: ["approved", "draft"],
  approved: ["paid"],
  paid: [],
};

export function canTransitionPayroll(
  from: PayrollStatus,
  to: PayrollStatus
): boolean {
  return PAYROLL_TRANSITIONS[from]?.includes(to) ?? false;
}
