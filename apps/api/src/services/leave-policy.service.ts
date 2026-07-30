import {
  DEFAULT_DAYS_PER_WEEK,
  DEFAULT_MINUTES_PER_SHIFT,
  STATUTORY_LEAVE_RULES,
  statutoryEntitlementMinutes,
  type EmployeeLeaveContext,
} from "./leave-statutory-rules.js";

/**
 * Accrual methods the runner can actually execute.
 *
 * `PRORATED_CYCLE_GRANT` grants the cycle entitlement pro-rated by the portion
 * of the cycle the employee was employed, which is how a BCEA cycle behaves for
 * a mid-cycle joiner or leaver. `DAYS_WORKED_RATIO` is the s20(2)(b) / s22(2)
 * alternative of one day per N days worked.
 */
const EXECUTABLE_BALANCE_ACCRUAL_METHODS = new Set([
  "MONTHLY",
  "MONTHLY_FIXED",
  "EVEN_MONTHLY",
  "ANNUAL_GRANT",
  "PRORATED_CYCLE_GRANT",
  "DAYS_WORKED_RATIO",
]);

/** Methods that derive their amount from days worked rather than a flat rate. */
const RATIO_ACCRUAL_METHODS = new Set(["DAYS_WORKED_RATIO"]);

/** Methods driven by a per-month rate rather than a cycle entitlement. */
const RATE_ACCRUAL_METHODS = new Set(["MONTHLY", "MONTHLY_FIXED"]);

export type LeavePolicyConfiguration = {
  leaveType: { requiresBalance: boolean; code?: string };
  accrualMethod: string;
  accrualRateMinutes?: unknown;
  accrualRatioDays?: number | null;
  entitlementMinutes?: number | null;
  cycleMonths: number;
  carryOverLimitMinutes?: number | null;
  expiryMonths?: number | null;
  noticeDays?: number | null;
  autoConvertToUnpaid?: boolean;
};

function positiveNumber(value: unknown): boolean {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

/** The reference employee the statutory floor is stated against when seeding. */
function referenceContext(): EmployeeLeaveContext {
  return {
    normalDaysPerWeek: DEFAULT_DAYS_PER_WEEK,
    normalMinutesPerShift: DEFAULT_MINUTES_PER_SHIFT,
    employedFrom: new Date(Date.UTC(2000, 0, 1)),
    asOf: new Date(Date.UTC(2030, 0, 1)),
  };
}

/**
 * Refuse to confirm a policy that cannot be executed, or that undercuts the
 * BCEA.
 *
 * Two distinct failures are caught here:
 *
 *   1. **Not executable** — the accrual runner would not know what to post, so
 *      confirming would produce a policy that silently grants nothing.
 *   2. **Below the statutory floor** — BCEA s4-5 make the Act a minimum. A
 *      company may agree more generous terms, but a policy version stating less
 *      than the statute is unenforceable and must not be confirmed.
 *
 * Carry-over, expiry, notice periods and automatic conversion to unpaid are now
 * executed by the engine, so they are configuration to validate rather than
 * reasons to fail closed.
 */
export function leavePolicyConfigurationIssues(
  version: LeavePolicyConfiguration
): string[] {
  const method = version.accrualMethod.trim().toUpperCase();

  if (!version.leaveType.requiresBalance) {
    const issues =
      method === "NONE"
        ? []
        : ["Leave types without a balance must use the NONE accrual method."];
    if ((version.noticeDays ?? 0) < 0) {
      issues.push("Notice days cannot be negative.");
    }
    return issues;
  }

  if (!EXECUTABLE_BALANCE_ACCRUAL_METHODS.has(method)) {
    return ["Choose a supported balance accrual method before confirming this policy."];
  }

  const issues: string[] = [];
  if (version.cycleMonths <= 0) {
    issues.push("Balance-controlled leave requires a positive cycle length.");
  }

  if (RATE_ACCRUAL_METHODS.has(method)) {
    if (!positiveNumber(version.accrualRateMinutes)) {
      issues.push("Enter a positive monthly accrual rate.");
    }
  } else if (RATIO_ACCRUAL_METHODS.has(method)) {
    if (!positiveNumber(version.accrualRatioDays)) {
      issues.push(
        "Enter the number of days worked that earns one day of leave, for example 17 for annual leave or 26 for sick leave."
      );
    }
    if (!positiveNumber(version.entitlementMinutes)) {
      issues.push("Enter the entitlement ceiling for the leave cycle.");
    }
  } else if (!positiveNumber(version.entitlementMinutes)) {
    issues.push("Enter a positive entitlement for the leave cycle.");
  }

  if (version.carryOverLimitMinutes != null && version.carryOverLimitMinutes < 0) {
    issues.push("The carry-over limit cannot be negative.");
  }
  if (version.expiryMonths != null && version.expiryMonths < 0) {
    issues.push("The expiry period cannot be negative.");
  }
  if ((version.noticeDays ?? 0) < 0) {
    issues.push("Notice days cannot be negative.");
  }

  issues.push(...statutoryFloorIssues(version));
  return issues;
}

/**
 * Compare a configured policy against the statutory minimum for its leave type.
 *
 * Entitlement is compared as a monthly rate so that changing the cycle length
 * cannot be used to dilute the entitlement: 30 days per 36 months and 10 days
 * per 12 months are the same rate, while 10 days per 36 months is not.
 */
function statutoryFloorIssues(version: LeavePolicyConfiguration): string[] {
  const code = version.leaveType.code;
  if (!code) return [];
  const rule = STATUTORY_LEAVE_RULES[code];
  if (!rule) return [];

  const issues: string[] = [];
  const statutoryMinutes = statutoryEntitlementMinutes(code, referenceContext());
  const configuredMinutes = Number(version.entitlementMinutes ?? 0);

  if (statutoryMinutes != null && statutoryMinutes > 0 && version.cycleMonths > 0) {
    const statutoryRate = statutoryMinutes / rule.cycleMonths;
    const configuredRate = configuredMinutes / version.cycleMonths;
    // A minute of tolerance absorbs rounding on unusual cycle lengths rather
    // than blocking a policy that is statutorily equivalent.
    if (configuredRate + 1 < statutoryRate) {
      const statutoryDays = Math.round(statutoryMinutes / DEFAULT_MINUTES_PER_SHIFT);
      issues.push(
        `${rule.reference} requires at least ${statutoryDays} days per ${rule.cycleMonths}-month cycle for a standard five-day week; this policy grants less and cannot be confirmed.`
      );
    }
  }

  if (
    rule.carryOverLimitMinutes != null &&
    version.carryOverLimitMinutes != null &&
    version.carryOverLimitMinutes < rule.carryOverLimitMinutes
  ) {
    issues.push(
      `${rule.reference} does not permit a carry-over limit below ${rule.carryOverLimitMinutes} minutes.`
    );
  }

  // Expiry is measured from the end of the cycle. Setting it shorter than the
  // statutory grace period would forfeit leave the employee is still entitled
  // to take — BCEA s20(4) for annual leave.
  if (version.expiryMonths != null && version.expiryMonths < rule.graceMonths) {
    issues.push(
      `${rule.reference} allows leave to be taken for ${rule.graceMonths} months after the cycle ends; an earlier expiry cannot be confirmed.`
    );
  }

  return issues;
}

export function isLeavePolicyConfigurationReady(
  version: LeavePolicyConfiguration
): boolean {
  return leavePolicyConfigurationIssues(version).length === 0;
}

/**
 * Minutes an occurrence draws from the entitlement balance.
 *
 * Kept separate from the payable minutes because the two genuinely differ: a
 * public holiday inside a leave period is paid, but it is not a day of leave.
 * BCEA s21(3) says so for annual leave, and the same logic applies to sick and
 * family responsibility leave — an employee cannot be "sick" on a day they were
 * never due to work.
 */
export function leaveOccurrenceBalanceMinutes(params: {
  requiresBalance: boolean;
  leaveTypeCode: string;
  isPublicHoliday: boolean;
  requestedMinutes: number;
  /**
   * Whether the leave type consumes balance on a public holiday. Defaults to
   * false so paid statutory leave never burns entitlement on a day the
   * employee was already entitled to be paid for.
   */
  publicHolidayConsumesBalance?: boolean;
}): number {
  if (!params.requiresBalance) return 0;
  if (params.isPublicHoliday && !params.publicHolidayConsumesBalance) return 0;
  return params.requestedMinutes;
}
