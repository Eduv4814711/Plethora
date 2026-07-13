import type { UserRole } from "@prisma/client";

/** Normalize DB/JWT value: non-empty string[] → list; else null. */
export function normalizeModuleAccess(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out = raw.filter((x): x is string => typeof x === "string" && x.startsWith("/"));
  return out.length > 0 ? out : null;
}

/** All primary dashboard module paths (mirrors web NAV_ITEMS hrefs). */
export const ALL_MODULE_PATHS = [
  "/",
  "/employees",
  "/sites",
  "/rostering",
  "/attendance",
  "/payroll",
  "/tasks",
  "/whatsapp",
  "/reports",
  "/approvals",
  "/incidents",
  "/documents",
  "/client-portal",
  "/academy",
  "/audit",
  "/settings",
] as const;

const ROLE_DEFAULT_MODULES: Record<string, string[]> = {
  admin: [
    "/",
    "/employees",
    "/sites",
    "/rostering",
    "/attendance",
    "/payroll",
    "/tasks",
    "/whatsapp",
    "/reports",
    "/approvals",
    "/incidents",
    "/documents",
    "/client-portal",
    "/academy",
    "/audit",
    "/settings",
  ],
  operations_manager: [
    "/",
    "/employees",
    "/sites",
    "/rostering",
    "/attendance",
    "/payroll",
    "/tasks",
    "/whatsapp",
    "/reports",
    "/approvals",
    "/incidents",
    "/documents",
    "/academy",
    "/settings",
  ],
  hr_payroll: [
    "/",
    "/employees",
    "/attendance",
    "/payroll",
    "/tasks",
    "/whatsapp",
    "/reports",
    "/approvals",
    "/documents",
    "/academy",
    "/settings",
  ],
  supervisor: [
    "/",
    "/employees",
    "/sites",
    "/rostering",
    "/attendance",
    "/tasks",
    "/whatsapp",
    "/approvals",
    "/incidents",
    "/documents",
    "/academy",
    "/settings",
  ],
  controller: ["/rostering", "/attendance", "/whatsapp", "/incidents", "/academy"],
  client: ["/client-portal"],
};

/** Suggested module paths for a role when DB moduleAccess is null. */
export function defaultModulesForRole(role: string): string[] {
  return [...(ROLE_DEFAULT_MODULES[role] ?? [])];
}

/**
 * Effective module list for JWT / requireRole.
 * - Explicit DB list wins
 * - System owners get all modules
 * - Otherwise fall back to role defaults (unblocks legacy null moduleAccess)
 */
export function resolveEffectiveModuleAccess(opts: {
  role: string | UserRole;
  moduleAccess?: unknown;
  isSystemOwner?: boolean;
}): string[] | null {
  const explicit = normalizeModuleAccess(opts.moduleAccess);
  if (explicit) return explicit;
  if (opts.isSystemOwner) return [...ALL_MODULE_PATHS];
  const defaults = defaultModulesForRole(String(opts.role));
  return defaults.length > 0 ? defaults : null;
}
