/**
 * Central permission constants and preset definitions.
 * Server is source of truth — mirror subset in apps/web for UX only.
 */

export const PERMISSIONS = {
  // Dashboard and operational workflow
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
  // Employees
  EMPLOYEES_READ_OPERATIONAL: "employees.read_operational",
  EMPLOYEES_MANAGE_OPERATIONAL: "employees.manage_operational",
  EMPLOYEES_READ_PRIVATE: "employees.read_private",
  EMPLOYEES_MANAGE_PRIVATE: "employees.manage_private",

  // Compensation
  COMPENSATION_READ: "compensation.read",
  COMPENSATION_MANAGE: "compensation.manage",

  // Pay grades
  PAY_GRADES_READ_NAMES: "pay_grades.read_names",
  PAY_GRADES_READ_RATES: "pay_grades.read_rates",
  PAY_GRADES_MANAGE_RATES: "pay_grades.manage_rates",

  // Payroll
  PAYROLL_STATUS_READ: "payroll.status.read",
  PAYROLL_RUN_READ: "payroll.run.read",
  PAYROLL_CALCULATE: "payroll.calculate",
  PAYROLL_APPROVE: "payroll.approve",
  PAYROLL_REVERT: "payroll.revert",
  PAYROLL_MARK_PAID: "payroll.mark_paid",
  PAYROLL_EXPORT: "payroll.export",
  PAYSLIP_READ: "payslip.read",

  // Documents
  DOCUMENTS_READ_OPERATIONAL: "documents.read_operational",
  DOCUMENTS_MANAGE_OPERATIONAL: "documents.manage_operational",
  DOCUMENTS_READ_HR: "documents.read_hr",
  DOCUMENTS_MANAGE_HR: "documents.manage_hr",
  DOCUMENTS_READ_PAYROLL: "documents.read_payroll",
  DOCUMENTS_MANAGE_PAYROLL: "documents.manage_payroll",
  DOCUMENTS_READ_MEDICAL: "documents.read_medical",

  // Leave & sick notes
  LEAVE_READ: "leave.read",
  LEAVE_MANAGE: "leave.manage",
  SICK_NOTES_READ: "sick_notes.read",
  SICK_NOTES_MANAGE: "sick_notes.manage",

  // Reports
  REPORTS_READ_OPERATIONAL: "reports.read_operational",
  REPORTS_READ_FINANCIAL: "reports.read_financial",

  // Settings
  SETTINGS_MANAGE_OPERATIONAL: "settings.manage_operational",
  SETTINGS_MANAGE_STATUTORY: "settings.manage_statutory",

  // Users & permissions
  USERS_MANAGE: "users.manage",
  PERMISSIONS_MANAGE_OPERATIONAL: "permissions.manage_operational",
  PERMISSIONS_GRANT_SENSITIVE: "permissions.grant_sensitive",
  ACCESS_REVIEWS_MANAGE: "access_reviews.manage",
  MFA_MANAGE: "mfa.manage",
  SYSTEM_ADMINS_REQUEST: "system_admins.request",
  SYSTEM_ADMINS_APPROVE: "system_admins.approve",

  // Audit
  AUDIT_READ: "audit.read",
  AUDIT_READ_SENSITIVE: "audit.read_sensitive",
  AUDIT_EXPORT: "audit.export",
  DATA_QUALITY_READ: "data_quality.read",
  DATA_QUALITY_MANAGE: "data_quality.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** Permissions that grant access to confidential HR/finance data */
export const SENSITIVE_PERMISSIONS: Permission[] = [
  PERMISSIONS.EMPLOYEES_READ_PRIVATE,
  PERMISSIONS.EMPLOYEES_MANAGE_PRIVATE,
  PERMISSIONS.COMPENSATION_READ,
  PERMISSIONS.COMPENSATION_MANAGE,
  PERMISSIONS.PAY_GRADES_READ_RATES,
  PERMISSIONS.PAY_GRADES_MANAGE_RATES,
  PERMISSIONS.PAYROLL_RUN_READ,
  PERMISSIONS.PAYROLL_CALCULATE,
  PERMISSIONS.PAYROLL_APPROVE,
  PERMISSIONS.PAYROLL_REVERT,
  PERMISSIONS.PAYROLL_MARK_PAID,
  PERMISSIONS.PAYROLL_EXPORT,
  PERMISSIONS.PAYSLIP_READ,
  PERMISSIONS.DOCUMENTS_READ_HR,
  PERMISSIONS.DOCUMENTS_MANAGE_HR,
  PERMISSIONS.DOCUMENTS_READ_PAYROLL,
  PERMISSIONS.DOCUMENTS_MANAGE_PAYROLL,
  PERMISSIONS.DOCUMENTS_READ_MEDICAL,
  PERMISSIONS.SICK_NOTES_READ,
  PERMISSIONS.SICK_NOTES_MANAGE,
  PERMISSIONS.REPORTS_READ_FINANCIAL,
  PERMISSIONS.SETTINGS_MANAGE_STATUTORY,
  PERMISSIONS.PERMISSIONS_GRANT_SENSITIVE,
  PERMISSIONS.ACCESS_REVIEWS_MANAGE,
  PERMISSIONS.SYSTEM_ADMINS_APPROVE,
  PERMISSIONS.MFA_MANAGE,
  PERMISSIONS.AUDIT_READ_SENSITIVE,
  PERMISSIONS.AUDIT_EXPORT,
];

export const PRESET_KEYS = {
  SYSTEM_OWNER: "system_owner",
  OPERATIONAL_ADMIN: "operational_admin",
  HR: "hr",
  FINANCE: "finance",
  HR_FINANCE: "hr_finance",
  OPERATIONS_MANAGER: "operations_manager",
  SUPERVISOR: "supervisor",
  CONTROLLER: "controller",
  CLIENT: "client",
} as const;

export type PresetKey = (typeof PRESET_KEYS)[keyof typeof PRESET_KEYS];

const OPERATIONAL_BASE: Permission[] = [
  PERMISSIONS.DASHBOARD_READ,
  PERMISSIONS.WORK_QUEUE_READ,
  PERMISSIONS.SITES_READ,
  PERMISSIONS.SITES_MANAGE,
  PERMISSIONS.ROSTERS_READ,
  PERMISSIONS.ROSTERS_MANAGE,
  PERMISSIONS.ROSTERS_PUBLISH,
  PERMISSIONS.ATTENDANCE_READ,
  PERMISSIONS.ATTENDANCE_CAPTURE,
  PERMISSIONS.ATTENDANCE_MANAGE,
  PERMISSIONS.TIMESHEETS_READ,
  PERMISSIONS.TIMESHEETS_MANAGE,
  PERMISSIONS.TIMESHEETS_APPROVE,
  PERMISSIONS.TASKS_READ,
  PERMISSIONS.TASKS_MANAGE,
  PERMISSIONS.INCIDENTS_READ,
  PERMISSIONS.INCIDENTS_MANAGE,
  PERMISSIONS.APPROVALS_READ,
  PERMISSIONS.APPROVALS_REVIEW,
  PERMISSIONS.DATA_QUALITY_READ,
  PERMISSIONS.DATA_QUALITY_MANAGE,
  PERMISSIONS.EMPLOYEES_READ_OPERATIONAL,
  PERMISSIONS.EMPLOYEES_MANAGE_OPERATIONAL,
  PERMISSIONS.PAY_GRADES_READ_NAMES,
  PERMISSIONS.PAYROLL_STATUS_READ,
  PERMISSIONS.DOCUMENTS_READ_OPERATIONAL,
  PERMISSIONS.DOCUMENTS_MANAGE_OPERATIONAL,
  PERMISSIONS.LEAVE_READ,
  PERMISSIONS.REPORTS_READ_OPERATIONAL,
  PERMISSIONS.SETTINGS_MANAGE_OPERATIONAL,
  PERMISSIONS.AUDIT_READ,
];

export const PERMISSION_PRESETS: Record<PresetKey, { name: string; description: string; permissions: Permission[] }> = {
  [PRESET_KEYS.SYSTEM_OWNER]: {
    name: "System Owner",
    description: "Full access to all platform capabilities including sensitive data",
    permissions: [...ALL_PERMISSIONS],
  },
  [PRESET_KEYS.OPERATIONAL_ADMIN]: {
    name: "Operational Administrator",
    description: "Broad operational access without confidential HR/finance data",
    permissions: [
      ...OPERATIONAL_BASE,
      PERMISSIONS.USERS_MANAGE,
      PERMISSIONS.PERMISSIONS_MANAGE_OPERATIONAL,
      PERMISSIONS.ACCESS_REVIEWS_MANAGE,
      PERMISSIONS.MFA_MANAGE,
      PERMISSIONS.AUDIT_EXPORT,
    ],
  },
  [PRESET_KEYS.HR]: {
    name: "HR",
    description: "HR confidential employee records and medical documents",
    permissions: [
      ...OPERATIONAL_BASE,
      PERMISSIONS.EMPLOYEES_READ_PRIVATE,
      PERMISSIONS.EMPLOYEES_MANAGE_PRIVATE,
      PERMISSIONS.DOCUMENTS_READ_HR,
      PERMISSIONS.DOCUMENTS_MANAGE_HR,
      PERMISSIONS.DOCUMENTS_READ_MEDICAL,
      PERMISSIONS.LEAVE_MANAGE,
      PERMISSIONS.SICK_NOTES_READ,
      PERMISSIONS.SICK_NOTES_MANAGE,
      PERMISSIONS.COMPENSATION_READ,
    ],
  },
  [PRESET_KEYS.FINANCE]: {
    name: "Finance",
    description: "Payroll, compensation, and financial reporting",
    permissions: [
      ...OPERATIONAL_BASE,
      PERMISSIONS.COMPENSATION_READ,
      PERMISSIONS.COMPENSATION_MANAGE,
      PERMISSIONS.PAY_GRADES_READ_RATES,
      PERMISSIONS.PAY_GRADES_MANAGE_RATES,
      PERMISSIONS.PAYROLL_RUN_READ,
      PERMISSIONS.PAYROLL_CALCULATE,
      PERMISSIONS.PAYROLL_APPROVE,
      PERMISSIONS.PAYROLL_REVERT,
      PERMISSIONS.PAYROLL_MARK_PAID,
      PERMISSIONS.PAYROLL_EXPORT,
      PERMISSIONS.PAYSLIP_READ,
      PERMISSIONS.DOCUMENTS_READ_PAYROLL,
      PERMISSIONS.DOCUMENTS_MANAGE_PAYROLL,
      PERMISSIONS.REPORTS_READ_FINANCIAL,
      PERMISSIONS.SETTINGS_MANAGE_STATUTORY,
    ],
  },
  [PRESET_KEYS.HR_FINANCE]: {
    name: "HR & Finance",
    description: "Combined HR and finance access (legacy hr_payroll mapping)",
    permissions: [
      ...new Set<Permission>([
        ...OPERATIONAL_BASE,
        PERMISSIONS.EMPLOYEES_READ_PRIVATE,
        PERMISSIONS.EMPLOYEES_MANAGE_PRIVATE,
        PERMISSIONS.DOCUMENTS_READ_HR,
        PERMISSIONS.DOCUMENTS_MANAGE_HR,
        PERMISSIONS.DOCUMENTS_READ_MEDICAL,
        PERMISSIONS.LEAVE_MANAGE,
        PERMISSIONS.SICK_NOTES_READ,
        PERMISSIONS.SICK_NOTES_MANAGE,
        PERMISSIONS.COMPENSATION_READ,
        PERMISSIONS.COMPENSATION_MANAGE,
        PERMISSIONS.PAY_GRADES_READ_RATES,
        PERMISSIONS.PAY_GRADES_MANAGE_RATES,
        PERMISSIONS.PAYROLL_RUN_READ,
        PERMISSIONS.PAYROLL_CALCULATE,
        PERMISSIONS.PAYROLL_APPROVE,
        PERMISSIONS.PAYROLL_REVERT,
        PERMISSIONS.PAYROLL_MARK_PAID,
        PERMISSIONS.PAYROLL_EXPORT,
        PERMISSIONS.PAYSLIP_READ,
        PERMISSIONS.DOCUMENTS_READ_PAYROLL,
        PERMISSIONS.DOCUMENTS_MANAGE_PAYROLL,
        PERMISSIONS.REPORTS_READ_FINANCIAL,
        PERMISSIONS.SETTINGS_MANAGE_STATUTORY,
        PERMISSIONS.USERS_MANAGE,
      PERMISSIONS.PERMISSIONS_MANAGE_OPERATIONAL,
        PERMISSIONS.ACCESS_REVIEWS_MANAGE,
        PERMISSIONS.MFA_MANAGE,
        PERMISSIONS.AUDIT_EXPORT,
      ]),
    ],
  },
  [PRESET_KEYS.OPERATIONS_MANAGER]: {
    name: "Operations Manager",
    description: "Operational management without user administration",
    permissions: [...OPERATIONAL_BASE],
  },
  [PRESET_KEYS.SUPERVISOR]: {
    name: "Supervisor",
    description: "Supervisory operational access",
    permissions: [
      PERMISSIONS.EMPLOYEES_READ_OPERATIONAL,
      PERMISSIONS.PAY_GRADES_READ_NAMES,
      PERMISSIONS.PAYROLL_STATUS_READ,
      PERMISSIONS.DOCUMENTS_READ_OPERATIONAL,
      PERMISSIONS.LEAVE_READ,
      PERMISSIONS.REPORTS_READ_OPERATIONAL,
      PERMISSIONS.DASHBOARD_READ,
      PERMISSIONS.WORK_QUEUE_READ,
      PERMISSIONS.SITES_READ,
      PERMISSIONS.ROSTERS_READ,
      PERMISSIONS.ROSTERS_MANAGE,
      PERMISSIONS.ROSTERS_PUBLISH,
      PERMISSIONS.ATTENDANCE_READ,
      PERMISSIONS.ATTENDANCE_CAPTURE,
      PERMISSIONS.ATTENDANCE_MANAGE,
      PERMISSIONS.TIMESHEETS_READ,
      PERMISSIONS.TIMESHEETS_MANAGE,
      PERMISSIONS.TIMESHEETS_APPROVE,
      PERMISSIONS.TASKS_READ,
      PERMISSIONS.TASKS_MANAGE,
      PERMISSIONS.INCIDENTS_READ,
      PERMISSIONS.INCIDENTS_MANAGE,
      PERMISSIONS.APPROVALS_READ,
      PERMISSIONS.APPROVALS_REVIEW,
      PERMISSIONS.DATA_QUALITY_READ,
    ],
  },
  [PRESET_KEYS.CONTROLLER]: {
    name: "Controller",
    description: "Rostering and attendance operational access",
    permissions: [
      PERMISSIONS.EMPLOYEES_READ_OPERATIONAL,
      PERMISSIONS.PAY_GRADES_READ_NAMES,
      PERMISSIONS.PAYROLL_STATUS_READ,
      PERMISSIONS.DOCUMENTS_READ_OPERATIONAL,
      PERMISSIONS.LEAVE_READ,
      PERMISSIONS.DASHBOARD_READ,
      PERMISSIONS.WORK_QUEUE_READ,
      PERMISSIONS.SITES_READ,
      PERMISSIONS.ROSTERS_READ,
      PERMISSIONS.ATTENDANCE_READ,
      PERMISSIONS.ATTENDANCE_CAPTURE,
      PERMISSIONS.TIMESHEETS_READ,
      PERMISSIONS.TIMESHEETS_MANAGE,
      PERMISSIONS.TASKS_READ,
      PERMISSIONS.INCIDENTS_READ,
      PERMISSIONS.APPROVALS_READ,
    ],
  },
  [PRESET_KEYS.CLIENT]: {
    name: "Client",
    description: "Client portal access only",
    permissions: [PERMISSIONS.DOCUMENTS_READ_OPERATIONAL, PERMISSIONS.INCIDENTS_READ],
  },
};

export function isSensitivePermission(permission: string): boolean {
  return (SENSITIVE_PERMISSIONS as string[]).includes(permission);
}

export function permissionsForPreset(key: PresetKey): Permission[] {
  return PERMISSION_PRESETS[key]?.permissions ?? [];
}

/** Map UserRole to default preset key for migration */
export function defaultPresetForRole(role: string, isSystemOwner: boolean): PresetKey {
  if (isSystemOwner) return PRESET_KEYS.SYSTEM_OWNER;
  switch (role) {
    case "admin":
      return PRESET_KEYS.OPERATIONAL_ADMIN;
    case "operations_manager":
      return PRESET_KEYS.OPERATIONS_MANAGER;
    case "hr_payroll":
      return PRESET_KEYS.HR_FINANCE;
    case "supervisor":
      return PRESET_KEYS.SUPERVISOR;
    case "controller":
      return PRESET_KEYS.CONTROLLER;
    case "client":
      return PRESET_KEYS.CLIENT;
    default:
      return PRESET_KEYS.SUPERVISOR;
  }
}

import type { DocumentSensitivity } from "@prisma/client";

/** Document sensitivity levels a user may access based on permissions */
export function authorizedDocumentSensitivities(permissions: Set<string>): DocumentSensitivity[] {
  const out: DocumentSensitivity[] = [];
  if (permissions.has(PERMISSIONS.DOCUMENTS_READ_OPERATIONAL)) {
    out.push("PUBLIC_OPERATIONAL", "INTERNAL_OPERATIONAL");
  }
  if (permissions.has(PERMISSIONS.DOCUMENTS_READ_HR)) {
    out.push("HR_CONFIDENTIAL");
  }
  if (permissions.has(PERMISSIONS.DOCUMENTS_READ_PAYROLL)) {
    out.push("PAYROLL_CONFIDENTIAL");
  }
  if (permissions.has(PERMISSIONS.DOCUMENTS_READ_MEDICAL)) {
    out.push("MEDICAL_RESTRICTED");
  }
  return [...new Set(out)];
}
