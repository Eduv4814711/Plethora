import { describe, expect, it } from "vitest";
import {
  leaveOccurrenceCount,
  leavePolicyVersionDisplayState,
  prepareLeaveAdjustmentResolution,
} from "../leave-management-utils";

describe("leave management API response helpers", () => {
  it("counts the occurrence array returned by the calendar endpoint", () => {
    expect(leaveOccurrenceCount({ occurrences: [{ id: "one" }, { id: "two" }] })).toBe(2);
  });

  it("keeps list-response count compatibility and defaults to zero", () => {
    expect(leaveOccurrenceCount({ _count: { occurrences: 4 } })).toBe(4);
    expect(leaveOccurrenceCount({})).toBe(0);
  });

  it("does not keep configuration errors actionable on superseded active policy versions", () => {
    expect(leavePolicyVersionDisplayState({
      reviewStatus: "ACTIVE",
      effectiveTo: "2026-07-23T00:00:00.000Z",
      configurationReady: false,
      configurationIssues: ["Choose a supported balance accrual method."],
    }, "2026-07-24")).toEqual({
      isSuperseded: true,
      status: "SUPERSEDED",
      configurationRequired: false,
      configurationIssues: [],
    });
  });

  it("keeps current and pending policy configuration problems actionable", () => {
    const issue = "Enter a positive entitlement for the leave cycle.";
    expect(leavePolicyVersionDisplayState({
      reviewStatus: "ACTIVE",
      effectiveTo: "2026-07-24T00:00:00.000Z",
      configurationReady: false,
      configurationIssues: [issue],
    }, "2026-07-24")).toMatchObject({
      isSuperseded: false,
      status: "ACTIVE",
      configurationRequired: true,
      configurationIssues: [issue],
    });
    expect(leavePolicyVersionDisplayState({
      reviewStatus: "PENDING_HR_LEGAL_CONFIRMATION",
      effectiveTo: "2026-07-23",
      configurationReady: false,
      configurationIssues: [issue],
    }, "2026-07-24")).toMatchObject({
      isSuperseded: false,
      configurationRequired: true,
    });
  });

  it("builds a trimmed external-correction payload only when a payroll reference is supplied", () => {
    expect(prepareLeaveAdjustmentResolution({
      decision: "confirm_external_correction",
      reason: "  Corrected after payroll close  ",
      payrollReference: "  PAY-2026-071  ",
    })).toEqual({
      valid: true,
      payload: {
        decision: "confirm_external_correction",
        reason: "Corrected after payroll close",
        payrollReference: "PAY-2026-071",
      },
    });

    expect(prepareLeaveAdjustmentResolution({
      decision: "confirm_external_correction",
      reason: "Corrected after payroll close",
      payrollReference: "  ",
    })).toEqual({
      valid: false,
      error: "Enter the reference from the completed external payroll correction.",
    });
  });

  it("requires a reason and omits payroll references from rejection payloads", () => {
    expect(prepareLeaveAdjustmentResolution({
      decision: "reject",
      reason: "  Cancellation was entered in error  ",
      payrollReference: "SHOULD-NOT-BE-SENT",
    })).toEqual({
      valid: true,
      payload: { decision: "reject", reason: "Cancellation was entered in error" },
    });
    expect(prepareLeaveAdjustmentResolution({ decision: "reject", reason: "   " })).toEqual({
      valid: false,
      error: "A resolution reason is required.",
    });
  });
});
