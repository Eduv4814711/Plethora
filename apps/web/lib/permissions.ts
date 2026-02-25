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
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", roles: [] },
  { href: "/employees", label: "Employees", roles: ["admin", "operations_manager", "hr_payroll", "supervisor"] },
  { href: "/sites", label: "Sites", roles: ["admin", "operations_manager", "supervisor"] },
  { href: "/rostering", label: "Rostering", roles: ["admin", "operations_manager", "supervisor"] },
  { href: "/attendance", label: "Attendance", roles: ["admin", "operations_manager", "hr_payroll", "supervisor"] },
  { href: "/payroll", label: "Payroll", roles: ["admin", "operations_manager", "hr_payroll"] },
  { href: "/payroll/leave-requests", label: "Leave Requests", roles: ["admin", "operations_manager", "hr_payroll"] },
  { href: "/reports", label: "Reports", roles: ["admin", "operations_manager", "hr_payroll"] },
  { href: "/audit", label: "Audit", roles: ["admin"] },
  { href: "/settings", label: "Settings", roles: [] },
];

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
