import type { AuthUser, Capability, CapabilityMap } from "./api";
import { CAPABILITY_CATALOG, CATALOG_PATHS } from "./capability-catalog.generated";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Shorter nav labels for modules whose catalog label is qualified by its parent
 * ("Team · Leave" reads badly in a nav bar). Anything not listed uses the
 * catalog label verbatim.
 */
const NAV_LABEL_OVERRIDES: Record<string, string> = {
  "/employees/leave": "Leave",
  "/payroll/billing": "Client Billing",
  "/settings/migrate": "Data Import / Export",
};

/**
 * Derived from the generated catalog, which mirrors the API. Adding a module in
 * apps/api/src/lib/capabilities.ts and regenerating is all that is needed — the
 * two lists can no longer drift.
 *
 * /settings/access is excluded: it is a tab inside Settings, not a nav entry.
 */
export const NAV_ITEMS: NavItem[] = CAPABILITY_CATALOG
  .filter((definition) => definition.path !== "/settings/access")
  .map((definition) => ({
    href: definition.path,
    label: NAV_LABEL_OVERRIDES[definition.path] ?? definition.label,
  }));

export const MAIN_NAV_HREFS = ["/", "/employees", "/employees/leave", "/sites", "/rostering", "/attendance", "/payroll", "/tasks"];
export const MORE_NAV_HREFS = [
  "/clients",
  "/payroll/billing",
  "/whatsapp",
  "/reports",
  "/approvals",
  "/incidents",
  "/documents",
  "/client-portal",
  "/academy",
  "/audit",
  "/settings/migrate",
];
export const ACCESS_PENDING_HREF = "/access-pending";

type AccessSubject = Pick<AuthUser, "isOwner" | "isActive" | "capabilities">;

export function normalizeCapabilities(raw: unknown): CapabilityMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: CapabilityMap = {};
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!CATALOG_PATHS.includes(path) || !Array.isArray(value)) continue;
    const list = value.filter((item): item is Capability =>
      ["view", "view_sensitive", "create", "edit", "delete", "approve", "export", "manage_access"].includes(String(item))
    );
    if (list.length) result[path] = [...new Set(list)];
  }
  return result;
}

/**
 * Resolves an application path to the catalog module that owns it, mirroring
 * resolveModulePath in apps/api/src/lib/capabilities.ts. `/sites/abc` resolves
 * to `/sites`, but `/payroll/billing` resolves to itself — a parent grant never
 * confers a separately grantable sub-module.
 */
export function resolveModulePath(path: string): string | null {
  if (CATALOG_PATHS.includes(path)) return path;
  return (
    CATALOG_PATHS
      .filter((candidate) => candidate !== "/" && path.startsWith(`${candidate}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}

export function capabilitiesForPath(raw: unknown, path: string): readonly Capability[] | null {
  const modulePath = resolveModulePath(path);
  if (!modulePath) return null;
  // Exact lookup only. Grants never cascade from parent module to child module.
  return normalizeCapabilities(raw)[modulePath] ?? null;
}

export function hasCapability(
  user: AccessSubject,
  path: string,
  capability: Capability
): boolean {
  if (!user.isActive) return false;
  if (user.isOwner) return true;
  return capabilitiesForPath(user.capabilities, path)?.includes(capability) ?? false;
}

export function hasAnyModuleView(user: AccessSubject): boolean {
  if (user.isOwner) return user.isActive !== false;
  return Object.values(normalizeCapabilities(user.capabilities)).some((list) => list.includes("view"));
}

/**
 * Every route resolves to exactly one catalog module, and access to that route
 * is that module's view capability. There are no per-route special cases: a
 * module the person was not given is a module they cannot open.
 */
export function canAccessRoute(pathname: string, user: AccessSubject): boolean {
  if (pathname === ACCESS_PENDING_HREF || pathname.startsWith(`${ACCESS_PENDING_HREF}/`)) {
    return !hasAnyModuleView(user);
  }
  const modulePath = resolveModulePath(pathname === "" ? "/" : pathname);
  return modulePath ? hasCapability(user, modulePath, "view") : false;
}

export function canAccessMigrationTools(user: AccessSubject): boolean {
  return hasCapability(user, "/settings/migrate", "view");
}

export function getDefaultRouteForUser(user: AccessSubject): string {
  const first = NAV_ITEMS.find((item) => canAccessRoute(item.href, user));
  return first?.href ?? ACCESS_PENDING_HREF;
}

export function canManageEmployeeDetails(user: AccessSubject): boolean {
  return hasCapability(user, "/employees", "edit") || hasCapability(user, "/payroll", "edit");
}

export function canAccessSensitiveData(user: AccessSubject, module: string): boolean {
  return hasCapability(user, module, "view_sensitive");
}
