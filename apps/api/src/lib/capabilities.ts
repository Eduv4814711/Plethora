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
  /**
   * Declares the module this one sits underneath in the UI. It is presentational
   * and grant-expansion metadata only: a grant on the parent NEVER confers the
   * child. Sub-modules must be granted explicitly.
   */
  parent?: string;
}

const standard = ["view", "create", "edit", "delete", "export"] as const;

export const CAPABILITY_CATALOG: readonly CapabilityDefinition[] = [
  { path: "/", label: "Dashboard", capabilities: ["view"] },
  { path: "/employees", label: "Team", capabilities: ["view", "view_sensitive", "create", "edit", "delete", "export"] },
  { path: "/employees/leave", label: "Team · Leave", parent: "/employees", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/sites", label: "Sites", capabilities: standard },
  { path: "/clients", label: "Clients", capabilities: ["view", "create", "edit", "export"] },
  { path: "/rostering", label: "Rostering", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/attendance", label: "Attendance", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/payroll", label: "Payroll", capabilities: ["view", "view_sensitive", "create", "edit", "delete", "approve", "export"] },
  { path: "/payroll/billing", label: "Payroll · Client Billing", parent: "/payroll", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
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
  { path: "/settings/access", label: "Settings · User Access", parent: "/settings", capabilities: ["view", "create", "edit", "delete", "manage_access"] },
  { path: "/settings/migrate", label: "Settings · Data Import / Export", parent: "/settings", capabilities: ["view", "create", "export"] },
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

/**
 * Resolves an arbitrary application path to the catalog module that owns it.
 *
 * Resolution walks up to the nearest *declared* module, so `/sites/abc123`
 * resolves to `/sites`, while `/payroll/billing` resolves to itself rather
 * than to `/payroll`. This is what stops a parent grant from silently
 * unlocking a separately grantable sub-module.
 */
export function resolveModulePath(path: string): string | null {
  if (catalog.has(path)) return path;
  return (
    CAPABILITY_CATALOG
      .filter((definition) => definition.path !== "/" && path.startsWith(`${definition.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0]?.path ?? null
  );
}

export function capabilityAssignmentForPath(
  raw: unknown,
  path: string
): readonly Capability[] | null {
  const modulePath = resolveModulePath(path);
  if (!modulePath) return null;
  // Exact lookup only. Grants never cascade from parent module to child module.
  return normalizeCapabilities(raw)[modulePath] ?? null;
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

export interface EffectiveModuleAccess {
  path: string;
  label: string;
  parent?: string;
  granted: readonly Capability[];
  available: readonly Capability[];
  source: "owner" | "explicit" | "none";
}

export type AccessSubject = {
  isOwner?: boolean;
  capabilities?: unknown;
  isActive?: boolean;
};

/**
 * The single source of truth for "what can this person actually do". Guards,
 * the effective-access viewer and the access-review export all read from here,
 * so the UI can never claim access the enforcer would refuse.
 */
export function resolveEffectiveCapabilities(user: AccessSubject): EffectiveModuleAccess[] {
  const inactive = user.isActive === false;
  const owner = Boolean(user.isOwner) && !inactive;
  const explicit = inactive ? {} : normalizeCapabilities(user.capabilities);

  return CAPABILITY_CATALOG.map((definition) => {
    const granted = owner ? [...definition.capabilities] : (explicit[definition.path] ?? []);
    return {
      path: definition.path,
      label: definition.label,
      ...(definition.parent ? { parent: definition.parent } : {}),
      granted,
      available: definition.capabilities,
      source: granted.length === 0 ? "none" : owner ? "owner" : "explicit",
    } satisfies EffectiveModuleAccess;
  });
}

export interface CapabilityGrantChange {
  path: string;
  label: string;
  capability: Capability;
}

export interface CapabilityDiff {
  added: CapabilityGrantChange[];
  removed: CapabilityGrantChange[];
}

/**
 * Structured before/after diff of a capability map, so an access change reads as
 * "granted Payroll · approve" rather than as two JSON blobs to compare by eye.
 */
export function diffCapabilities(beforeRaw: unknown, afterRaw: unknown): CapabilityDiff {
  const before = normalizeCapabilities(beforeRaw);
  const after = normalizeCapabilities(afterRaw);
  const added: CapabilityGrantChange[] = [];
  const removed: CapabilityGrantChange[] = [];

  for (const definition of CAPABILITY_CATALOG) {
    const had = new Set(before[definition.path] ?? []);
    const has = new Set(after[definition.path] ?? []);
    for (const capability of definition.capabilities) {
      if (has.has(capability) && !had.has(capability)) {
        added.push({ path: definition.path, label: definition.label, capability });
      } else if (had.has(capability) && !has.has(capability)) {
        removed.push({ path: definition.path, label: definition.label, capability });
      }
    }
  }
  return { added, removed };
}

/** Catalog sub-modules keyed by their parent, used by grant-expansion tooling. */
export function childModulesOf(parentPath: string): readonly CapabilityDefinition[] {
  return CAPABILITY_CATALOG.filter((definition) => definition.parent === parentPath);
}

export function capabilityDefinition(path: string): CapabilityDefinition | undefined {
  return catalog.get(path);
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
