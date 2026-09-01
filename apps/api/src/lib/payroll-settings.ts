/**
 * Company-level payroll configuration stored in Company.settings JSON.
 */
export interface PayrollSettings {
  /** When true (default), relievers with approved attendance or leave in the period are included. */
  includeRelieversWithAttendance?: boolean;
  /** Legacy pricing stays active until the global catalog passes readiness and is explicitly activated. */
  rateSource?: "legacy_employee_grade" | "site_area_grade";
}

export function parsePayrollSettings(settings: unknown): {
  includeRelieversWithAttendance: boolean;
  rateSource: "legacy_employee_grade" | "site_area_grade";
} {
  const root = settings as Record<string, unknown> | null;
  const payroll = root?.payroll as Partial<PayrollSettings> | undefined;
  return {
    includeRelieversWithAttendance: payroll?.includeRelieversWithAttendance !== false,
    rateSource:
      payroll?.rateSource === "site_area_grade"
        ? "site_area_grade"
        : "legacy_employee_grade",
  };
}

export function withPayrollRateSource(
  settings: unknown,
  rateSource: "legacy_employee_grade" | "site_area_grade"
): Record<string, unknown> {
  const root =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? { ...(settings as Record<string, unknown>) }
      : {};
  const payroll =
    root.payroll && typeof root.payroll === "object" && !Array.isArray(root.payroll)
      ? { ...(root.payroll as Record<string, unknown>) }
      : {};
  root.payroll = { ...payroll, rateSource };
  return root;
}
