const EXECUTABLE_BALANCE_ACCRUAL_METHODS = new Set([
  "MONTHLY",
  "MONTHLY_FIXED",
  "EVEN_MONTHLY",
  "ANNUAL_GRANT",
]);

export type LeavePolicyConfiguration = {
  leaveType: { requiresBalance: boolean };
  accrualMethod: string;
  accrualRateMinutes?: unknown;
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

/**
 * A policy can be legally reviewed yet still be impossible to execute. Keep
 * confirmation and payroll approval closed until every balance rule has a
 * deterministic formula that the accrual runner understands.
 */
export function leavePolicyConfigurationIssues(
  version: LeavePolicyConfiguration
): string[] {
  const method = version.accrualMethod.trim().toUpperCase();

  if (!version.leaveType.requiresBalance) {
    const issues = method === "NONE"
      ? []
      : ["Leave types without a balance must use the NONE accrual method."];
    if ((version.noticeDays ?? 0) > 0) {
      issues.push("Automated notice-period enforcement is not supported yet; set notice days to zero and enforce the approved rule during HR review.");
    }
    return issues;
  }

  if (!EXECUTABLE_BALANCE_ACCRUAL_METHODS.has(method)) {
    return [
      "Choose a supported balance accrual method before confirming this policy.",
    ];
  }

  const issues: string[] = [];
  if (version.cycleMonths <= 0) {
    issues.push("Balance-controlled leave requires a positive cycle length.");
  }
  if (["MONTHLY", "MONTHLY_FIXED"].includes(method)) {
    if (!positiveNumber(version.accrualRateMinutes)) {
      issues.push("Enter a positive monthly accrual rate.");
    }
  } else if (!positiveNumber(version.entitlementMinutes)) {
    issues.push("Enter a positive entitlement for the leave cycle.");
  }

  if (version.carryOverLimitMinutes != null) {
    issues.push("Automated carry-over limits are not supported yet; leave this blank and use an audited balance adjustment at cycle close.");
  }
  if (version.expiryMonths != null) {
    issues.push("Automated balance expiry is not supported yet; leave this blank and use an audited balance adjustment when entitlement expires.");
  }
  if ((version.noticeDays ?? 0) > 0) {
    issues.push("Automated notice-period enforcement is not supported yet; set notice days to zero and enforce the approved rule during HR review.");
  }
  if (version.autoConvertToUnpaid) {
    issues.push("Automatic conversion to unpaid leave is not supported; insufficient-balance requests must be reviewed explicitly.");
  }

  return issues;
}

export function isLeavePolicyConfigurationReady(
  version: LeavePolicyConfiguration
): boolean {
  return leavePolicyConfigurationIssues(version).length === 0;
}

export function leaveOccurrenceBalanceMinutes(params: {
  requiresBalance: boolean;
  leaveTypeCode: string;
  isPublicHoliday: boolean;
  requestedMinutes: number;
}): number {
  if (!params.requiresBalance) return 0;
  if (params.leaveTypeCode === "annual" && params.isPublicHoliday) return 0;
  return params.requestedMinutes;
}
