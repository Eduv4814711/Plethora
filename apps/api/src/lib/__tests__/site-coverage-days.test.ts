import { describe, it, expect } from "vitest";
import {
  countCoveredDays,
  daysWithAnyCoverage,
  describeCoverageDays,
  isShiftCoveredOn,
  normalizeCoverageDays,
  resolveSiteCoverageDays,
} from "../site-coverage-days.js";

/** 2026-06-01 is a Monday, so the week runs Mon…Sun across indices 0…6. */
const MONDAY = new Date("2026-06-01T00:00:00.000Z");
const week = Array.from(
  { length: 7 },
  (_, i) => new Date(MONDAY.getTime() + i * 24 * 60 * 60 * 1000)
);

describe("normalizeCoverageDays", () => {
  it("sorts and dedupes", () => {
    expect(normalizeCoverageDays([5, 1, 1, 3])).toEqual([1, 3, 5]);
  });

  it("drops out-of-range and non-integer values rather than clamping them", () => {
    expect(normalizeCoverageDays([-1, 7, 2.5, "3", 4])).toEqual([3, 4]);
  });

  it("returns empty for non-arrays", () => {
    expect(normalizeCoverageDays(null)).toEqual([]);
    expect(normalizeCoverageDays(undefined)).toEqual([]);
  });
});

describe("resolveSiteCoverageDays", () => {
  it("treats an unset column as full seven-day cover", () => {
    const coverage = resolveSiteCoverageDays({});
    expect(coverage.day.size).toBe(7);
    expect(coverage.night.size).toBe(7);
  });

  it("preserves an explicitly empty list as no cover", () => {
    const coverage = resolveSiteCoverageDays({ rosterNightShiftDays: [] });
    expect(coverage.night.size).toBe(0);
    expect(coverage.day.size).toBe(7);
  });

  it("keeps day and night independent", () => {
    const coverage = resolveSiteCoverageDays({
      rosterDayShiftDays: [1, 2, 3, 4, 5],
      rosterNightShiftDays: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(isShiftCoveredOn(coverage, "day", MONDAY)).toBe(true);
    // Saturday
    expect(isShiftCoveredOn(coverage, "day", week[5]!)).toBe(false);
    expect(isShiftCoveredOn(coverage, "night", week[5]!)).toBe(true);
  });
});

describe("countCoveredDays / daysWithAnyCoverage", () => {
  const coverage = resolveSiteCoverageDays({
    rosterDayShiftDays: [1, 2, 3, 4, 5],
    rosterNightShiftDays: [1, 2, 3, 4, 5, 6],
  });

  it("counts only covered weekdays", () => {
    expect(countCoveredDays(coverage, "day", week)).toBe(5);
    expect(countCoveredDays(coverage, "night", week)).toBe(6);
  });

  it("unions both shift types", () => {
    // Sunday is covered by neither.
    expect(daysWithAnyCoverage(coverage, week)).toHaveLength(6);
  });
});

describe("describeCoverageDays", () => {
  it("names the common cases", () => {
    expect(describeCoverageDays([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(describeCoverageDays([])).toBe("No days");
    expect(describeCoverageDays([1, 2, 3, 4, 5])).toBe("Mon–Fri");
  });

  it("lists short and broken runs individually", () => {
    expect(describeCoverageDays([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(describeCoverageDays([1, 2])).toBe("Mon, Tue");
    expect(describeCoverageDays([1, 2, 3, 6])).toBe("Mon–Wed, Sat");
  });

  it("reads the week Monday-first, so Sunday trails", () => {
    expect(describeCoverageDays([0, 6])).toBe("Sat, Sun");
  });
});
