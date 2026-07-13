import type { Prisma } from "@prisma/client";
import type { UserAccessRecord } from "../services/user-access.service.js";
import { hasPermission } from "../services/user-access.service.js";
import { PERMISSIONS } from "./permissions.js";

/** Operational fields safe for rostering, attendance, and general ops */
export const employeeOperationalSelect = {
  id: true,
  companyId: true,
  employeeNumber: true,
  firstName: true,
  lastName: true,
  phone: true,
  status: true,
  employeeType: true,
  jobRole: true,
  gender: true,
  gradeId: true,
  groupId: true,
  psiraNumber: true,
  psiraExpiryDate: true,
  trainingCompleted: true,
  commencementDate: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmployeeSelect;

/** HR-private fields */
export const employeeHrPrivateSelect = {
  idNumber: true,
  dateOfBirth: true,
  maritalStatus: true,
  email: true,
  physicalAddress: true,
  postalAddress: true,
  postalCode: true,
  occupation: true,
  placeOfWork: true,
  ordinaryHours: true,
  ordinaryDays: true,
  leaveEntitlement: true,
  noticePeriod: true,
  previousService: true,
  securityServiceType: true,
  nextOfKin1Name: true,
  nextOfKin1Phone: true,
  nextOfKin2Name: true,
  nextOfKin2Phone: true,
  nextOfKin3Name: true,
  nextOfKin3Phone: true,
  residedOutsideSA: true,
  militaryPoliceService: true,
  criminalInvestigation: true,
  mentallyUnstable: true,
} satisfies Prisma.EmployeeSelect;

/** Compensation and finance fields */
export const employeeCompensationSelect = {
  hourlyRate: true,
  monthlySalary: true,
  overtimeRate: true,
  payFrequency: true,
  taxNumber: true,
  taxDirectiveNumber: true,
  taxDirectiveRate: true,
  bankName: true,
  bankAccountNumber: true,
  bankBranchCode: true,
} satisfies Prisma.EmployeeSelect;

export const employeeGradeOperationalSelect = {
  id: true,
  name: true,
  groupId: true,
} satisfies Prisma.PayGradeSelect;

/** @deprecated use employeeOperationalSelect */
export const employeeListSelect = employeeOperationalSelect;

/** @deprecated use combined selects */
export const employeeDetailSelect = {
  ...employeeOperationalSelect,
  ...employeeHrPrivateSelect,
} satisfies Prisma.EmployeeSelect;

/** @deprecated use employeeCompensationSelect */
export const employeePayrollSelect = {
  ...employeeDetailSelect,
  ...employeeCompensationSelect,
} satisfies Prisma.EmployeeSelect;

export const employeePrivateAdminSelect = employeePayrollSelect;

export const FORBIDDEN_OPERATIONAL_FIELDS = [
  "hourlyRate",
  "monthlySalary",
  "overtimeRate",
  "taxNumber",
  "taxDirectiveNumber",
  "taxDirectiveRate",
  "bankName",
  "bankAccountNumber",
  "bankBranchCode",
  "idNumber",
  "dateOfBirth",
  "maritalStatus",
  "physicalAddress",
  "postalAddress",
  "postalCode",
  "nextOfKin1Name",
  "nextOfKin1Phone",
  "nextOfKin2Name",
  "nextOfKin2Phone",
  "nextOfKin3Name",
  "nextOfKin3Phone",
  "criminalInvestigation",
  "mentallyUnstable",
  "militaryPoliceService",
  "residedOutsideSA",
] as const;

export function rejectForbiddenOperationalFields(
  body: Record<string, unknown>
): { forbidden: string[] } | null {
  const forbidden = FORBIDDEN_OPERATIONAL_FIELDS.filter(
    (key) => body[key] !== undefined && body[key] !== null && body[key] !== ""
  );
  return forbidden.length > 0 ? { forbidden: [...forbidden] } : null;
}

export function canReadEmployeePrivate(access?: UserAccessRecord): boolean {
  return hasPermission(access, PERMISSIONS.EMPLOYEES_READ_PRIVATE);
}

export function canManageEmployeePrivate(access?: UserAccessRecord): boolean {
  return hasPermission(access, PERMISSIONS.EMPLOYEES_MANAGE_PRIVATE);
}

export function canReadCompensation(access?: UserAccessRecord): boolean {
  return hasPermission(access, PERMISSIONS.COMPENSATION_READ);
}

export function canManageCompensation(access?: UserAccessRecord): boolean {
  return hasPermission(access, PERMISSIONS.COMPENSATION_MANAGE);
}

/** @deprecated use permission-based checks with request.access */
export function canViewEmployeeSensitiveFields(_user: unknown): boolean {
  return false;
}

export function compensationSetupPending(employee: {
  hourlyRate?: unknown;
  monthlySalary?: unknown;
  employeeType?: string;
}): boolean {
  if (employee.employeeType === "office") {
    return employee.monthlySalary == null;
  }
  return employee.hourlyRate == null;
}

export function maskBankAccountLast4(account?: string | null): string | null {
  if (!account) return null;
  const digits = account.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `****${digits.slice(-4)}`;
}

export function enrichOperationalEmployee<T extends Record<string, unknown>>(
  row: T,
  compensation?: { hourlyRate?: unknown; monthlySalary?: unknown; employeeType?: string } | null
): T & { compensationSetupPending: boolean } {
  return {
    ...row,
    compensationSetupPending: compensationSetupPending({
      hourlyRate: compensation?.hourlyRate,
      monthlySalary: compensation?.monthlySalary,
      employeeType: (compensation?.employeeType ?? row.employeeType) as string | undefined,
    }),
  };
}

/** @deprecated no longer strips — use operational select instead */
export function sanitizeEmployeeForList<T extends Record<string, unknown>>(
  row: T,
  _user: unknown
): T {
  return row;
}

/** @deprecated no longer strips — use operational select instead */
export function sanitizeEmployeeForDetail<T extends Record<string, unknown>>(
  row: T,
  _user: unknown
): T {
  return row;
}
