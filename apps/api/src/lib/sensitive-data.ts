import type { JWTPayload } from "./types.js";
import { normalizeModuleAccess } from "../middleware/rbac.js";

/**
 * Private information is intentionally opt-in. A broad administrator account
 * is never a sensitive-data reader; only HR/payroll users with the relevant
 * assigned module may handle it.
 */
export function canAccessSensitiveData(user: JWTPayload, module: string): boolean {
  if (user.role !== "hr_payroll") return false;
  const modules = normalizeModuleAccess(user.moduleAccess);
  return Boolean(modules?.some((granted) => module === granted || module.startsWith(`${granted}/`)));
}

export function isPrivacyLimitedAdmin(user: JWTPayload): boolean {
  return user.role === "admin";
}

export function hasRestrictedFields(body: unknown, fields: readonly string[]): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return fields.some((field) => Object.prototype.hasOwnProperty.call(body, field));
}

export function omitFields<T extends Record<string, unknown>, K extends readonly string[]>(
  row: T,
  fields: K
): Omit<T, K[number]> {
  const result = { ...row } as Record<string, unknown>;
  for (const field of fields) delete result[field];
  return result as Omit<T, K[number]>;
}

export const EMPLOYEE_RESTRICTED_FIELDS = [
  "idNumber", "dateOfBirth", "phone", "email", "physicalAddress", "postalAddress", "postalCode",
  "maritalStatus", "nextOfKin1Name", "nextOfKin1Phone", "nextOfKin2Name", "nextOfKin2Phone",
  "nextOfKin3Name", "nextOfKin3Phone", "taxNumber", "taxDirectiveNumber", "taxDirectiveRate",
  "bankName", "bankAccountNumber", "bankBranchCode", "hourlyRate", "monthlySalary", "overtimeRate",
] as const;

export const STUDENT_RESTRICTED_FIELDS = [
  "idType", "idNumber", "dateOfBirth", "gender", "nationality", "phone", "alternatePhone", "email",
  "addressLine1", "addressLine2", "city", "province", "postalCode", "nextOfKinName", "nextOfKinPhone",
] as const;

export const INSTRUCTOR_RESTRICTED_FIELDS = [
  "idNumber", "dateOfBirth", "gender", "phone", "email", "residentialAddress", "emergencyContact",
  "psiraInstructorNumber", "certificateNumber",
] as const;
