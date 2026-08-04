import type { AuthUser, Capability, CapabilityMap } from "./api";

export interface NavItem {
  href: string;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/employees", label: "Team" },
  { href: "/employees/leave", label: "Leave" },
  { href: "/sites", label: "Sites" },
  { href: "/clients", label: "Clients" },
  { href: "/rostering", label: "Rostering" },
  { href: "/attendance", label: "Attendance" },
  { href: "/payroll", label: "Payroll" },
  { href: "/payroll/billing", label: "Client Billing" },
  { href: "/tasks", label: "Tasks" },
  { href: "/whatsapp", label: "WhatsApp" },
  { href: "/reports", label: "Reports" },
  { href: "/approvals", label: "Approvals" },
  { href: "/incidents", label: "Incidents" },
  { href: "/documents", label: "Documents" },
  { href: "/client-portal", label: "Client Portal" },
  { href: "/academy", label: "Academy" },
  { href: "/audit", label: "Audit" },
  { href: "/settings/migrate", label: "Data Import / Export" },
  { href: "/settings", label: "Settings" },
];

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
    if (!path.startsWith("/") || !Array.isArray(value)) continue;
    const list = value.filter((item): item is Capability =>
      ["view", "view_sensitive", "create", "edit", "delete", "approve", "export", "manage_access"].includes(String(item))
    );
    if (list.length) result[path] = [...new Set(list)];
  }
  return result;
}

export function capabilitiesForPath(raw: unknown, path: string): readonly Capability[] | null {
  const permissions = normalizeCapabilities(raw);
  const match = Object.keys(permissions)
    .filter((granted) => path === granted || path.startsWith(`${granted}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? permissions[match] : null;
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
  return (
    user.isOwner ||
    Object.values(normalizeCapabilities(user.capabilities)).some((list) => list.includes("view")) ||
    canAccessMigrationTools(user)
  );
}

function navItemForPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS
    .filter((item) =>
      item.href === "/"
        ? pathname === "/" || pathname === ""
        : pathname === item.href || pathname.startsWith(`${item.href}/`)
    )
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export function canAccessRoute(pathname: string, user: AccessSubject): boolean {
  if (pathname === ACCESS_PENDING_HREF || pathname.startsWith(`${ACCESS_PENDING_HREF}/`)) {
    return !hasAnyModuleView(user);
  }
  const item = navItemForPath(pathname);
  if (item?.href === "/settings/migrate") {
    return canAccessMigrationTools(user);
  }
  // Clients moved out of Settings; existing grants never mention /clients, so keep the old paths working.
  if (item?.href === "/clients") {
    return (
      hasCapability(user, "/clients", "view") ||
      hasCapability(user, "/sites", "view") ||
      hasCapability(user, "/settings", "view")
    );
  }
  if (item?.href === "/employees/leave") {
    return (
      hasCapability(user, "/employees/leave", "view") ||
      hasCapability(user, "/payroll", "view")
    );
  }
  return item ? hasCapability(user, item.href, "view") : false;
}

export function canAccessMigrationTools(user: AccessSubject): boolean {
  return (
    hasCapability(user, "/employees", "create") ||
    hasCapability(user, "/employees", "export") ||
    hasCapability(user, "/sites", "create") ||
    hasCapability(user, "/sites", "export")
  );
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
