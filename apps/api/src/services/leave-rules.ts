/**
 * South African leave rules — the calculation engine.
 *
 * One formula per concern, shared by both employee types. `employeeType` is
 * only ever used as a lookup key into leave-rules.config.ts; there is no
 * branching by type anywhere below beyond "look up this employee type's
 * numbers." Everything here is a pure function of its inputs so it can be
 * unit-tested without a database.
 *
 * Deliberate simplifications (see README for the full list and the ones
 * flagged for labour-counsel confirmation):
 *  - No carry-over, forfeiture or expiry. Balance = entitlement for the
 *    current cycle minus what's already been taken in that cycle.
 *  - Annual/study/family-responsibility leave is granted in full at the
 *    start of each cycle, not accrued day-by-day through it.
 *  - Sick leave during the first 6 months of employment is estimated from
 *    the employee's configured work pattern (workUnitsPerWeek), not from
 *    actual attendance records — this module does not integrate with
 *    rostering/attendance.
 */

import {
  employeeTypeConfig,
  LEAVE_RULES,
  observedHolidayDate,
  type EmployeeTypeKey,
} from "../lib/leave-rules.config.js";

export type LeaveTypeCode = "ANNUAL" | "SICK" | "FAMILY_RESPONSIBILITY" | "PARENTAL" | "STUDY";
export type ParentalLeaveScenarioCode = "SOLE_OR_ONLY_EMPLOYED_PARENT" | "SHARED_POOL";

function toUtcMidnight(date: Date): Date {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error("Invalid date supplied to the leave rules engine");
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateKey(date: Date): string {
  return toUtcMidnight(date).toISOString().slice(0, 10);
}

/** Add whole months in UTC, clamping to the last day of the target month. */
export function addUtcMonths(date: Date, months: number): Date {
  const base = toUtcMidnight(date);
  const targetMonthStart = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const daysInTargetMonth = new Date(
    Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth(),
      Math.min(base.getUTCDate(), daysInTargetMonth),
    ),
  );
}

function addUtcDays(date: Date, days: number): Date {
  const base = toUtcMidnight(date);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + days));
}

/** Whole calendar months elapsed from `anchor` to `asOf`, floored (never negative). */
export function monthsOfService(anchor: Date, asOf: Date): number {
  const a = toUtcMidnight(anchor);
  const b = toUtcMidnight(asOf);
  if (b < a) return 0;
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export interface LeaveCycleWindow {
  start: Date;
  end: Date;
}

/**
 * The cycle of length `cycleMonths` (anchored on `anchor`) that contains
 * `asOf`. Cycle runs from the employee's own anchor date, never the
 * calendar year.
 */
export function currentCycleWindow(anchor: Date, cycleMonths: number, asOf: Date): LeaveCycleWindow {
  if (!Number.isInteger(cycleMonths) || cycleMonths <= 0) {
    throw new Error(`cycleMonths must be a positive whole number (got ${cycleMonths})`);
  }
  const index = Math.floor(monthsOfService(anchor, asOf) / cycleMonths);
  const start = addUtcMonths(toUtcMidnight(anchor), index * cycleMonths);
  const end = addUtcDays(addUtcMonths(start, cycleMonths), -1);
  return { start, end };
}

// --- Annual leave ---

/** 21 consecutive days per 12-month cycle for both employee types. */
export function annualLeaveEntitlementUnits(employeeType: EmployeeTypeKey): number {
  return employeeTypeConfig(employeeType).annualLeaveDays;
}

/**
 * Public holidays falling inside an annual leave request are not deducted.
 * Returns the number of units actually drawn from the balance for a given
 * annual-leave request — `unitsRequested` minus any observed public holiday
 * that falls within [startDate, endDate], floored at zero.
 */
export function annualLeaveDeductibleUnits(params: {
  unitsRequested: number;
  startDate: Date;
  endDate: Date;
}): number {
  const holidaysInRange = publicHolidaysInRange(params.startDate, params.endDate).length;
  return Math.max(0, params.unitsRequested - holidaysInRange);
}

// --- Sick leave (the universal formula) ---

/**
 * 6 x normal work units per week, over a 36-month cycle. A work unit is a
 * day for general staff and a shift for security officers — the same
 * formula, different number plugged in via employeeType.
 */
export function sickLeaveFullCycleEntitlementUnits(employeeType: EmployeeTypeKey): number {
  return 6 * employeeTypeConfig(employeeType).workUnitsPerWeek;
}

/**
 * Work units estimated to have been worked between two dates, from the
 * employee's configured work pattern. This module does not integrate with
 * attendance/rostering, so this is a proxy, not a count of actual
 * attendance — flagged in the README.
 */
export function estimatedUnitsWorked(employeeType: EmployeeTypeKey, from: Date, to: Date): number {
  const a = toUtcMidnight(from);
  const b = toUtcMidnight(to);
  if (b <= a) return 0;
  const days = (b.getTime() - a.getTime()) / 86_400_000;
  return employeeTypeConfig(employeeType).workUnitsPerWeek * (days / 7);
}

/**
 * Sick leave entitlement as of `asOf`, within the 36-month cycle starting
 * `cycleStart`.
 *
 *  - First 6 months of employment (from `commencementDate`): 1 unit of
 *    leave per 26 units worked (estimated — see `estimatedUnitsWorked`).
 *  - After 6 months of service: the full 6 x workUnitsPerWeek entitlement
 *    for the rest of that 36-month cycle.
 */
export function sickLeaveEntitlementUnits(params: {
  employeeType: EmployeeTypeKey;
  commencementDate: Date;
  asOf: Date;
}): number {
  const monthsEmployed = monthsOfService(params.commencementDate, params.asOf);
  if (monthsEmployed < 6) {
    const workedUnits = estimatedUnitsWorked(params.employeeType, params.commencementDate, params.asOf);
    return Math.floor(workedUnits / 26);
  }
  return sickLeaveFullCycleEntitlementUnits(params.employeeType);
}

/**
 * A medical certificate is required if the absence is more than 2
 * consecutive work units, or the employee has been on sick leave more than
 * twice in an 8-week window (56 days).
 */
export function isMedicalCertificateRequired(params: {
  unitsRequested: number;
  priorSickOccurrencesInTrailing8Weeks: number;
}): boolean {
  return params.unitsRequested > 2 || params.priorSickOccurrencesInTrailing8Weeks > 2;
}

// --- Family responsibility leave ---

/** 3 days per 12-month cycle, same for both employee types. */
export function familyResponsibilityEntitlementUnits(): number {
  return LEAVE_RULES.familyResponsibilityDaysPerYear;
}

/**
 * Requires more than 4 months' service. BCEA also requires working >= 4
 * "days" a week; 4 shifts a week is treated as satisfying this for security
 * officers — an assumption flagged in the README for labour-counsel
 * confirmation, not a settled legal position.
 */
export function isEligibleForFamilyResponsibilityLeave(params: {
  employeeType: EmployeeTypeKey;
  commencementDate: Date;
  asOf: Date;
}): boolean {
  const monthsEmployed = monthsOfService(params.commencementDate, params.asOf);
  const worksAtLeastFourUnitsAWeek = employeeTypeConfig(params.employeeType).workUnitsPerWeek >= 4;
  return monthsEmployed > LEAVE_RULES.familyResponsibilityMinServiceMonths && worksAtLeastFourUnitsAWeek;
}

// --- Parental leave ---

/**
 * Maximum days claimable for a parental leave request under the given
 * scenario, measured from `startDate`. Unpaid by statute — no pay
 * calculation happens here. The employee declares days taken; this module
 * does not verify anything with another employer.
 */
export function parentalLeaveMaxDays(scenario: ParentalLeaveScenarioCode, startDate: Date): number {
  const start = toUtcMidnight(startDate);
  if (scenario === "SOLE_OR_ONLY_EMPLOYED_PARENT") {
    const end = addUtcMonths(start, LEAVE_RULES.parentalLeaveSoleEarnerMonths);
    return Math.round((end.getTime() - start.getTime()) / 86_400_000);
  }
  const { months, extraDays } = LEAVE_RULES.parentalLeaveSharedPool;
  const end = addUtcDays(addUtcMonths(start, months), extraDays);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

// --- Study leave (security_officer only — same mechanics as annual leave) ---

export function studyLeaveEntitlementUnits(employeeType: EmployeeTypeKey): number {
  return employeeTypeConfig(employeeType).studyLeaveDaysPerYear;
}

/** Study leave only applies where the employee type's config grants > 0 days/year. */
export function isLeaveTypeAvailable(leaveType: LeaveTypeCode, employeeType: EmployeeTypeKey): boolean {
  if (leaveType === "STUDY") return studyLeaveEntitlementUnits(employeeType) > 0;
  return true;
}

// --- Public holidays ---

/** Observed dates (Sunday -> Monday) of every configured public holiday whose observed date falls within [startDate, endDate]. */
export function publicHolidaysInRange(startDate: Date, endDate: Date): string[] {
  const startKey = dateKey(startDate);
  const endKey = dateKey(endDate);
  return LEAVE_RULES.publicHolidays2026
    .map(observedHolidayDate)
    .filter((observed) => observed >= startKey && observed <= endKey);
}

// --- Balance ---

/** entitlement + manual adjustments − already taken, for one leave type in one cycle. */
export function availableUnits(params: {
  entitlementUnits: number;
  adjustmentUnits: number;
  takenUnits: number;
}): number {
  return params.entitlementUnits + params.adjustmentUnits - params.takenUnits;
}
