import type { UserRole } from "./api";

export interface NavItem {
  href: string;
  label: string;
  /** Roles that can see this module when no custom `moduleAccess` is set. */
  roles: UserRole[];
}

/**
 * Navigation items. `roles` are used for **templates** (defaultModulesForRole) and docs only.
 * Runtime access: only **full** admins (see isFullAdmin) may see everything without a list;
 * everyone else must have an explicit non-empty `moduleAccess` from an administrator.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", roles: ["admin", "operations_manager", "hr_payroll", "supervisor"] },
  { href: "/employees", label: "Team", roles: ["admin", "operations_manager", "hr_payroll", "supervisor"] },
  { href: "/sites", label: "Sites", roles: ["admin", "operations_manager", "supervisor"] },
  { href: "/rostering", label: "Rostering", roles: ["admin", "operations_manager", "supervisor", "controller"] },
  { href: "/attendance", label: "Attendance", roles: ["admin", "operations_manager", "hr_payroll", "supervisor", "controller"] },
  { href: "/payroll", label: "Payroll", roles: ["admin", "operations_manager", "hr_payroll"] },
  { href: "/tasks", label: "Tasks", roles: ["admin", "operations_manager", "hr_payroll", "supervisor"] },
  { href: "/whatsapp", label: "WhatsApp", roles: ["admin", "operations_manager", "hr_payroll", "supervisor", "controller"] },
  { href: "/reports", label: "Reports", roles: ["admin", "operations_manager", "hr_payroll"] },
  {
    href: "/academy",
    label: "Academy",
    roles: ["admin", "operations_manager", "hr_payroll", "supervisor", "controller"],
  },
  { href: "/audit", label: "Audit", roles: ["admin"] },
  { href: "/settings", label: "Settings", roles: ["admin", "operations_manager", "hr_payroll", "supervisor"] },
];

/** Main nav links shown in the horizontal bar (first 6 items). */
export const MAIN_NAV_HREFS = ["/", "/employees", "/sites", "/rostering", "/attendance", "/payroll", "/tasks"];

/** Nav items shown in the "More" dropdown (remaining items). */
export const MORE_NAV_HREFS = ["/whatsapp", "/reports", "/academy", "/audit"];

/** Modules an admin can assign to a user (same as primary nav; Audit only effective for admin accounts). */
export const MODULE_ASSIGN_OPTIONS: { href: string; label: string }[] = NAV_ITEMS.map(({ href, label }) => ({
  href,
  label,
}));

/** Shown when a non-admin has no modules assigned yet (login-only). Not a product module. */
export const ACCESS_PENDING_HREF = "/access-pending";

export function normalizeUserModuleAccess(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out = raw.filter((x): x is string => typeof x === "string" && x.startsWith("/"));
  return out.length > 0 ? out : null;
}

/** Suggested module paths for a role (admin UI pre-fill). Not applied at runtime without saving. */
export function defaultModulesForRole(role: string): string[] {
  const userRole = role as UserRole;
  return NAV_ITEMS.filter(
    (n) => n.roles.includes(userRole) && (n.href !== "/audit" || userRole === "admin")
  ).map((n) => n.href);
}

/** Full tenant administrator: may use all modules and admin-only APIs. Scoped admins have role admin + explicit module list. */
export function isFullAdmin(user: { role: string; moduleAccess?: unknown }): boolean {
  return user.role === "admin" && !normalizeUserModuleAccess(user.moduleAccess);
}

function navItemForPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((n) => {
    if (n.href === "/") return pathname === "/" || pathname === "";
    return pathname === n.href || pathname.startsWith(`${n.href}/`);
  });
}

/**
 * First route to open for a user. Non-admins without assigned modules → access-pending page.
 */
export function getDefaultRouteForUser(user: { role: string; moduleAccess?: unknown }): string {
  const custom = normalizeUserModuleAccess(user.moduleAccess);
  if (custom) {
    for (const nav of NAV_ITEMS) {
      if (!custom.includes(nav.href)) continue;
      if (nav.href === "/audit" && user.role !== "admin") continue;
      return nav.href;
    }
    return custom[0] ?? (user.role === "admin" ? "/" : ACCESS_PENDING_HREF);
  }
  if (user.role === "admin") return "/";
  return ACCESS_PENDING_HREF;
}

/**
 * Route access: full admin → all nav modules; anyone else → explicit module list only.
 */
export function canAccessRoute(pathname: string, role: string, moduleAccess?: unknown): boolean {
  const userRole = role as UserRole;

  if (pathname === ACCESS_PENDING_HREF || pathname.startsWith(`${ACCESS_PENDING_HREF}/`)) {
    if (userRole === "admin") return false;
    return normalizeUserModuleAccess(moduleAccess) == null;
  }

  const item = navItemForPath(pathname);
  if (!item) return false;

  if (userRole === "admin" && !normalizeUserModuleAccess(moduleAccess)) {
    return true;
  }

  const custom = normalizeUserModuleAccess(moduleAccess);
  if (!custom) return false;

  const covers = custom.some(
    (m) => item.href === m || pathname === m || pathname.startsWith(`${m}/`)
  );
  if (!covers) return false;
  if (item.href === "/audit" && userRole !== "admin") return false;
  return true;
}

/** Site create/edit/delete: must have `/sites` in assigned modules; full admin unrestricted. */
export function canManageSitesModule(user: { role: string; moduleAccess?: unknown }): boolean {
  if (!canAccessRoute("/sites", user.role, user.moduleAccess)) return false;
  const custom = normalizeUserModuleAccess(user.moduleAccess);
  if (custom) return custom.includes("/sites");
  return user.role === "admin";
}
