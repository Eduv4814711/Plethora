/** Mirror of apps/api/src/lib/permissions.ts — UX only; server enforces. */
export const PERMISSIONS = {
  DASHBOARD_READ: "dashboard.read",
  WORK_QUEUE_READ: "work_queue.read",
  SITES_READ: "sites.read",
  SITES_MANAGE: "sites.manage",
  ROSTERS_READ: "rosters.read",
  ROSTERS_MANAGE: "rosters.manage",
  ROSTERS_PUBLISH: "rosters.publish",
  ATTENDANCE_READ: "attendance.read",
  ATTENDANCE_CAPTURE: "attendance.capture",
  ATTENDANCE_MANAGE: "attendance.manage",
  TIMESHEETS_READ: "timesheets.read",
  TIMESHEETS_MANAGE: "timesheets.manage",
  TIMESHEETS_APPROVE: "timesheets.approve",
  TASKS_READ: "tasks.read",
  TASKS_MANAGE: "tasks.manage",
  INCIDENTS_READ: "incidents.read",
  INCIDENTS_MANAGE: "incidents.manage",
  APPROVALS_READ: "approvals.read",
  APPROVALS_REVIEW: "approvals.review",
  ACADEMY_READ: "academy.read",
  ACADEMY_MANAGE: "academy.manage",
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
  ACCESS_REVIEWS_MANAGE: "access_reviews.manage",
  MFA_MANAGE: "mfa.manage",
  SYSTEM_ADMINS_REQUEST: "system_admins.request",
  SYSTEM_ADMINS_APPROVE: "system_admins.approve",
  AUDIT_READ: "audit.read",
  AUDIT_READ_SENSITIVE: "audit.read_sensitive",
  AUDIT_EXPORT: "audit.export",
  DATA_QUALITY_READ: "data_quality.read",
  DATA_QUALITY_MANAGE: "data_quality.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export function can(
  user: {
    role?: string;
    moduleAccess?: unknown;
    permissions?: string[] | null;
    isSystemOwner?: boolean;
  } | null | undefined,
  permission: Permission
): boolean {
  if (!user) return false;
  if (user.isSystemOwner) return true;
  if (user.role === "admin" && user.permissions === undefined && user.moduleAccess == null) return true;
  return user.permissions?.includes(permission) ?? false;
}
