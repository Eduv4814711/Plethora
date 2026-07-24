export function leaveOccurrenceCount(application: {
  occurrences?: readonly unknown[];
  _count?: { occurrences?: number };
}): number {
  return application.occurrences?.length ?? application._count?.occurrences ?? 0;
}

export type LeavePolicyVersionDisplayInput = {
  reviewStatus: string;
  effectiveTo?: string | null;
  configurationReady: boolean;
  configurationIssues: readonly string[];
};

export type LeavePolicyVersionDisplayState = {
  isSuperseded: boolean;
  status: string;
  configurationRequired: boolean;
  configurationIssues: string[];
};

/**
 * Effective-dated policy versions remain in the audit history after a newer
 * version replaces them. An ended ACTIVE row is no longer actionable and must
 * not continue presenting its legacy formula as a current configuration error.
 */
export function leavePolicyVersionDisplayState(
  version: LeavePolicyVersionDisplayInput,
  asOfDate: string
): LeavePolicyVersionDisplayState {
  const effectiveTo = version.effectiveTo?.slice(0, 10);
  const isSuperseded = version.reviewStatus === "ACTIVE"
    && Boolean(effectiveTo && effectiveTo < asOfDate);

  return {
    isSuperseded,
    status: isSuperseded ? "SUPERSEDED" : version.reviewStatus,
    configurationRequired: !isSuperseded && !version.configurationReady,
    configurationIssues: isSuperseded ? [] : [...version.configurationIssues],
  };
}

export type LeaveAdjustmentResolutionDecision = "reject" | "confirm_external_correction";

export type LeaveAdjustmentResolutionPayload = {
  decision: LeaveAdjustmentResolutionDecision;
  reason: string;
  payrollReference?: string;
};

export type LeaveAdjustmentResolutionPreparation =
  | { valid: true; payload: LeaveAdjustmentResolutionPayload }
  | { valid: false; error: string };

export function prepareLeaveAdjustmentResolution(input: {
  decision: LeaveAdjustmentResolutionDecision;
  reason: string;
  payrollReference?: string;
}): LeaveAdjustmentResolutionPreparation {
  const reason = input.reason.trim();
  if (!reason) return { valid: false, error: "A resolution reason is required." };

  if (input.decision === "confirm_external_correction") {
    const payrollReference = input.payrollReference?.trim() ?? "";
    if (!payrollReference) {
      return { valid: false, error: "Enter the reference from the completed external payroll correction." };
    }
    return { valid: true, payload: { decision: input.decision, reason, payrollReference } };
  }

  return { valid: true, payload: { decision: input.decision, reason } };
}
