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
