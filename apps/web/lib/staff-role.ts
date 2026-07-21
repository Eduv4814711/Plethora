import type { UserRole } from "./api";

const STAFF_ROLE_LABELS: Record<Exclude<UserRole, "admin" | "client">, string> = {
  operations_manager: "Operations Manager",
  hr_payroll: "HR & Payroll",
  supervisor: "Supervisor",
  controller: "Controller",
};

const STAFF_ROLE_ALIASES: Record<string, Exclude<UserRole, "admin" | "client">> = {
  om: "operations_manager",
  operationsmanager: "operations_manager",
  opsmanager: "operations_manager",
  hr: "hr_payroll",
  hrmanager: "hr_payroll",
  humanresourcesmanager: "hr_payroll",
  hrandpayroll: "hr_payroll",
  hrpayroll: "hr_payroll",
  payroll: "hr_payroll",
  payrollmanager: "hr_payroll",
  payrolladministrator: "hr_payroll",
  payrollofficer: "hr_payroll",
  pay: "hr_payroll",
  sup: "supervisor",
  ctrl: "controller",
};

function compactRoleTitle(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Resolve an exact staff title/alias to its permission profile. */
export function parseStaffRoleInput(raw: string): UserRole | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  const asRoleKey = trimmed.replace(/\s+/g, "_");
  for (const [role, label] of Object.entries(STAFF_ROLE_LABELS) as [
    Exclude<UserRole, "admin" | "client">,
    string,
  ][]) {
    if (trimmed === role || asRoleKey === role || compactRoleTitle(raw) === compactRoleTitle(label)) {
      return role;
    }
  }

  return STAFF_ROLE_ALIASES[compactRoleTitle(raw)] ?? null;
}
