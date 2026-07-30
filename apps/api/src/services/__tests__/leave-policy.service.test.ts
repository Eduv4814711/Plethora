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

  it("accepts carry-over, expiry, notice and auto-conversion now that the engine executes them", () => {
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true, code: "annual" },
      accrualMethod: "EVEN_MONTHLY",
      entitlementMinutes: 7_200,
      cycleMonths: 12,
      carryOverLimitMinutes: 2_400,
      expiryMonths: 6,
      noticeDays: 7,
      autoConvertToUnpaid: true,
    })).toEqual([]);
  });

  it("rejects negative carry-over, expiry and notice values", () => {
    const issues = leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true },
      accrualMethod: "EVEN_MONTHLY",
      entitlementMinutes: 7_200,
      cycleMonths: 12,
      carryOverLimitMinutes: -1,
      expiryMonths: -1,
      noticeDays: -1,
    });
    expect(issues).toEqual(expect.arrayContaining([
      "The carry-over limit cannot be negative.",
      "The expiry period cannot be negative.",
      "Notice days cannot be negative.",
    ]));
  });

  it("requires a ratio for the s20(2)(b) days-worked accrual method", () => {
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true },
      accrualMethod: "DAYS_WORKED_RATIO",
      entitlementMinutes: 7_200,
      accrualRatioDays: 17,
      cycleMonths: 12,
    })).toEqual([]);
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true },
      accrualMethod: "DAYS_WORKED_RATIO",
      entitlementMinutes: 7_200,
      accrualRatioDays: null,
      cycleMonths: 12,
    })).toEqual(
      expect.arrayContaining([expect.stringContaining("earns one day of leave")])
    );
  });
});

describe("statutory floor", () => {
  it("accepts a policy that meets the BCEA s20 minimum", () => {
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true, code: "annual" },
      accrualMethod: "PRORATED_CYCLE_GRANT",
      entitlementMinutes: 15 * 480,
      cycleMonths: 12,
    })).toEqual([]);
  });

  it("refuses to confirm annual leave below 15 days a year", () => {
    // A company cannot contract out of BCEA s20 by configuring 10 days.
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true, code: "annual" },
      accrualMethod: "PRORATED_CYCLE_GRANT",
      entitlementMinutes: 10 * 480,
      cycleMonths: 12,
    })).toEqual(expect.arrayContaining([expect.stringContaining("BCEA s20")]));
  });

  it("accepts a more generous annual policy", () => {
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true, code: "annual" },
      accrualMethod: "PRORATED_CYCLE_GRANT",
      entitlementMinutes: 21 * 480,
      cycleMonths: 12,
    })).toEqual([]);
  });

  it("compares entitlement as a rate, so a shorter cycle cannot dilute it", () => {
    // 30 days per 36 months and 10 days per 12 months are the same rate.
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true, code: "sick" },
      accrualMethod: "PRORATED_CYCLE_GRANT",
      entitlementMinutes: 10 * 480,
      cycleMonths: 12,
    })).toEqual([]);
    // 10 days per 36 months is a third of the statutory rate.
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true, code: "sick" },
      accrualMethod: "PRORATED_CYCLE_GRANT",
      entitlementMinutes: 10 * 480,
      cycleMonths: 36,
    })).toEqual(expect.arrayContaining([expect.stringContaining("BCEA s22")]));
  });

  it("refuses an expiry earlier than the BCEA s20(4) six-month grace period", () => {
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true, code: "annual" },
      accrualMethod: "PRORATED_CYCLE_GRANT",
      entitlementMinutes: 15 * 480,
      cycleMonths: 12,
      expiryMonths: 3,
    })).toEqual(
      expect.arrayContaining([expect.stringContaining("6 months after the cycle ends")])
    );
  });

  it("leaves unregulated leave types to their configured policy", () => {
    expect(leavePolicyConfigurationIssues({
      leaveType: { requiresBalance: true, code: "study" },
      accrualMethod: "PRORATED_CYCLE_GRANT",
      entitlementMinutes: 480,
      cycleMonths: 12,
    })).toEqual([]);
  });
});

describe("leave occurrence balance consumption", () => {
  it("does not create negative balances for non-balance leave", () => {
    expect(leaveOccurrenceBalanceMinutes({ requiresBalance: false, leaveTypeCode: "unpaid", isPublicHoliday: false, requestedMinutes: 720 })).toBe(0);
  });

  it("keeps annual public holidays paid and roster-relevant without consuming annual leave", () => {
    expect(leaveOccurrenceBalanceMinutes({ requiresBalance: true, leaveTypeCode: "annual", isPublicHoliday: true, requestedMinutes: 720 })).toBe(0);
  });

  it("spares sick and family responsibility leave on a public holiday too", () => {
    // An employee cannot be "sick" on a day they were never due to work, so a
    // public holiday inside the period must not burn the balance either.
    expect(leaveOccurrenceBalanceMinutes({ requiresBalance: true, leaveTypeCode: "sick", isPublicHoliday: true, requestedMinutes: 720 })).toBe(0);
    expect(leaveOccurrenceBalanceMinutes({ requiresBalance: true, leaveTypeCode: "family_responsibility", isPublicHoliday: true, requestedMinutes: 720 })).toBe(0);
  });

  it("lets a leave type opt in to consuming balance on a public holiday", () => {
    expect(leaveOccurrenceBalanceMinutes({ requiresBalance: true, leaveTypeCode: "special", isPublicHoliday: true, requestedMinutes: 720, publicHolidayConsumesBalance: true })).toBe(720);
  });

  it("consumes the requested duration for ordinary balance-controlled leave", () => {
    expect(leaveOccurrenceBalanceMinutes({ requiresBalance: true, leaveTypeCode: "annual", isPublicHoliday: false, requestedMinutes: 720 })).toBe(720);
  });
});
