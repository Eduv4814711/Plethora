import { describe, expect, it } from "vitest";
import { addDays, format, parseISO } from "date-fns";
import { dateKey, dateOnly } from "../rosters.service.js";

/** Mirror of rosters.service patternDayForDate for unit testing without DB. */
function patternDayForDate(anchor: Date, cycleLength: number, target: Date): number {
  const diff = Math.floor((target.getTime() - anchor.getTime()) / 86400000);
  const mod = ((diff % cycleLength) + cycleLength) % cycleLength;
  return mod;
}

describe("roster pattern day mapping", () => {
  it("maps anchor date to pattern day 0", () => {
    const anchor = parseISO("2026-01-26");
    expect(patternDayForDate(anchor, 9, anchor)).toBe(0);
  });

  it("wraps across cycle boundary", () => {
    const anchor = parseISO("2026-01-26");
    const day10 = addDays(anchor, 9);
    expect(patternDayForDate(anchor, 9, day10)).toBe(0);
    expect(patternDayForDate(anchor, 9, addDays(anchor, 10))).toBe(1);
  });

  it("handles dates before anchor with positive modulo", () => {
    const anchor = parseISO("2026-01-26");
    const before = addDays(anchor, -1);
    expect(patternDayForDate(anchor, 9, before)).toBe(8);
  });

  it("produces stable indices across a month view", () => {
    const anchor = parseISO("2026-01-26");
    const start = parseISO("2026-02-26");
    const end = parseISO("2026-03-25");
    const seen = new Set<number>();
    for (let d = start; d <= end; d = addDays(d, 1)) {
      seen.add(patternDayForDate(anchor, 9, d));
    }
    expect(seen.size).toBe(9);
  });
});

describe("staggered pattern apply", () => {
  function patternDayIndexForDate(anchor: string, date: string, cycleLength: number): number {
    const diff = Math.floor(
      (parseISO(date.slice(0, 10)).getTime() - parseISO(anchor.slice(0, 10)).getTime()) / 86400000
    );
    return ((diff % cycleLength) + cycleLength) % cycleLength;
  }

  function shiftCodeForStaggeredPattern(
    anchorDate: string,
    rosterDate: string,
    cycleCodes: string[],
    guardIndex: number,
    guardCount: number
  ): string {
    if (cycleCodes.length === 0) return "blank";
    if (guardCount <= 0) {
      return cycleCodes[patternDayIndexForDate(anchorDate, rosterDate, cycleCodes.length)]!;
    }
    const cycleLength = cycleCodes.length;
    const patternDay = patternDayIndexForDate(anchorDate, rosterDate, cycleLength);
    const staggerOffset = Math.floor((guardIndex * cycleLength) / guardCount);
    return cycleCodes[(patternDay + staggerOffset) % cycleLength]!;
  }

  it("spreads 3D3N3O across 15 guards on the same calendar day", () => {
    const cycle = ["D", "D", "D", "N", "N", "N", "O", "O", "O"];
    const counts = { D: 0, N: 0, O: 0 };
    for (let i = 0; i < 15; i++) {
      const code = shiftCodeForStaggeredPattern("2026-06-26", "2026-06-26", cycle, i, 15);
      counts[code as keyof typeof counts]++;
    }
    expect(counts).toEqual({ D: 5, N: 5, O: 5 });
  });

  it("without stagger all guards share the same shift on a day", () => {
    const cycle = ["D", "D", "D", "N", "N", "N", "O", "O", "O"];
    const idx = patternDayIndexForDate("2026-06-26", "2026-06-26", cycle.length);
    const codes = Array.from({ length: 15 }, () => cycle[idx]);
    expect(new Set(codes)).toEqual(new Set(["D"]));
  });

  it("returns blank when cycle is empty", () => {
    expect(
      shiftCodeForStaggeredPattern("2026-06-26", "2026-06-26", [], 0, 5)
    ).toBe("blank");
  });
});

describe("roster date persistence", () => {
  it("keeps date-only roster values on the requested calendar date", () => {
    const savedDate = dateOnly("2026-06-27");

    expect(savedDate.toISOString()).toBe("2026-06-27T00:00:00.000Z");
    expect(dateKey(savedDate)).toBe("2026-06-27");
  });

  it("formats database DATE values without applying local timezone offsets", () => {
    expect(dateKey(new Date("2026-06-27T00:00:00.000Z"))).toBe("2026-06-27");
  });
});

describe("generate skip logic", () => {
  it("should only skip blank cells, not off days", () => {
    const countsTowardCoverage = (t: string) => t === "day" || t === "night";
    const shiftCodeToType = (code: string) =>
      code === "D" ? "day" : code === "N" ? "night" : code === "O" ? "off" : "unassigned";

    const shouldSkip = (code: string) =>
      !countsTowardCoverage(shiftCodeToType(code)) && code === "blank";

    expect(shouldSkip("blank")).toBe(true);
    expect(shouldSkip("O")).toBe(false);
    expect(shouldSkip("D")).toBe(false);
    expect(shouldSkip("L")).toBe(false);
  });
});
