import { describe, it, expect } from "vitest";
import {
  addUtcMonths,
  buildLeaveCycle,
  closableLeaveCycles,
  cycleEmploymentFraction,
  enumerateLeaveCycles,
  leaveCycleIndexAt,
  LeaveCycleError,
  resolveLeaveCycle,
  type LeaveCycleSpec,
} from "../leave-cycles.js";

const utc = (key: string) => new Date(`${key}T00:00:00.000Z`);
const key = (date: Date) => date.toISOString().slice(0, 10);

/** Annual leave: BCEA s20 12-month cycle with the s20(4) six-month grace. */
const annual: LeaveCycleSpec = {
  leaveTypeCode: "annual",
  anchor: utc("2024-03-01"),
  cycleMonths: 12,
  graceMonths: 6,
};

/** Sick leave: BCEA s22 36-month cycle, no grace period. */
const sick: LeaveCycleSpec = {
  leaveTypeCode: "sick",
  anchor: utc("2024-03-01"),
  cycleMonths: 36,
};

describe("addUtcMonths", () => {
  it("clamps to the last day of a shorter target month", () => {
    expect(key(addUtcMonths(utc("2024-01-31"), 1))).toBe("2024-02-29");
    expect(key(addUtcMonths(utc("2025-01-31"), 1))).toBe("2025-02-28");
    expect(key(addUtcMonths(utc("2024-03-31"), 1))).toBe("2024-04-30");
  });

  it("does not drift when a clamped date is advanced again", () => {
    // 29 Feb + 12 months is 28 Feb, not 1 March.
    expect(key(addUtcMonths(utc("2024-02-29"), 12))).toBe("2025-02-28");
  });

  it("handles year boundaries in both directions", () => {
    expect(key(addUtcMonths(utc("2024-12-15"), 1))).toBe("2025-01-15");
    expect(key(addUtcMonths(utc("2024-01-15"), -1))).toBe("2023-12-15");
  });
});

describe("buildLeaveCycle", () => {
  it("tiles consecutive cycles with no gap and no overlap", () => {
    const first = buildLeaveCycle(annual, 0);
    const second = buildLeaveCycle(annual, 1);
    expect(key(first.start)).toBe("2024-03-01");
    expect(key(first.end)).toBe("2025-02-28");
    expect(key(second.start)).toBe("2025-03-01");
    expect(second.start.getTime() - first.end.getTime()).toBe(86_400_000);
  });

  it("applies the BCEA s20(4) six-month grace period", () => {
    const first = buildLeaveCycle(annual, 0);
    // 12 months of accrual plus 6 months to use it: the 18-month window.
    expect(key(first.graceEnd)).toBe("2025-08-28");
  });

  it("gives sick leave a 36-month cycle that ends on its own boundary", () => {
    const first = buildLeaveCycle(sick, 0);
    expect(key(first.start)).toBe("2024-03-01");
    expect(key(first.end)).toBe("2027-02-28");
    expect(key(first.graceEnd)).toBe(key(first.end));
  });

  it("builds a stable, namespaced cycle key", () => {
    expect(buildLeaveCycle(annual, 1).cycleKey).toBe("annual:1:2025-03-01");
    expect(buildLeaveCycle(sick, 0).cycleKey).toBe("sick:0:2024-03-01");
  });

  it("survives a 29 February anchor", () => {
    const leapAnchor: LeaveCycleSpec = {
      leaveTypeCode: "annual",
      anchor: utc("2024-02-29"),
      cycleMonths: 12,
    };
    expect(key(buildLeaveCycle(leapAnchor, 0).end)).toBe("2025-02-27");
    expect(key(buildLeaveCycle(leapAnchor, 1).start)).toBe("2025-02-28");
  });

  it("clamps a negative index to the first cycle", () => {
    expect(buildLeaveCycle(annual, -3).cycleIndex).toBe(0);
  });

  it("rejects a non-positive cycle length", () => {
    expect(() =>
      buildLeaveCycle({ ...annual, cycleMonths: 0 }, 0)
    ).toThrow(LeaveCycleError);
    expect(() =>
      buildLeaveCycle({ ...annual, graceMonths: -1 }, 0)
    ).toThrow(LeaveCycleError);
  });
});

describe("leaveCycleIndexAt", () => {
  it("counts a cycle as complete only on the anniversary day", () => {
    expect(leaveCycleIndexAt(annual, utc("2025-02-28"))).toBe(0);
    expect(leaveCycleIndexAt(annual, utc("2025-03-01"))).toBe(1);
  });

  it("clamps dates before the anchor to the first cycle", () => {
    expect(leaveCycleIndexAt(annual, utc("2020-01-01"))).toBe(0);
  });

  it("strides in 36-month steps for sick leave", () => {
    expect(leaveCycleIndexAt(sick, utc("2027-02-28"))).toBe(0);
    expect(leaveCycleIndexAt(sick, utc("2027-03-01"))).toBe(1);
    expect(leaveCycleIndexAt(sick, utc("2030-03-01"))).toBe(2);
  });

  it("handles a mid-month commencement", () => {
    const midMonth: LeaveCycleSpec = {
      leaveTypeCode: "annual",
      anchor: utc("2024-07-17"),
      cycleMonths: 12,
    };
    expect(leaveCycleIndexAt(midMonth, utc("2025-07-16"))).toBe(0);
    expect(leaveCycleIndexAt(midMonth, utc("2025-07-17"))).toBe(1);
  });
});

describe("resolveLeaveCycle", () => {
  it("returns the cycle containing the date", () => {
    const cycle = resolveLeaveCycle(annual, utc("2025-06-10"));
    expect(cycle.cycleIndex).toBe(1);
    expect(key(cycle.start)).toBe("2025-03-01");
    expect(key(cycle.end)).toBe("2026-02-28");
  });
});

describe("enumerateLeaveCycles", () => {
  it("returns every overlapping cycle, oldest first", () => {
    const cycles = enumerateLeaveCycles(
      annual,
      utc("2024-06-01"),
      utc("2026-06-01")
    );
    expect(cycles.map((c) => c.cycleIndex)).toEqual([0, 1, 2]);
  });

  it("returns a single cycle when the range sits inside one", () => {
    const cycles = enumerateLeaveCycles(
      annual,
      utc("2024-04-01"),
      utc("2024-05-01")
    );
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycleIndex).toBe(0);
  });

  it("returns nothing for an inverted range", () => {
    expect(
      enumerateLeaveCycles(annual, utc("2025-01-01"), utc("2024-01-01"))
    ).toEqual([]);
  });
});

describe("closableLeaveCycles", () => {
  it("does not close a cycle whose grace period is still running", () => {
    // Cycle 0 ends 2025-02-28 and its grace runs to 2025-08-28.
    expect(closableLeaveCycles(annual, utc("2025-08-28"))).toEqual([]);
  });

  it("closes a cycle the day after its grace period lapses", () => {
    const closable = closableLeaveCycles(annual, utc("2025-08-29"));
    expect(closable.map((c) => c.cycleIndex)).toEqual([0]);
  });

  it("never closes the current cycle", () => {
    const closable = closableLeaveCycles(annual, utc("2026-01-01"));
    expect(closable.every((c) => c.cycleIndex < 1)).toBe(true);
  });

  it("closes a sick cycle immediately at the boundary, with no grace", () => {
    expect(closableLeaveCycles(sick, utc("2027-02-28"))).toEqual([]);
    expect(closableLeaveCycles(sick, utc("2027-03-01")).map((c) => c.cycleIndex)).toEqual([0]);
  });
});

describe("cycleEmploymentFraction", () => {
  const cycle = buildLeaveCycle(annual, 0); // 2024-03-01 … 2025-02-28, 365 days

  it("is 1 for a full cycle of employment", () => {
    expect(
      cycleEmploymentFraction({ cycle, employedFrom: utc("2024-03-01") })
    ).toBe(1);
  });

  it("pro-rates a mid-cycle joiner", () => {
    // Employed 2024-09-01 … 2025-02-28 is 181 of 365 days.
    const fraction = cycleEmploymentFraction({
      cycle,
      employedFrom: utc("2024-09-01"),
    });
    expect(fraction).toBeCloseTo(181 / 365, 6);
  });

  it("pro-rates a mid-cycle leaver", () => {
    // Employed 2024-03-01 … 2024-08-31 is 184 of 365 days.
    const fraction = cycleEmploymentFraction({
      cycle,
      employedFrom: utc("2024-03-01"),
      employedTo: utc("2024-08-31"),
    });
    expect(fraction).toBeCloseTo(184 / 365, 6);
  });

  it("is 0 when employment does not overlap the cycle", () => {
    expect(
      cycleEmploymentFraction({
        cycle,
        employedFrom: utc("2025-06-01"),
      })
    ).toBe(0);
    expect(
      cycleEmploymentFraction({
        cycle,
        employedFrom: utc("2020-01-01"),
        employedTo: utc("2023-01-01"),
      })
    ).toBe(0);
  });

  it("clamps employment that extends beyond the cycle on both sides", () => {
    expect(
      cycleEmploymentFraction({
        cycle,
        employedFrom: utc("2020-01-01"),
        employedTo: utc("2030-01-01"),
      })
    ).toBe(1);
  });
});
