import type { UserRole } from "./api";

export interface NavItem {
  href: string;
  label: string;
  /** Roles that can see this module. Empty = all authenticated users. */
  roles: UserRole[];
}

/**
 * Navigation items with role-based access.
 * Matches API route protection: each module is visible only to roles that can use its APIs.
 * Controller role: only Rostering, Attendance, and Sites are visible.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", roles: ["admin", "operations_manager", "hr_payroll", "supervisor"] },
  { href: "/employees", label: "Team", roles: ["admin", "operations_manager", "hr_payroll", "supervisor"] },
  { href: "/sites", label: "Sites", roles: ["admin", "operations_manager", "supervisor", "controller"] },
  { href: "/rostering", label: "Rostering", roles: ["admin", "operations_manager", "supervisor", "controller"] },
  { href: "/attendance", label: "Attendance", roles: ["admin", "operations_manager", "hr_payroll", "supervisor", "controller"] },
  { href: "/payroll", label: "Payroll", roles: ["admin", "operations_manager", "hr_payroll"] },
  { href: "/reports", label: "Reports", roles: ["admin", "operations_manager", "hr_payroll"] },
  { href: "/audit", label: "Audit", roles: ["admin"] },
  { href: "/email", label: "Email", roles: ["admin", "operations_manager", "hr_payroll"] },
  { href: "/settings", label: "Settings", roles: ["admin", "operations_manager", "hr_payroll", "supervisor"] },
];

/** Main nav links shown in the horizontal bar (first 6 items). */
export const MAIN_NAV_HREFS = ["/", "/employees", "/sites", "/rostering", "/attendance", "/payroll"];

/** Nav items shown in the "More" dropdown (remaining items). */
export const MORE_NAV_HREFS = ["/reports", "/audit", "/email"];

/**
 * Default route for a role when they don't have access to the requested path.
 * Controller only has access to Rostering, Attendance, Sites - redirect to Rostering.
 */
export function getDefaultRouteForRole(role: string): string {
  if (role === "controller") return "/rostering";
  return "/";
}

/**
 * Check if a user role can access a route.
 * @param pathname - Route path (e.g. "/payroll" or "/sites/abc")
 * @param role - User's role
 */
export function canAccessRoute(pathname: string, role: string): boolean {
  const userRole = role as UserRole;

  // Find matching nav item (exact or prefix for nested routes like /sites/[id])
  const item = NAV_ITEMS.find((n) => {
    if (n.href === "/") return pathname === "/" || pathname === "";
    return pathname === n.href || pathname.startsWith(n.href + "/");
  });

  if (!item) {
    // Unknown route - allow (e.g. 404) or deny? Deny to be safe.
    return false;
  }

  if (item.roles.length === 0) return true;
  return item.roles.includes(userRole);
}
