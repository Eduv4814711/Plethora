import { authProtect } from "../../middleware/auth-protect.js";
import { requirePermission } from "../../middleware/permissions.js";
import { PERMISSIONS } from "../../lib/permissions.js";

export const ACADEMY_MODULE = "/academy";

/** Pre-handler stack for all academy routes (module-gated + accessVersion). */
export const academyProtect = [
  ...authProtect,
  requirePermission(PERMISSIONS.ACADEMY_MANAGE),
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
