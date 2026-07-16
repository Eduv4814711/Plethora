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
  { href: "/approvals", label: "Approvals", roles: ["admin", "operations_manager", "hr_payroll", "supervisor"] },
  { href: "/incidents", label: "Incidents", roles: ["admin", "operations_manager", "supervisor", "controller"] },
  { href: "/documents", label: "Documents", roles: ["admin", "operations_manager", "hr_payroll", "supervisor"] },
  { href: "/client-portal", label: "Client Portal", roles: ["admin", "client"] },
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
export const MORE_NAV_HREFS = [
  "/whatsapp",
  "/reports",
  "/approvals",
  "/incidents",
  "/documents",
  "/client-portal",
  "/academy",
  "/audit",
];

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
  if (role === "client") return ["/client-portal"];
  const userRole = role as UserRole;
  return NAV_ITEMS.filter(
    (n) => n.roles.includes(userRole) && (n.href !== "/audit" || userRole === "admin")
  ).map((n) => n.href);
}

/** Full tenant administrator: may use all modules and admin-only APIs. */
export function isFullAdmin(user: { role: string; moduleAccess?: unknown; isSystemOwner?: boolean; permissions?: string[] | null }): boolean {
  if (user.isSystemOwner) return true;
  return !!user.permissions?.includes("permissions.manage_operational") && !!user.permissions?.includes("users.manage");
}

export { can } from "./capabilities";

function navItemForPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((n) => {
    if (n.href === "/") return pathname === "/" || pathname === "";
    return pathname === n.href || pathname.startsWith(`${n.href}/`);
  });
}

const ROUTE_PERMISSIONS: Record<string, string[]> = {
  "/": ["dashboard.read"],
  "/employees": ["employees.read_operational"],
  "/sites": ["sites.read"],
  "/rostering": ["rosters.read", "timesheets.read"],
  "/attendance": ["attendance.read"],
  "/payroll": ["payroll.status.read", "payroll.run.read"],
  "/tasks": ["tasks.read"],
  "/reports": ["reports.read_operational", "reports.read_financial"],
  "/approvals": ["approvals.read"],
  "/incidents": ["incidents.read"],
  "/documents": ["documents.read_operational", "documents.read_hr", "documents.read_payroll", "documents.read_medical"],
  "/academy": ["academy.read"],
  "/audit": ["audit.read", "data_quality.read"],
  "/settings": ["settings.manage_operational", "settings.manage_statutory", "users.manage"],
};

/**
 * First route to open for a user. Non-admins without assigned modules → access-pending page.
 */
export function getDefaultRouteForUser(user: {
  role: string;
  moduleAccess?: unknown;
  isSystemOwner?: boolean;
  permissions?: string[] | null;
}): string {
  if (user.isSystemOwner) return "/";
  if (user.permissions) {
    const first = NAV_ITEMS.find((item) => canAccessRoute(item.href, user.role, user.moduleAccess, false, user.permissions));
    if (first) return first.href;
  }
  const custom = normalizeUserModuleAccess(user.moduleAccess);
  if (custom) {
    for (const nav of NAV_ITEMS) {
      if (!custom.includes(nav.href)) continue;
      if (nav.href === "/audit" && user.role !== "admin") continue;
      return nav.href;
    }
    return custom[0] ?? ACCESS_PENDING_HREF;
  }
  return ACCESS_PENDING_HREF;
}

/**
 * Route access: system owner / full admin → all nav modules; anyone else → explicit module list only.
 */
export function canAccessRoute(
  pathname: string,
  role: string,
  moduleAccess?: unknown,
  isSystemOwner?: boolean,
  permissions?: string[] | null
): boolean {
  const userRole = role as UserRole;

  if (pathname === ACCESS_PENDING_HREF || pathname.startsWith(`${ACCESS_PENDING_HREF}/`)) {
    if (isSystemOwner) return false;
    return !permissions || permissions.length === 0;
  }

  const item = navItemForPath(pathname);
  if (!item) return false;

  if (isSystemOwner) return true;

  if (permissions) {
    const required = ROUTE_PERMISSIONS[item.href];
    return !!required?.some((permission) => permissions.includes(permission));
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
export function canManageSitesModule(user: {
  role: string;
  moduleAccess?: unknown;
  isSystemOwner?: boolean;
  permissions?: string[] | null;
}): boolean {
  if (user.isSystemOwner) return true;
  return user.permissions?.includes("sites.manage") ?? false;
}
