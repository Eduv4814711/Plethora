/** Mirror of apps/api/src/lib/permissions.ts — UX only; server enforces. */
export const PERMISSIONS = {
  EMPLOYEES_READ_OPERATIONAL: "employees.read_operational",
  EMPLOYEES_MANAGE_OPERATIONAL: "employees.manage_operational",
  EMPLOYEES_READ_PRIVATE: "employees.read_private",
  EMPLOYEES_MANAGE_PRIVATE: "employees.manage_private",
  COMPENSATION_READ: "compensation.read",
  COMPENSATION_MANAGE: "compensation.manage",
  PAY_GRADES_READ_NAMES: "pay_grades.read_names",
  PAY_GRADES_READ_RATES: "pay_grades.read_rates",
  PAY_GRADES_MANAGE_RATES: "pay_grades.manage_rates",
  PAYROLL_STATUS_READ: "payroll.status.read",
  PAYROLL_RUN_READ: "payroll.run.read",
  PAYROLL_CALCULATE: "payroll.calculate",
  PAYROLL_APPROVE: "payroll.approve",
  PAYROLL_REVERT: "payroll.revert",
  PAYROLL_MARK_PAID: "payroll.mark_paid",
  PAYROLL_EXPORT: "payroll.export",
  PAYSLIP_READ: "payslip.read",
  DOCUMENTS_READ_OPERATIONAL: "documents.read_operational",
  DOCUMENTS_MANAGE_OPERATIONAL: "documents.manage_operational",
  DOCUMENTS_READ_HR: "documents.read_hr",
  DOCUMENTS_MANAGE_HR: "documents.manage_hr",
  DOCUMENTS_READ_PAYROLL: "documents.read_payroll",
  DOCUMENTS_MANAGE_PAYROLL: "documents.manage_payroll",
  DOCUMENTS_READ_MEDICAL: "documents.read_medical",
  LEAVE_READ: "leave.read",
  LEAVE_MANAGE: "leave.manage",
  SICK_NOTES_READ: "sick_notes.read",
  SICK_NOTES_MANAGE: "sick_notes.manage",
  REPORTS_READ_OPERATIONAL: "reports.read_operational",
  REPORTS_READ_FINANCIAL: "reports.read_financial",
  SETTINGS_MANAGE_OPERATIONAL: "settings.manage_operational",
  SETTINGS_MANAGE_STATUTORY: "settings.manage_statutory",
  USERS_MANAGE: "users.manage",
  PERMISSIONS_MANAGE_OPERATIONAL: "permissions.manage_operational",
  PERMISSIONS_GRANT_SENSITIVE: "permissions.grant_sensitive",
  AUDIT_READ: "audit.read",
  AUDIT_READ_SENSITIVE: "audit.read_sensitive",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export function can(
  user: { permissions?: string[] | null; isSystemOwner?: boolean } | null | undefined,
  permission: Permission
): boolean {
  if (!user) return false;
  if (user.isSystemOwner) return true;
  return user.permissions?.includes(permission) ?? false;
}
