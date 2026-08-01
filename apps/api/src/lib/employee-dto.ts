import type { Prisma } from "@prisma/client";
import type { AuthenticatedUser } from "./types.js";
import { EMPLOYEE_RESTRICTED_FIELDS, canAccessSensitiveData, omitFields } from "./sensitive-data.js";
import { hasCapability } from "./capabilities.js";

export const employeeListSelect = {
  id: true,
  companyId: true,
  employeeNumber: true,
  firstName: true,
  lastName: true,
  phone: true,
  status: true,
  hourlyRate: true,
  monthlySalary: true,
  employeeType: true,
  jobRole: true,
  gender: true,
  gradeId: true,
  groupId: true,
  psiraRegistrationNumber: true,
  psiraRegistrationExpiry: true,
  psiraGrade: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmployeeSelect;

export const employeeDetailSelect = {
  ...employeeListSelect,
  idNumber: true,
  dateOfBirth: true,
  maritalStatus: true,
  email: true,
  physicalAddress: true,
  postalAddress: true,
  postalCode: true,
  commencementDate: true,
  occupation: true,
  placeOfWork: true,
  ordinaryHours: true,
  ordinaryDays: true,
  overtimeRate: true,
  payFrequency: true,
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
  trainingCompleted: true,
} satisfies Prisma.EmployeeSelect;

export const employeePayrollSelect = {
  ...employeeDetailSelect,
  taxNumber: true,
  bankName: true,
  bankAccountNumber: true,
  bankBranchCode: true,
} satisfies Prisma.EmployeeSelect;

export const employeePrivateAdminSelect = employeePayrollSelect;

export function canViewEmployeeSensitiveFields(user: AuthenticatedUser): boolean {
  return canAccessSensitiveData(user, "/employees") || canAccessSensitiveData(user, "/payroll");
}

export function canWriteEmployeeSensitiveFields(
  user: AuthenticatedUser,
  action: "create" | "edit"
): boolean {
  return hasCapability(user, "/employees", action) || hasCapability(user, "/payroll", action);
}

export function canEditEmployeeDetails(user: AuthenticatedUser): boolean {
  return hasCapability(user, "/employees", "edit") || hasCapability(user, "/payroll", "edit");
}

export function sanitizeEmployeeForList<T extends Record<string, unknown>>(
  row: T,
  user: AuthenticatedUser
): T | Omit<T, (typeof EMPLOYEE_RESTRICTED_FIELDS)[number]> {
  if (canViewEmployeeSensitiveFields(user)) return row;
  return omitFields(row, EMPLOYEE_RESTRICTED_FIELDS);
}

export function sanitizeEmployeeForDetail<T extends Record<string, unknown>>(
  row: T,
  user: AuthenticatedUser
): T | Omit<T, (typeof EMPLOYEE_RESTRICTED_FIELDS)[number]> {
  if (canViewEmployeeSensitiveFields(user)) return row;
  return omitFields(row, EMPLOYEE_RESTRICTED_FIELDS);
}

export function maskBankAccountLast4(account?: string | null): string | null {
  if (!account) return null;
  const digits = account.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `****${digits.slice(-4)}`;
}
