import { describe, it, expect } from "vitest";
import {
  ANNUAL_DAYS_WORKED_RATIO,
  BIRTH_PARENT_RESERVED_DAYS,
  completedMonthsOfService,
  daysWorkedRatioMinutes,
  effectiveEntitlementMinutes,
  familyResponsibilityFindings,
  initialSickEntitlementMinutes,
  isWithinInitialSickPeriod,
  PARENTAL_POOL_CALENDAR_DAYS,
  SICK_DAYS_WORKED_RATIO,
  sickProofRequired,
  statutoryEntitlementMinutes,
  statutoryPolicyDefaults,
  STATUTORY_LEAVE_RULES,
  type EmployeeLeaveContext,
} from "../leave-statutory-rules.js";

const utc = (key: string) => new Date(`${key}T00:00:00.000Z`);
const HOURS = 60;

/** A Monday-to-Friday, eight-hour-a-day employee with two years' service. */
const fiveDayWeek = (overrides: Partial<EmployeeLeaveContext> = {}): EmployeeLeaveContext => ({
  normalDaysPerWeek: 5,
  normalMinutesPerShift: 480,
  employedFrom: utc("2023-01-01"),
  asOf: utc("2025-01-01"),
  ...overrides,
});

describe("annual leave — BCEA s20", () => {
  it("gives a five-day week 15 working days per cycle", () => {
    const minutes = statutoryEntitlementMinutes("annual", fiveDayWeek());
    expect(minutes).toBe(15 * 8 * HOURS);
  });

  it("gives a six-day week 18 working days, being the same three weeks off", () => {
    const minutes = statutoryEntitlementMinutes(
      "annual",
      fiveDayWeek({ normalDaysPerWeek: 6 })
    );
    expect(minutes).toBe(18 * 8 * HOURS);
  });

  it("scales with a shorter working day rather than assuming eight hours", () => {
    const minutes = statutoryEntitlementMinutes(
      "annual",
      fiveDayWeek({ normalMinutesPerShift: 360 })
    );
    expect(minutes).toBe(15 * 6 * HOURS);
  });

  it("pro-rates a four-day part-time week to 12 days", () => {
    const minutes = statutoryEntitlementMinutes(
      "annual",
      fiveDayWeek({ normalDaysPerWeek: 4 })
    );
    expect(minutes).toBe(12 * 8 * HOURS);
  });

  it("uses a 12-month cycle with the s20(4) six-month grace period", () => {
    expect(STATUTORY_LEAVE_RULES.annual.cycleMonths).toBe(12);
    expect(STATUTORY_LEAVE_RULES.annual.graceMonths).toBe(6);
  });

  it("forfeits the remainder at the end of the grace period, not the cycle", () => {
    // The 18-month window from Jooste v Kohler Packaging: the balance stays
    // usable for six months past the cycle end, then goes.
    expect(STATUTORY_LEAVE_RULES.annual.carryOverLimitMinutes).toBe(0);
  });

  it("falls back to a standard week when the pattern is missing or nonsensical", () => {
    expect(
      statutoryEntitlementMinutes("annual", fiveDayWeek({ normalDaysPerWeek: 0 }))
    ).toBe(15 * 8 * HOURS);
    expect(
      statutoryEntitlementMinutes(
        "annual",
        fiveDayWeek({ normalMinutesPerShift: -1 })
      )
    ).toBe(15 * 8 * HOURS);
  });

  it("never inflates entitlement beyond a seven-day week", () => {
    expect(
      statutoryEntitlementMinutes("annual", fiveDayWeek({ normalDaysPerWeek: 30 }))
    ).toBe(21 * 8 * HOURS);
  });
});

describe("sick leave — BCEA s22", () => {
  it("gives a five-day week 30 days per 36-month cycle", () => {
    const minutes = statutoryEntitlementMinutes("sick", fiveDayWeek());
    expect(minutes).toBe(30 * 8 * HOURS);
  });

  it("gives a six-day week 36 days, being six weeks of ordinary work", () => {
    const minutes = statutoryEntitlementMinutes(
      "sick",
      fiveDayWeek({ normalDaysPerWeek: 6 })
    );
    expect(minutes).toBe(36 * 8 * HOURS);
  });

  it("runs on a 36-month cycle that does not carry over", () => {
    expect(STATUTORY_LEAVE_RULES.sick.cycleMonths).toBe(36);
    expect(STATUTORY_LEAVE_RULES.sick.carryOverLimitMinutes).toBe(0);
    expect(STATUTORY_LEAVE_RULES.sick.graceMonths).toBe(0);
  });

  describe("first six months — s22(2)", () => {
    const newStarter = (daysWorked: number) =>
      fiveDayWeek({
        employedFrom: utc("2025-01-01"),
        asOf: utc("2025-04-01"),
        daysWorked,
      });

    it("applies while service is under six months", () => {
      expect(isWithinInitialSickPeriod(newStarter(60))).toBe(true);
    });

    it("stops applying once six months are complete", () => {
      expect(
        isWithinInitialSickPeriod(
          fiveDayWeek({ employedFrom: utc("2025-01-01"), asOf: utc("2025-07-01") })
        )
      ).toBe(false);
    });

    it("grants one day for every 26 days worked", () => {
      expect(statutoryEntitlementMinutes("sick", newStarter(26))).toBe(1 * 8 * HOURS);
      expect(statutoryEntitlementMinutes("sick", newStarter(78))).toBe(3 * 8 * HOURS);
    });

    it("does not grant a partial day before the 26th day is worked", () => {
      expect(statutoryEntitlementMinutes("sick", newStarter(25))).toBe(0);
    });

    it("never exceeds the full cycle entitlement", () => {
      expect(initialSickEntitlementMinutes(newStarter(100_000))).toBe(30 * 8 * HOURS);
    });

    it("treats an unknown days-worked count as nothing earned", () => {
      expect(
        initialSickEntitlementMinutes(
          fiveDayWeek({ employedFrom: utc("2025-01-01"), asOf: utc("2025-02-01") })
        )
      ).toBe(0);
    });
  });
});

describe("family responsibility leave — BCEA s27", () => {
  it("gives three days per 12-month cycle", () => {
    expect(statutoryEntitlementMinutes("family_responsibility", fiveDayWeek())).toBe(
      3 * 8 * HOURS
    );
  });

  it("accepts an employee with over four months' service on a five-day week", () => {
    expect(familyResponsibilityFindings(fiveDayWeek())).toEqual([]);
  });

  it("blocks an employee with under four months' service", () => {
    const findings = familyResponsibilityFindings(
      fiveDayWeek({ employedFrom: utc("2025-01-01"), asOf: utc("2025-03-01") })
    );
    expect(findings.map((f) => f.code)).toContain("BCEA_S27_SERVICE");
    expect(findings[0].severity).toBe("block");
  });

  it("blocks an employee who works fewer than four days a week", () => {
    const findings = familyResponsibilityFindings(
      fiveDayWeek({ normalDaysPerWeek: 3 })
    );
    expect(findings.map((f) => f.code)).toContain("BCEA_S27_DAYS_PER_WEEK");
  });

  it("reports both failures at once", () => {
    const findings = familyResponsibilityFindings(
      fiveDayWeek({
        employedFrom: utc("2025-01-01"),
        asOf: utc("2025-02-01"),
        normalDaysPerWeek: 2,
      })
    );
    expect(findings).toHaveLength(2);
  });
});

describe("proof of incapacity — BCEA s23", () => {
  it("does not require a certificate for a one- or two-day absence", () => {
    expect(
      sickProofRequired({ consecutiveWorkingDays: 1, priorOccasionsInWindow: 0 }).required
    ).toBe(false);
    expect(
      sickProofRequired({ consecutiveWorkingDays: 2, priorOccasionsInWindow: 0 }).required
    ).toBe(false);
  });

  it("requires a certificate beyond two consecutive working days", () => {
    const result = sickProofRequired({
      consecutiveWorkingDays: 3,
      priorOccasionsInWindow: 0,
    });
    expect(result.required).toBe(true);
    expect(result.reason).toMatch(/consecutive working days/);
  });

  it("requires a certificate on the third occasion inside eight weeks", () => {
    expect(
      sickProofRequired({ consecutiveWorkingDays: 1, priorOccasionsInWindow: 1 }).required
    ).toBe(false);
    const result = sickProofRequired({
      consecutiveWorkingDays: 1,
      priorOccasionsInWindow: 2,
    });
    expect(result.required).toBe(true);
    expect(result.reason).toMatch(/occasions/);
  });
});

describe("parental leave — Van Wyk", () => {
  it("pools four months and ten days across both parents", () => {
    expect(PARENTAL_POOL_CALENDAR_DAYS).toBe(132);
  });

  it("reserves six weeks after birth to the person who gave birth", () => {
    expect(BIRTH_PARENT_RESERVED_DAYS).toBe(42);
  });
});

describe("effectiveEntitlementMinutes", () => {
  it("keeps a more generous company policy", () => {
    expect(
      effectiveEntitlementMinutes({
        leaveTypeCode: "annual",
        configuredMinutes: 21 * 8 * HOURS,
        ctx: fiveDayWeek(),
      })
    ).toBe(21 * 8 * HOURS);
  });

  it("raises a policy that falls below the statutory floor", () => {
    // A company cannot contract out of BCEA s20 by configuring 10 days.
    expect(
      effectiveEntitlementMinutes({
        leaveTypeCode: "annual",
        configuredMinutes: 10 * 8 * HOURS,
        ctx: fiveDayWeek(),
      })
    ).toBe(15 * 8 * HOURS);
  });

  it("uses the configured value for leave types the BCEA does not regulate", () => {
    expect(
      effectiveEntitlementMinutes({
        leaveTypeCode: "study",
        configuredMinutes: 5 * 8 * HOURS,
        ctx: fiveDayWeek(),
      })
    ).toBe(5 * 8 * HOURS);
  });

  it("is zero when neither a policy nor a statute grants anything", () => {
    expect(
      effectiveEntitlementMinutes({
        leaveTypeCode: "study",
        configuredMinutes: null,
        ctx: fiveDayWeek(),
      })
    ).toBe(0);
  });
});

describe("daysWorkedRatioMinutes", () => {
  it("implements the s20(2)(b) one-day-per-17-days-worked alternative", () => {
    expect(
      daysWorkedRatioMinutes({
        daysWorked: 34,
        ratioDays: ANNUAL_DAYS_WORKED_RATIO,
        minutesPerShift: 480,
      })
    ).toBe(2 * 8 * HOURS);
  });

  it("implements the s22(2) one-day-per-26-days-worked rule", () => {
    expect(
      daysWorkedRatioMinutes({
        daysWorked: 52,
        ratioDays: SICK_DAYS_WORKED_RATIO,
        minutesPerShift: 480,
      })
    ).toBe(2 * 8 * HOURS);
  });

  it("only grants whole days", () => {
    expect(
      daysWorkedRatioMinutes({ daysWorked: 16, ratioDays: 17, minutesPerShift: 480 })
    ).toBe(0);
  });

  it("is zero for a negative or absent days-worked count", () => {
    expect(
      daysWorkedRatioMinutes({ daysWorked: -5, ratioDays: 17, minutesPerShift: 480 })
    ).toBe(0);
  });
});

describe("completedMonthsOfService", () => {
  it("counts a month only once the anniversary day is reached", () => {
    expect(
      completedMonthsOfService(
        fiveDayWeek({ employedFrom: utc("2025-01-15"), asOf: utc("2025-02-14") })
      )
    ).toBe(0);
    expect(
      completedMonthsOfService(
        fiveDayWeek({ employedFrom: utc("2025-01-15"), asOf: utc("2025-02-15") })
      )
    ).toBe(1);
  });

  it("is zero before employment starts", () => {
    expect(
      completedMonthsOfService(
        fiveDayWeek({ employedFrom: utc("2025-06-01"), asOf: utc("2025-01-01") })
      )
    ).toBe(0);
  });
});

describe("statutoryPolicyDefaults", () => {
  it("seeds annual leave at 15 days for the standard week", () => {
    const defaults = statutoryPolicyDefaults("annual");
    expect(defaults).toMatchObject({
      cycleMonths: 12,
      graceMonths: 6,
      entitlementMinutes: 15 * 8 * HOURS,
      reference: "BCEA s20",
    });
  });

  it("seeds sick leave at 30 days over 36 months with no carry-over", () => {
    expect(statutoryPolicyDefaults("sick")).toMatchObject({
      cycleMonths: 36,
      entitlementMinutes: 30 * 8 * HOURS,
      carryOverLimitMinutes: 0,
    });
  });

  it("seeds family responsibility leave at three days", () => {
    expect(statutoryPolicyDefaults("family_responsibility")).toMatchObject({
      cycleMonths: 12,
      entitlementMinutes: 3 * 8 * HOURS,
    });
  });

  it("returns nothing for leave types the BCEA does not regulate", () => {
    expect(statutoryPolicyDefaults("study")).toBeNull();
    expect(statutoryPolicyDefaults("unpaid")).toBeNull();
    expect(statutoryPolicyDefaults("injury_on_duty")).toBeNull();
  });
});
