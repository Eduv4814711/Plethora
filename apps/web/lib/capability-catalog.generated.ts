// GENERATED FILE — do not edit by hand.
// Mirrors CAPABILITY_CATALOG in apps/api/src/lib/capabilities.ts.
// Regenerate with: npm run gen:catalog --workspace api
// apps/api/src/routes/__tests__/module-consistency.integration.test.ts fails if
// this file drifts from the API catalog.

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

export type CatalogCapability = (typeof CAPABILITIES)[number];

export interface CapabilityDefinition {
  path: string;
  label: string;
  capabilities: readonly CatalogCapability[];
  parent?: string;
}

export const CAPABILITY_CATALOG: readonly CapabilityDefinition[] = [
  { path: "/", label: "Dashboard", capabilities: ["view"] },
  { path: "/employees", label: "Team", capabilities: ["view", "view_sensitive", "create", "edit", "delete", "export"] },
  { path: "/employees/leave", label: "Team · Leave", parent: "/employees", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/sites", label: "Sites", capabilities: ["view", "create", "edit", "delete", "export"] },
  { path: "/clients", label: "Clients", capabilities: ["view", "create", "edit", "export"] },
  { path: "/rostering", label: "Rostering", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/attendance", label: "Attendance", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/payroll", label: "Payroll", capabilities: ["view", "view_sensitive", "create", "edit", "delete", "approve", "export"] },
  { path: "/payroll/billing", label: "Payroll · Client Billing", parent: "/payroll", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/tasks", label: "Tasks", capabilities: ["view", "create", "edit", "delete", "export"] },
  { path: "/whatsapp", label: "WhatsApp", capabilities: ["view", "create", "edit", "delete"] },
  { path: "/reports", label: "Reports", capabilities: ["view", "export"] },
  { path: "/approvals", label: "Approvals", capabilities: ["view", "create", "edit", "approve", "export"] },
  { path: "/incidents", label: "Incidents", capabilities: ["view", "create", "edit", "delete", "approve", "export"] },
  { path: "/documents", label: "Documents", capabilities: ["view", "create", "edit", "delete", "export"] },
  { path: "/client-portal", label: "Client Portal", capabilities: ["view", "create"] },
  { path: "/academy", label: "Academy", capabilities: ["view", "view_sensitive", "create", "edit", "delete", "approve", "export"] },
  { path: "/audit", label: "Audit", capabilities: ["view", "export"] },
  { path: "/settings", label: "Settings", capabilities: ["view", "edit", "export"] },
  { path: "/settings/access", label: "Settings · User Access", parent: "/settings", capabilities: ["view", "create", "edit", "delete", "manage_access"] },
  { path: "/settings/migrate", label: "Settings · Data Import / Export", parent: "/settings", capabilities: ["view", "create", "export"] },
] as const;

export const CATALOG_PATHS: readonly string[] = CAPABILITY_CATALOG.map((d) => d.path);
