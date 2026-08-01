/**
 * South African leave rules — one config file, two sets of numbers.
 *
 * General staff and NBCPSS-covered security officers are handled by the same
 * formulas throughout the leave module (see services/leave-rules.ts); the
 * only thing that differs between them is the numbers below, looked up by
 * `employeeType`.
 *
 * When these numbers change (expect a review around March 2027 for security
 * officers, and around 2028 for parental leave generally), edit this file
 * and bump `rulesValidFrom`. Nothing else should need to change.
 */

export interface EmployeeTypeLeaveConfig {
  /** Normal work units per week. A "unit" is a day for general staff, a shift for security officers. */
  workUnitsPerWeek: number;
  /** Hours in one work unit — used only to convert units to hours for payroll, never to calculate entitlement. */
  hoursPerUnit: number;
  annualLeaveDays: number;
  /** 0 means this employee type does not get study leave at all. */
  studyLeaveDaysPerYear: number;
}

export interface PublicHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface LeaveRulesConfig {
  rulesValidFrom: string; // YYYY-MM-DD
  employeeTypes: {
    general: EmployeeTypeLeaveConfig;
    security_officer: EmployeeTypeLeaveConfig;
  };
  sickLeaveCycleMonths: number;
  familyResponsibilityDaysPerYear: number;
  familyResponsibilityMinServiceMonths: number;
  parentalLeaveSoleEarnerMonths: number;
  parentalLeaveSharedPool: { months: number; extraDays: number };
  publicHolidayWorkedMultiplier: number;
  publicHolidays2026: PublicHoliday[];
}

export const LEAVE_RULES: LeaveRulesConfig = {
  rulesValidFrom: "2026-01-01",

  employeeTypes: {
    general: {
      workUnitsPerWeek: 5,
      hoursPerUnit: 8,
      annualLeaveDays: 21,
      studyLeaveDaysPerYear: 0,
    },
    security_officer: {
      workUnitsPerWeek: 4,
      hoursPerUnit: 12,
      annualLeaveDays: 21,
      studyLeaveDaysPerYear: 6,
    },
  },

  sickLeaveCycleMonths: 36,
  familyResponsibilityDaysPerYear: 3,
  familyResponsibilityMinServiceMonths: 4,
  parentalLeaveSoleEarnerMonths: 4,
  parentalLeaveSharedPool: { months: 4, extraDays: 10 },
  publicHolidayWorkedMultiplier: 2.0,

  // Copied verbatim from the existing factory-reset seed data
  // (apps/api/src/routes/settings.ts) so both stay consistent.
  publicHolidays2026: [
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-03-21", name: "Human Rights Day" },
    { date: "2026-04-03", name: "Good Friday" },
    { date: "2026-04-06", name: "Family Day" },
    { date: "2026-04-27", name: "Freedom Day" },
    { date: "2026-05-01", name: "Workers' Day" },
    { date: "2026-06-16", name: "Youth Day" },
    { date: "2026-08-09", name: "Women's Day" },
    { date: "2026-09-24", name: "Heritage Day" },
    { date: "2026-12-16", name: "Day of Reconciliation" },
    { date: "2026-12-25", name: "Christmas Day" },
    { date: "2026-12-26", name: "Day of Goodwill" },
  ],
};

export type EmployeeTypeKey = keyof LeaveRulesConfig["employeeTypes"];

export function employeeTypeConfig(employeeType: EmployeeTypeKey): EmployeeTypeLeaveConfig {
  const config = LEAVE_RULES.employeeTypes[employeeType];
  if (!config) {
    throw new Error(`Unknown employee type "${employeeType}" — not in leave-rules.config.ts`);
  }
  return config;
}

/**
 * The date a public holiday is actually observed. A holiday falling on a
 * Sunday moves to the following Monday. This does NOT apply to Saturdays.
 */
export function observedHolidayDate(holiday: PublicHoliday): string {
  const date = new Date(`${holiday.date}T00:00:00.000Z`);
  if (date.getUTCDay() === 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }
  return holiday.date;
}
