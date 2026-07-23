import { describe, expect, it } from "vitest";
import {
  leaveOccurrenceBalanceMinutes,
  leavePolicyConfigurationIssues,
} from "../leave-policy.service.js";

describe("leave policy executable configuration", () => {
  it("accepts NONE for a leave type that does not maintain a balance", () => {
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: false },
      accrualMethod: "NONE",
      cycleMonths: 0,
    })).toEqual([]);
  });

  it("rejects a confirmed placeholder for balance-controlled leave", () => {
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true },
      accrualMethod: "POLICY_CONFIRMATION_REQUIRED",
      entitlementMinutes: null,
      accrualRateMinutes: null,
      cycleMonths: 12,
    })).toContain("Choose a supported balance accrual method before confirming this policy.");
  });

  it("requires the correct value for each supported accrual method", () => {
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true },
      accrualMethod: "EVEN_MONTHLY",
      entitlementMinutes: 7_200,
      cycleMonths: 12,
    })).toEqual([]);
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true },
      accrualMethod: "MONTHLY_FIXED",
      accrualRateMinutes: 600,
      cycleMonths: 12,
    })).toEqual([]);
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true },
      accrualMethod: "MONTHLY_FIXED",
      accrualRateMinutes: null,
      cycleMonths: 12,
    })).toContain("Enter a positive monthly accrual rate.");
  });

  it("fails closed for policy features that are stored but not automated", () => {
    const issues = leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true },
      accrualMethod: "EVEN_MONTHLY",
      entitlementMinutes: 7_200,
      cycleMonths: 12,
      carryOverLimitMinutes: 2_400,
      expiryMonths: 6,
      noticeDays: 7,
      autoConvertToUnpaid: true,
    });
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining("carry-over"),
      expect.stringContaining("expiry"),
      expect.stringContaining("notice-period"),
      expect.stringContaining("Automatic conversion"),
    ]));
  });
});

describe("leave occurrence balance consumption", () => {
  it("does not create negative balances for non-balance leave", () => {
    expect(leaveOccurrenceBalanceMinutes({ requiresBalance: false, leaveTypeCode: "unpaid", isPublicHoliday: false, requestedMinutes: 720 })).toBe(0);
  });

  it("keeps annual public holidays paid and roster-relevant without consuming annual leave", () => {
    expect(leaveOccurrenceBalanceMinutes({ requiresBalance: true, leaveTypeCode: "annual", isPublicHoliday: true, requestedMinutes: 720 })).toBe(0);
  });

  it("consumes the requested duration for ordinary balance-controlled leave", () => {
    expect(leaveOccurrenceBalanceMinutes({ requiresBalance: true, leaveTypeCode: "annual", isPublicHoliday: false, requestedMinutes: 720 })).toBe(720);
  });
});
