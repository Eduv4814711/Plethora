import type { AuthenticatedUser } from "./types.js";
import { hasCapability } from "./capabilities.js";

/**
 * Private information is intentionally opt-in. Ordinary module view access
 * never implies access to identity, health, banking, tax, or compensation data.
 */
export function canAccessSensitiveData(user: AuthenticatedUser, module: string): boolean {
  return hasCapability(user, module, "view_sensitive");
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
  "idNumber", "dateOfBirth", "gender", "phone", "email", "physicalAddress", "postalAddress", "postalCode",
  "maritalStatus", "nextOfKin1Name", "nextOfKin1Phone", "nextOfKin2Name", "nextOfKin2Phone",
  "nextOfKin3Name", "nextOfKin3Phone", "taxNumber", "taxDirectiveNumber", "taxDirectiveRate",
  "bankName", "bankAccountNumber", "bankBranchCode", "hourlyRate", "monthlySalary", "overtimeRate",
  "previousService", "residedOutsideSA", "militaryPoliceService", "criminalInvestigation",
  "mentallyUnstable",
] as const;

export const STUDENT_RESTRICTED_FIELDS = [
  "idType", "idNumber", "dateOfBirth", "gender", "nationality", "phone", "alternatePhone", "email",
  "addressLine1", "addressLine2", "city", "province", "postalCode", "nextOfKinName", "nextOfKinPhone",
] as const;

export const INSTRUCTOR_RESTRICTED_FIELDS = [
  "idNumber", "dateOfBirth", "gender", "phone", "email", "residentialAddress", "emergencyContact",
  "psiraInstructorNumber", "certificateNumber",
] as const;
