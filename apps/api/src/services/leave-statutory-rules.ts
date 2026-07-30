/**
 * South African statutory leave rules.
 *
 * Every entitlement in this file is a **floor**, not a fixed value. The BCEA
 * sets minimum conditions of employment: a company policy may be more generous
 * and that agreement stands, but it may not fall below the statute (BCEA s4-5).
 * So the effective entitlement is always
 *
 *     max(configured policy entitlement, statutory floor for this employee)
 *
 * and the floor is computed from the individual's *own* working pattern rather
 * than a hard-coded day count. A six-day-a-week security officer and a
 * Monday-to-Friday office administrator have different statutory entitlements
 * in days, and both are correct.
 *
 * Sources encoded here:
 *   s20  annual leave — 21 consecutive days per 12-month cycle, being the days
 *        the employee would ordinarily work in three weeks (15 for a five-day
 *        week). s20(2)(b) permits the alternative of one day per 17 days worked.
 *   s20(4) annual leave must be granted within six months of the cycle ending.
 *   s22  sick leave — the days ordinarily worked in six weeks, per 36-month
 *        cycle (30 for a five-day week). s22(2): during the first six months of
 *        employment, one day per 26 days worked. s22(4): in the first cycle the
 *        entitlement may be reduced by sick days already taken in those first
 *        six months.
 *   s23  proof of incapacity — a certificate may be required for an absence of
 *        more than two consecutive days, or on more than two occasions in an
 *        eight-week period.
 *   s25-25C / Van Wyk v Minister of Employment and Labour (CC, 3 October 2025)
 *        parental leave — a single pool of four months and ten days shared
 *        between the parents, with six weeks after birth reserved to the person
 *        who gave birth.
 *   s27  family responsibility leave — three days per 12-month cycle, for
 *        employees employed longer than four months who work at least four days
 *        a week.
 *   s40  on termination, accrued annual leave is paid out.
 *
 * Pure and database-free: callers assemble the context and apply the findings.
 */

/** Standard South African working pattern, used only where nothing better is known. */
export const DEFAULT_DAYS_PER_WEEK = 5;
export const DEFAULT_MINUTES_PER_SHIFT = 480;

/** BCEA s20: three weeks of ordinary working days per annual cycle. */
const ANNUAL_WEEKS_PER_CYCLE = 3;
/** BCEA s22: six weeks of ordinary working days per sick cycle. */
const SICK_WEEKS_PER_CYCLE = 6;
/** BCEA s27: three days per cycle. */
const FAMILY_RESPONSIBILITY_DAYS = 3;

/** BCEA s20(2)(b): one day's annual leave for every 17 days worked. */
export const ANNUAL_DAYS_WORKED_RATIO = 17;
/** BCEA s22(2): one day's sick leave for every 26 days worked. */
export const SICK_DAYS_WORKED_RATIO = 26;

/** BCEA s22(2) applies for the first six months of employment. */
export const SICK_INITIAL_PERIOD_MONTHS = 6;
/** BCEA s27(1): four months' service before family responsibility leave accrues. */
export const FAMILY_RESPONSIBILITY_QUALIFYING_MONTHS = 4;
/** BCEA s27(1): the employee must ordinarily work at least four days a week. */
export const FAMILY_RESPONSIBILITY_MIN_DAYS_PER_WEEK = 4;

/**
 * Van Wyk: four months and ten days, shared between the parents.
 * Expressed in calendar days — parental leave runs consecutively, not in
 * working days. Four months is taken as 17.33 weeks, i.e. 122 days.
 */
export const PARENTAL_POOL_CALENDAR_DAYS = 122 + 10;
/** Six weeks after the birth are reserved to the person who gave birth. */
export const BIRTH_PARENT_RESERVED_DAYS = 42;

/** BCEA s23: a certificate may be demanded beyond two consecutive days. */
export const SICK_PROOF_CONSECUTIVE_DAYS = 2;
/** BCEA s23: or on more than two occasions in an eight-week window. */
export const SICK_PROOF_OCCASIONS = 2;
export const SICK_PROOF_WINDOW_WEEKS = 8;

export type EmployeeLeaveContext = {
  /** Ordinary working days per week — 5 for Mon–Fri, 6 for a six-day week. */
  normalDaysPerWeek: number;
  /** Ordinary paid minutes in one working day. */
  normalMinutesPerShift: number;
  /** Employment anchor: employment term start, else commencement date. */
  employedFrom: Date;
  /** Reference date for service-length tests. */
  asOf: Date;
  /** Days actually worked in the period, for the ratio-based methods. */
  daysWorked?: number;
};

export type StatutoryFinding = {
  /** Machine-readable rule identifier, e.g. "BCEA_S27_SERVICE". */
  code: string;
  /** Statute section this finding enforces. */
  reference: string;
  message: string;
  /**
   * `block` prevents approval; `warn` is surfaced at preview so the capturer
   * can see the rule before submitting.
   */
  severity: "block" | "warn";
};

export type StatutoryLeaveRule = {
  code: string;
  reference: string;
  /** BCEA cycle length in months. */
  cycleMonths: number;
  /** Months after the cycle ends during which the leave must still be granted. */
  graceMonths: number;
  /** Minutes that may be carried into the next cycle; 0 forfeits the balance. */
  carryOverLimitMinutes: number | null;
  /** Statutory minimum entitlement in minutes, or null when unregulated. */
  entitlementMinutes: (ctx: EmployeeLeaveContext) => number | null;
};

function positiveDaysPerWeek(ctx: EmployeeLeaveContext): number {
  const days = Number(ctx.normalDaysPerWeek);
  if (!Number.isFinite(days) || days <= 0) return DEFAULT_DAYS_PER_WEEK;
  // Nobody ordinarily works more than seven days in a week; a bad capture must
  // not inflate a statutory entitlement.
  return Math.min(7, days);
}

function positiveMinutesPerShift(ctx: EmployeeLeaveContext): number {
  const minutes = Number(ctx.normalMinutesPerShift);
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_MINUTES_PER_SHIFT;
  return minutes;
}

/** Whole months of service completed at `asOf`. */
export function completedMonthsOfService(ctx: EmployeeLeaveContext): number {
  const from = ctx.employedFrom;
  const to = ctx.asOf;
  if (to < from) return 0;
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * BCEA s20: the days the employee would ordinarily work in three weeks.
 *
 * A five-day week gives 15 working days, which is the same amount of time off
 * as the "21 consecutive days" the section states.
 */
function annualEntitlementMinutes(ctx: EmployeeLeaveContext): number {
  return Math.round(
    positiveDaysPerWeek(ctx) * ANNUAL_WEEKS_PER_CYCLE * positiveMinutesPerShift(ctx)
  );
}

/**
 * BCEA s22: the days the employee would ordinarily work in six weeks, per
 * 36-month cycle. A five-day week gives 30 days.
 *
 * During the first six months of employment s22(2) applies instead, granting
 * one day for every 26 days worked — see `initialSickEntitlementMinutes`.
 */
function sickEntitlementMinutes(ctx: EmployeeLeaveContext): number {
  return Math.round(
    positiveDaysPerWeek(ctx) * SICK_WEEKS_PER_CYCLE * positiveMinutesPerShift(ctx)
  );
}

function familyResponsibilityEntitlementMinutes(
  ctx: EmployeeLeaveContext
): number {
  return Math.round(FAMILY_RESPONSIBILITY_DAYS * positiveMinutesPerShift(ctx));
}

/**
 * BCEA s22(2): sick-leave entitlement during the first six months of
 * employment, being one day for every 26 days worked.
 *
 * Capped at the full cycle entitlement so an employee who works an unusually
 * dense pattern cannot exceed what the completed six months would have given.
 */
export function initialSickEntitlementMinutes(ctx: EmployeeLeaveContext): number {
  const daysWorked = Math.max(0, Math.floor(ctx.daysWorked ?? 0));
  const earnedDays = Math.floor(daysWorked / SICK_DAYS_WORKED_RATIO);
  const minutes = earnedDays * positiveMinutesPerShift(ctx);
  return Math.min(minutes, sickEntitlementMinutes(ctx));
}

/** True while BCEA s22(2) still governs instead of the full s22(1) entitlement. */
export function isWithinInitialSickPeriod(ctx: EmployeeLeaveContext): boolean {
  return completedMonthsOfService(ctx) < SICK_INITIAL_PERIOD_MONTHS;
}

/**
 * BCEA s20(2)(b): one day's annual leave for every 17 days worked, offered as
 * an alternative to the flat cycle grant.
 */
export function daysWorkedRatioMinutes(params: {
  daysWorked: number;
  ratioDays: number;
  minutesPerShift: number;
}): number {
  const ratio = Math.max(1, Math.floor(params.ratioDays));
  const worked = Math.max(0, Math.floor(params.daysWorked));
  return Math.floor(worked / ratio) * Math.max(0, params.minutesPerShift);
}

/**
 * The statutory rule registry.
 *
 * Leave types absent from this map are unregulated by the BCEA — study,
 * special and company-defined leave — and are governed purely by the configured
 * policy. Unpaid leave and injury on duty carry no entitlement of their own:
 * IOD compensation is a COIDA matter, not a leave balance.
 */
export const STATUTORY_LEAVE_RULES: Record<string, StatutoryLeaveRule> = {
  annual: {
    code: "annual",
    reference: "BCEA s20",
    cycleMonths: 12,
    graceMonths: 6,
    // Statutory annual leave stays available right through the six-month grace
    // period — the cycle is only closed at `graceEnd` — and is forfeited there.
    // A company may be more generous by allowing a carry-over, never less.
    carryOverLimitMinutes: 0,
    entitlementMinutes: annualEntitlementMinutes,
  },
  sick: {
    code: "sick",
    reference: "BCEA s22",
    cycleMonths: 36,
    graceMonths: 0,
    // Sick leave does not accumulate across cycles: the balance resets.
    carryOverLimitMinutes: 0,
    entitlementMinutes: sickEntitlementMinutes,
  },
  family_responsibility: {
    code: "family_responsibility",
    reference: "BCEA s27",
    cycleMonths: 12,
    graceMonths: 0,
    carryOverLimitMinutes: 0,
    entitlementMinutes: familyResponsibilityEntitlementMinutes,
  },
};

/** The statutory floor for a leave type, or null when the BCEA is silent. */
export function statutoryEntitlementMinutes(
  leaveTypeCode: string,
  ctx: EmployeeLeaveContext
): number | null {
  const rule = STATUTORY_LEAVE_RULES[leaveTypeCode];
  if (!rule) return null;
  if (leaveTypeCode === "sick" && isWithinInitialSickPeriod(ctx)) {
    return initialSickEntitlementMinutes(ctx);
  }
  return rule.entitlementMinutes(ctx);
}

/**
 * Reconcile a configured policy entitlement with the statutory floor.
 *
 * The more generous of the two wins, which is what BCEA s4-5 requires: an
 * agreement may improve on the statute but never undercut it.
 */
export function effectiveEntitlementMinutes(params: {
  leaveTypeCode: string;
  configuredMinutes: number | null;
  ctx: EmployeeLeaveContext;
}): number {
  const statutory = statutoryEntitlementMinutes(params.leaveTypeCode, params.ctx);
  const configured =
    params.configuredMinutes != null && params.configuredMinutes > 0
      ? params.configuredMinutes
      : 0;
  return Math.max(configured, statutory ?? 0);
}

/**
 * BCEA s27(1) eligibility for family responsibility leave: more than four
 * months' service, and at least four ordinary working days a week.
 */
export function familyResponsibilityFindings(
  ctx: EmployeeLeaveContext
): StatutoryFinding[] {
  const findings: StatutoryFinding[] = [];
  if (completedMonthsOfService(ctx) < FAMILY_RESPONSIBILITY_QUALIFYING_MONTHS) {
    findings.push({
      code: "BCEA_S27_SERVICE",
      reference: "BCEA s27(1)",
      severity: "block",
      message: `Family responsibility leave requires more than ${FAMILY_RESPONSIBILITY_QUALIFYING_MONTHS} months' service with this employer.`,
    });
  }
  if (positiveDaysPerWeek(ctx) < FAMILY_RESPONSIBILITY_MIN_DAYS_PER_WEEK) {
    findings.push({
      code: "BCEA_S27_DAYS_PER_WEEK",
      reference: "BCEA s27(1)",
      severity: "block",
      message: `Family responsibility leave requires the employee to ordinarily work at least ${FAMILY_RESPONSIBILITY_MIN_DAYS_PER_WEEK} days a week.`,
    });
  }
  return findings;
}

/**
 * BCEA s23: whether proof of incapacity may be demanded for this absence.
 *
 * Either limb triggers the requirement — an absence longer than two consecutive
 * working days, or a third sick occasion inside an eight-week window.
 */
export function sickProofRequired(params: {
  consecutiveWorkingDays: number;
  priorOccasionsInWindow: number;
}): { required: boolean; reason: string | null } {
  if (params.consecutiveWorkingDays > SICK_PROOF_CONSECUTIVE_DAYS) {
    return {
      required: true,
      reason: `The absence exceeds ${SICK_PROOF_CONSECUTIVE_DAYS} consecutive working days, so BCEA s23 allows proof of incapacity to be required.`,
    };
  }
  if (params.priorOccasionsInWindow >= SICK_PROOF_OCCASIONS) {
    return {
      required: true,
      reason: `This is more than ${SICK_PROOF_OCCASIONS} sick-leave occasions in ${SICK_PROOF_WINDOW_WEEKS} weeks, so BCEA s23 allows proof of incapacity to be required.`,
    };
  }
  return { required: false, reason: null };
}

/**
 * Default policy configuration for seeding a company's statutory baseline.
 *
 * Entitlement is stated for the standard five-day, eight-hour week. The rule
 * engine raises it per employee where their own pattern is longer, so this is a
 * reference figure rather than a cap.
 */
export function statutoryPolicyDefaults(leaveTypeCode: string): {
  cycleMonths: number;
  graceMonths: number;
  entitlementMinutes: number | null;
  accrualMethod: string;
  carryOverLimitMinutes: number | null;
  reference: string;
} | null {
  const rule = STATUTORY_LEAVE_RULES[leaveTypeCode];
  if (!rule) return null;
  const referenceCtx: EmployeeLeaveContext = {
    normalDaysPerWeek: DEFAULT_DAYS_PER_WEEK,
    normalMinutesPerShift: DEFAULT_MINUTES_PER_SHIFT,
    employedFrom: new Date(Date.UTC(2000, 0, 1)),
    asOf: new Date(Date.UTC(2030, 0, 1)),
  };
  return {
    cycleMonths: rule.cycleMonths,
    graceMonths: rule.graceMonths,
    entitlementMinutes: rule.entitlementMinutes(referenceCtx),
    // Entitlement is granted for the cycle and pro-rated for partial service,
    // which is how BCEA cycles actually behave; the alternative s20(2)(b)
    // ratio method remains available for companies that elect it.
    accrualMethod: "PRORATED_CYCLE_GRANT",
    carryOverLimitMinutes: rule.carryOverLimitMinutes,
    reference: rule.reference,
  };
}
