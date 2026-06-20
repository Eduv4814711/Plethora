/**
 * Company-level payroll configuration stored in Company.settings JSON.
 */
export interface PayrollSettings {
  /** When true (default), relievers with approved attendance or leave in the period are included. */
  includeRelieversWithAttendance?: boolean;
}

export function parsePayrollSettings(settings: unknown): {
  includeRelieversWithAttendance: boolean;
} {
  const root = settings as Record<string, unknown> | null;
  const payroll = root?.payroll as Partial<PayrollSettings> | undefined;
  return {
    includeRelieversWithAttendance: payroll?.includeRelieversWithAttendance !== false,
  };
}
