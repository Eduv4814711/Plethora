export const CAPABILITIES = [
  "view",
  "view_sensitive",
  "create",
  "edit",
  "delete",
  "approve",
  "export",
  "manage_access",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type CapabilityMap = Record<string, Capability[]>;

export interface CapabilityDefinition {
  path: string;
  label: string;
  capabilities: readonly Capability[];
}

const standard = ["view", "create", "edit", "delete", "export"] as const;

export const CAPABILITY_CATALOG: readonly CapabilityDefinition[] = [
  { path: "/", label: "Dashboard", capabilities: ["view"] },
  { path: "/employees", label: "Team", capabilities: ["view", "view_sensitive", "create", "edit", "delete", "export"] },
  { path: "/employees/leave", label: "Team · Leave", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/sites", label: "Sites", capabilities: standard },
  { path: "/clients", label: "Clients", capabilities: ["view", "create", "edit", "export"] },
  { path: "/rostering", label: "Rostering", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/attendance", label: "Attendance", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/payroll", label: "Payroll", capabilities: ["view", "view_sensitive", "create", "edit", "delete", "approve", "export"] },
  { path: "/payroll/billing", label: "Payroll · Client Billing", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/tasks", label: "Tasks", capabilities: standard },
  { path: "/whatsapp", label: "WhatsApp", capabilities: ["view", "create", "edit", "delete"] },
  { path: "/reports", label: "Reports", capabilities: ["view", "export"] },
  { path: "/approvals", label: "Approvals", capabilities: ["view", "create", "edit", "approve", "export"] },
  { path: "/incidents", label: "Incidents", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/documents", label: "Documents", capabilities: standard },
  { path: "/client-portal", label: "Client Portal", capabilities: ["view", "create"] },
  { path: "/academy", label: "Academy", capabilities: ["view", "view_sensitive", "create", "edit", "delete", "approve", "export"] },
  { path: "/audit", label: "Audit", capabilities: ["view", "export"] },
  { path: "/settings", label: "Settings", capabilities: ["view", "edit", "export"] },
  { path: "/settings/access", label: "Settings · User Access", capabilities: ["view", "create", "edit", "delete", "manage_access"] },
] as const;

const capabilitySet = new Set<string>(CAPABILITIES);
const catalog = new Map(CAPABILITY_CATALOG.map((definition) => [definition.path, definition]));

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeCapabilities(raw: unknown): CapabilityMap {
  if (!isObject(raw)) return {};
  const normalized: CapabilityMap = {};
  for (const [path, value] of Object.entries(raw)) {
    if (!path.startsWith("/") || !Array.isArray(value)) continue;
    const supported = catalog.get(path)?.capabilities;
    if (!supported) continue;
    const allowed = new Set(supported);
    const capabilities = [...new Set(
      value.filter(
        (candidate): candidate is Capability =>
          typeof candidate === "string" && capabilitySet.has(candidate) && allowed.has(candidate as Capability)
      )
    )];
    if (capabilities.length) normalized[path] = capabilities;
  }
  return normalized;
}

export function validateCapabilities(raw: unknown):
  | { success: true; data: CapabilityMap }
  | { success: false; message: string } {
  if (!isObject(raw)) return { success: false, message: "Capabilities must be an object" };
  for (const [path, value] of Object.entries(raw)) {
    const definition = catalog.get(path);
    if (!definition) return { success: false, message: `Unknown module path: ${path}` };
    if (!Array.isArray(value)) return { success: false, message: `Capabilities for ${path} must be an array` };
    for (const candidate of value) {
      if (typeof candidate !== "string" || !capabilitySet.has(candidate)) {
        return { success: false, message: `Unknown capability for ${path}: ${String(candidate)}` };
      }
      if (!definition.capabilities.includes(candidate as Capability)) {
        return { success: false, message: `${candidate} is not supported by ${path}` };
      }
    }
  }
  return { success: true, data: normalizeCapabilities(raw) };
}

export function capabilityAssignmentForPath(
  raw: unknown,
  path: string
): readonly Capability[] | null {
  const permissions = normalizeCapabilities(raw);
  const matchedPath = Object.keys(permissions)
    .filter((granted) => path === granted || path.startsWith(`${granted}/`))
    .sort((a, b) => b.length - a.length)[0];
  return matchedPath ? permissions[matchedPath] : null;
}

export function hasCapability(
  user: { isOwner?: boolean; capabilities?: unknown; isActive?: boolean },
  path: string,
  capability: Capability
): boolean {
  if (user.isActive === false) return false;
  if (user.isOwner) return true;
  return capabilityAssignmentForPath(user.capabilities, path)?.includes(capability) ?? false;
}

export function hasAnyCapability(
  user: { isOwner?: boolean; capabilities?: unknown; isActive?: boolean },
  paths: readonly string[],
  capability: Capability
): boolean {
  return paths.some((path) => hasCapability(user, path, capability));
}

export function findUnassignableCapability(
  actor: { isOwner?: boolean; capabilities?: unknown; isActive?: boolean },
  requested: CapabilityMap
): { path: string; capability: Capability } | null {
  if (actor.isOwner && actor.isActive !== false) return null;
  for (const [path, capabilities] of Object.entries(requested)) {
    for (const capability of capabilities) {
      if (capability === "manage_access") {
        return { path, capability };
      }
      if (!hasCapability(actor, path, capability)) {
        return { path, capability };
      }
    }
  }
  return null;
}
