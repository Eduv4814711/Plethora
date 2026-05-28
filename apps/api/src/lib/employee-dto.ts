import type { Prisma } from "@prisma/client";
import type { JWTPayload } from "./types.js";
import { normalizeModuleAccess } from "../middleware/rbac.js";

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
  psiraNumber: true,
  psiraExpiryDate: true,
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

const SENSITIVE_KEYS = [
  "idNumber",
  "taxNumber",
  "bankName",
  "bankAccountNumber",
  "bankBranchCode",
] as const;

type SensitiveKey = (typeof SENSITIVE_KEYS)[number];

export function canViewEmployeeSensitiveFields(user: JWTPayload): boolean {
  if (user.role === "admin" && !normalizeModuleAccess(user.moduleAccess)) {
    return true;
  }
  if (user.role === "hr_payroll") return true;
  const modules = normalizeModuleAccess(user.moduleAccess);
  if (!modules) return false;
  return modules.some(
    (m) => m === "/employees" || m === "/payroll" || m.startsWith("/payroll/")
  );
}

function stripSensitive<T extends Record<string, unknown>>(row: T): Omit<T, SensitiveKey> {
  const out = { ...row };
  for (const key of SENSITIVE_KEYS) {
    if (key in out) delete out[key];
  }
  return out as Omit<T, SensitiveKey>;
}

export function sanitizeEmployeeForList<T extends Record<string, unknown>>(
  row: T,
  user: JWTPayload
): T | Omit<T, SensitiveKey> {
  if (canViewEmployeeSensitiveFields(user)) return row;
  return stripSensitive(row);
}

export function sanitizeEmployeeForDetail<T extends Record<string, unknown>>(
  row: T,
  user: JWTPayload
): T | Omit<T, SensitiveKey> {
  if (canViewEmployeeSensitiveFields(user)) return row;
  return stripSensitive(row);
}

export function maskBankAccountLast4(account?: string | null): string | null {
  if (!account) return null;
  const digits = account.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `****${digits.slice(-4)}`;
}
