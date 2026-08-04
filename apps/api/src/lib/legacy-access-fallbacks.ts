import { CAPABILITY_CATALOG, type Capability, type CapabilityMap } from "./capabilities.js";

/**
 * Grants used to leak in two ways:
 *
 *  1. `capabilityAssignmentForPath` matched a granted path against any path that
 *     started with it, so a parent module grant silently unlocked its
 *     sub-modules (`/payroll` unlocked `/payroll/billing`, `/settings` unlocked
 *     `/settings/access`).
 *  2. Several route groups guarded themselves with `anyOfModules`, so a grant on
 *     one module reached the records of another (`/payroll` reached Team, Leave
 *     and Sites; `/` reached Incidents).
 *
 * Both are now closed: capability lookup is exact, and record-owning routes
 * require their own module. This file describes what those two mechanisms used
 * to imply, so the one-time migration can turn every previously implied grant
 * into an explicit one and nobody loses access they were actually using.
 *
 * These rules are historical. Do not add to them — new access is granted in
 * Settings → User Access, not inferred here.
 */

export interface LegacyFallback {
  /** Module the user already holds. */
  from: string;
  /** Module they implicitly reached through it. */
  to: string;
  /** Only these capabilities carried over; the rest are intersected with the target's catalog. */
  capabilities: readonly Capability[];
  reason: string;
}

/** Sub-modules whose capabilities used to be inherited from their parent. */
export const LEGACY_PARENT_INHERITANCE: readonly { parent: string; child: string }[] =
  CAPABILITY_CATALOG.filter((definition) => definition.parent)
    // `/settings/access` is the privilege-escalation surface. It is deliberately
    // excluded: only the owner and existing explicit holders keep it.
    .filter((definition) => definition.path !== "/settings/access")
    // `/settings/migrate` had no catalog entry before this change, so nothing
    // could have inherited it. It is seeded by LEGACY_MODULE_FALLBACKS instead.
    .filter((definition) => definition.path !== "/settings/migrate")
    .map((definition) => ({ parent: definition.parent!, child: definition.path }));

const crud = ["view", "create", "edit", "delete"] as const;

export const LEGACY_MODULE_FALLBACKS: readonly LegacyFallback[] = [
  {
    from: "/payroll",
    to: "/employees",
    capabilities: crud,
    reason: "employees routes accepted /payroll via anyOfModules",
  },
  {
    from: "/rostering",
    to: "/employees",
    capabilities: ["view"],
    reason: "employee list was readable by rostering for reliever pickers",
  },
  {
    from: "/attendance",
    to: "/employees",
    capabilities: ["view"],
    reason: "employee list was readable by attendance for site timesheets",
  },
  {
    from: "/payroll",
    to: "/employees/leave",
    capabilities: ["view", "create", "edit", "delete", "approve", "export"],
    reason: "leave routes accepted /payroll via anyOfModules",
  },
  {
    from: "/rostering",
    to: "/sites",
    capabilities: ["view"],
    reason: "site list was readable by rostering",
  },
  {
    from: "/attendance",
    to: "/sites",
    capabilities: ["view"],
    reason: "site list was readable by attendance work queues",
  },
  {
    from: "/",
    to: "/incidents",
    capabilities: crud,
    reason: "incident routes accepted the dashboard module via anyOfModules",
  },
  {
    from: "/sites",
    to: "/incidents",
    capabilities: crud,
    reason: "incident routes accepted /sites via anyOfModules",
  },
  {
    from: "/reports",
    to: "/incidents",
    capabilities: ["view"],
    reason: "incident routes accepted /reports via anyOfModules",
  },
  {
    from: "/sites",
    to: "/clients",
    capabilities: ["view"],
    reason: "web nav treated /sites:view as client access after Clients left Settings",
  },
  {
    from: "/settings",
    to: "/clients",
    capabilities: ["view"],
    reason: "web nav treated /settings:view as client access after Clients left Settings",
  },
];

/**
 * `/settings/migrate` is new to the catalog. Import/export tooling was previously
 * reachable by anyone who could create or export Team or Site records, so seed
 * the new module from exactly that condition.
 */
export const MIGRATION_MODULE_SEED = {
  path: "/settings/migrate",
  grant: (existing: CapabilityMap): Capability[] => {
    const capabilities = new Set<Capability>();
    const employees = existing["/employees"] ?? [];
    const sites = existing["/sites"] ?? [];
    if (employees.includes("create") || sites.includes("create")) {
      capabilities.add("view");
      capabilities.add("create");
    }
    if (employees.includes("export") || sites.includes("export")) {
      capabilities.add("view");
      capabilities.add("export");
    }
    return [...capabilities];
  },
  reason: "data import/export was reachable via Team or Site create/export grants",
} as const;
