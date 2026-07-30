import { describe, it, expect } from "vitest";
import {
  buildAccrualPlan,
  firstCycleSickEntitlementMinutes,
  type AccrualPlanInput,
} from "../leave-accrual-plan.js";
import type { LeaveCycleSpec } from "../leave-cycles.js";

const utc = (key: string) => new Date(`${key}T00:00:00.000Z`);
const DAY = 480;
const ANNUAL_ENTITLEMENT = 15 * DAY;

const annualSpec: LeaveCycleSpec = {
  leaveTypeCode: "annual",
  anchor: utc("2025-01-01"),
  cycleMonths: 12,
  graceMonths: 6,
};

const plan = (overrides: Partial<AccrualPlanInput> = {}) =>
  buildAccrualPlan({
    method: "EVEN_MONTHLY",
    spec: annualSpec,
    entitlementMinutes: ANNUAL_ENTITLEMENT,
    minutesPerShift: DAY,
    employedFrom: utc("2025-01-01"),
    asOf: utc("2025-06-30"),
    postedPeriodKeys: new Set<string>(),
    ...overrides,
  });

const total = (entries: { minutes: number }[]) =>
  entries.reduce((sum, entry) => sum + entry.minutes, 0);

describe("catch-up behaviour", () => {
  it("back-fills every month since employment started", () => {
    // Six months, none previously posted: the old runner would have posted one.
    const entries = plan();
    expect(entries.map((e) => e.periodKey)).toEqual([
      "2025-01",
      "2025-02",
      "2025-03",
      "2025-04",
      "2025-05",
      "2025-06",
    ]);
  });

  it("skips months already in the ledger", () => {
    const entries = plan({
      postedPeriodKeys: new Set(["2025-01", "2025-02", "2025-03"]),
    });
    expect(entries.map((e) => e.periodKey)).toEqual(["2025-04", "2025-05", "2025-06"]);
  });

  it("is a no-op when everything is already posted", () => {
    const first = plan();
    const entries = plan({
      postedPeriodKeys: new Set(first.map((e) => e.periodKey)),
    });
    expect(entries).toEqual([]);
  });

  it("never dates an accrual in the future", () => {
    const entries = plan({ asOf: utc("2025-06-10") });
    const last = entries[entries.length - 1];
    expect(last.effectiveDate).toEqual(utc("2025-06-10"));
  });

  it("does not accrue before employment starts", () => {
    const entries = plan({ employedFrom: utc("2025-04-15") });
    expect(entries.map((e) => e.periodKey)).toEqual(["2025-04", "2025-05", "2025-06"]);
  });

  it("stops accruing after the last day of employment", () => {
    const entries = plan({ employedTo: utc("2025-03-20") });
    expect(entries.map((e) => e.periodKey)).toEqual(["2025-01", "2025-02", "2025-03"]);
  });

  it("suspends accrual for a month of unpaid leave", () => {
    const entries = plan({ suspendedMonths: new Set(["2025-03"]) });
    expect(entries.map((e) => e.periodKey)).not.toContain("2025-03");
    expect(entries).toHaveLength(5);
  });

  it("stamps every entry with the cycle that funds it", () => {
    const entries = plan();
    expect(new Set(entries.map((e) => e.cycleKey))).toEqual(
      new Set(["annual:0:2025-01-01"])
    );
  });
});

describe("EVEN_MONTHLY", () => {
  it("spreads the cycle entitlement evenly", () => {
    const entries = plan();
    expect(entries[0].minutes).toBe(Math.round(ANNUAL_ENTITLEMENT / 12));
    expect(total(entries)).toBe(6 * Math.round(ANNUAL_ENTITLEMENT / 12));
  });
});

describe("MONTHLY_FIXED", () => {
  it("posts the configured flat rate each month", () => {
    const entries = plan({ method: "MONTHLY_FIXED", accrualRateMinutes: 600 });
    expect(entries).toHaveLength(6);
    expect(total(entries)).toBe(6 * 600);
  });

  it("posts nothing without a rate", () => {
    expect(plan({ method: "MONTHLY_FIXED", accrualRateMinutes: null })).toEqual([]);
  });
});

describe("ANNUAL_GRANT", () => {
  it("grants the whole entitlement once per cycle", () => {
    const entries = plan({ method: "ANNUAL_GRANT", asOf: utc("2026-06-30") });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      periodKey: "cycle-0-2025-01-01",
      minutes: ANNUAL_ENTITLEMENT,
    });
    expect(entries[1].periodKey).toBe("cycle-1-2026-01-01");
  });

  it("keeps the period key format earlier runs already wrote", () => {
    const entries = plan({
      method: "ANNUAL_GRANT",
      postedPeriodKeys: new Set(["cycle-0-2025-01-01"]),
    });
    expect(entries).toEqual([]);
  });
});

describe("PRORATED_CYCLE_GRANT", () => {
  const prorata = (overrides: Partial<AccrualPlanInput> = {}) =>
    plan({ method: "PRORATED_CYCLE_GRANT", ...overrides });

  it("accrues towards the entitlement month by month", () => {
    const entries = prorata();
    // Half a year employed earns roughly half the annual entitlement.
    expect(total(entries)).toBeGreaterThan(ANNUAL_ENTITLEMENT * 0.45);
    expect(total(entries)).toBeLessThan(ANNUAL_ENTITLEMENT * 0.55);
  });

  it("reaches exactly the full entitlement at the end of the cycle", () => {
    const entries = prorata({ asOf: utc("2025-12-31") });
    expect(total(entries)).toBe(ANNUAL_ENTITLEMENT);
  });

  it("pro-rates a mid-cycle joiner rather than granting a full year", () => {
    // Joined 1 July, so roughly half a cycle is earned by year end.
    const entries = prorata({
      employedFrom: utc("2025-07-01"),
      asOf: utc("2025-12-31"),
    });
    expect(total(entries)).toBeLessThan(ANNUAL_ENTITLEMENT * 0.55);
    expect(total(entries)).toBeGreaterThan(ANNUAL_ENTITLEMENT * 0.45);
  });

  it("stops earning on a leaver's last day", () => {
    const entries = prorata({
      employedTo: utc("2025-03-31"),
      asOf: utc("2025-12-31"),
    });
    expect(total(entries)).toBeLessThan(ANNUAL_ENTITLEMENT * 0.3);
  });

  it("lands on the same total whether run monthly or once at the end", () => {
    const monthly = prorata({ asOf: utc("2025-12-31") });
    const catchUp = prorata({
      asOf: utc("2025-12-31"),
      postedPeriodKeys: new Set(monthly.slice(0, 6).map((e) => e.periodKey)),
      postedMinutesByCycleKey: new Map([
        ["annual:0:2025-01-01", total(monthly.slice(0, 6))],
      ]),
    });
    expect(total(monthly.slice(0, 6)) + total(catchUp)).toBe(ANNUAL_ENTITLEMENT);
  });

  it("does not re-grant minutes already accrued for the cycle", () => {
    const entries = prorata({
      asOf: utc("2025-12-31"),
      postedMinutesByCycleKey: new Map([
        ["annual:0:2025-01-01", ANNUAL_ENTITLEMENT],
      ]),
    });
    expect(entries).toEqual([]);
  });

  it("starts a fresh entitlement in the next cycle", () => {
    const entries = prorata({ asOf: utc("2026-12-31") });
    const byCycle = new Map<string, number>();
    for (const entry of entries) {
      byCycle.set(entry.cycleKey, (byCycle.get(entry.cycleKey) ?? 0) + entry.minutes);
    }
    expect(byCycle.get("annual:0:2025-01-01")).toBe(ANNUAL_ENTITLEMENT);
    expect(byCycle.get("annual:1:2026-01-01")).toBe(ANNUAL_ENTITLEMENT);
  });
});

describe("DAYS_WORKED_RATIO", () => {
  const ratio = (overrides: Partial<AccrualPlanInput> = {}) =>
    plan({
      method: "DAYS_WORKED_RATIO",
      accrualRatioDays: 17,
      daysWorkedByMonth: new Map([
        ["2025-01", 21],
        ["2025-02", 20],
      ]),
      asOf: utc("2025-02-28"),
      ...overrides,
    });

  it("grants one day for every 17 days worked", () => {
    const entries = ratio();
    // 21 days worked earns 1 day; 41 cumulative earns 2.
    expect(entries[0].minutes).toBe(DAY);
    expect(total(entries)).toBe(2 * DAY);
  });

  it("carries leftover days into the next month", () => {
    // 10 + 10 days is 20 cumulative, which crosses 17 in the second month.
    const entries = ratio({
      daysWorkedByMonth: new Map([
        ["2025-01", 10],
        ["2025-02", 10],
      ]),
    });
    expect(total(entries)).toBe(DAY);
    expect(entries).toHaveLength(1);
    expect(entries[0].periodKey).toContain("2025-02");
  });

  it("uses the s22(2) ratio of 26 days for sick leave", () => {
    const entries = ratio({
      accrualRatioDays: 26,
      daysWorkedByMonth: new Map([
        ["2025-01", 21],
        ["2025-02", 20],
      ]),
    });
    // 41 cumulative days worked earns one day at the 26-day ratio.
    expect(total(entries)).toBe(DAY);
  });

  it("caps the cycle at the entitlement", () => {
    const entries = ratio({
      entitlementMinutes: DAY,
      daysWorkedByMonth: new Map([
        ["2025-01", 21],
        ["2025-02", 20],
      ]),
    });
    expect(total(entries)).toBe(DAY);
  });

  it("posts nothing without a ratio", () => {
    expect(ratio({ accrualRatioDays: null })).toEqual([]);
  });

  it("posts nothing when no days were worked", () => {
    expect(ratio({ daysWorkedByMonth: new Map() })).toEqual([]);
  });
});

describe("unsupported input", () => {
  it("returns nothing for an unknown method", () => {
    expect(plan({ method: "POLICY_CONFIRMATION_REQUIRED" })).toEqual([]);
  });

  it("returns nothing when employment ended before it began", () => {
    expect(plan({ employedFrom: utc("2025-06-01"), employedTo: utc("2025-01-01") })).toEqual([]);
  });
});

describe("firstCycleSickEntitlementMinutes — BCEA s22(4)", () => {
  it("reduces the first cycle by sick days taken in the first six months", () => {
    expect(
      firstCycleSickEntitlementMinutes({
        fullCycleEntitlementMinutes: 30 * DAY,
        minutesTakenInFirstSixMonths: 4 * DAY,
      })
    ).toBe(26 * DAY);
  });

  it("never goes below zero", () => {
    expect(
      firstCycleSickEntitlementMinutes({
        fullCycleEntitlementMinutes: 30 * DAY,
        minutesTakenInFirstSixMonths: 40 * DAY,
      })
    ).toBe(0);
  });

  it("leaves the entitlement untouched when nothing was taken", () => {
    expect(
      firstCycleSickEntitlementMinutes({
        fullCycleEntitlementMinutes: 30 * DAY,
        minutesTakenInFirstSixMonths: 0,
      })
    ).toBe(30 * DAY);
  });
});
