import type { UserRole } from "@prisma/client";
import { authProtect } from "../../middleware/auth-protect.js";
import { requireRole } from "../../middleware/rbac.js";

export const ACADEMY_ROLES: UserRole[] = [
  "admin",
  "operations_manager",
  "hr_payroll",
  "supervisor",
  "controller",
];

export const ACADEMY_MODULE = "/academy";

/** Pre-handler stack for all academy routes (module-gated + accessVersion). */
export const academyProtect = [
  ...authProtect,
  requireRole(ACADEMY_ROLES, { module: ACADEMY_MODULE }),
];

/** MIME allowlist aligned with task attachments. */
export const ACADEMY_DOCUMENT_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
] as const;

export const ACADEMY_MAX_FILE_BYTES = 10 * 1024 * 1024;
