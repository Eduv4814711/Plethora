import { describe, it, expect } from "vitest";
import {
  coverageDaysOrAllWeek,
  dateKeysInRange,
  describeCoverageDays,
  isNoShiftDateKey,
  noShiftDateKeys,
  normalizeCoverageDays,
  resolveShiftCoverageDays,
  shiftCoverageOnDateKey,
  shiftRuns,
  toggleCoverageDay,
} from "../site-coverage-days";

describe("coverageDaysOrAllWeek", () => {
  it("treats an unset value as full seven-day cover", () => {
    expect(coverageDaysOrAllWeek(null)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(coverageDaysOrAllWeek(undefined)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("preserves an explicitly empty list as no cover", () => {
    expect(coverageDaysOrAllWeek([])).toEqual([]);
  });
});

describe("normalizeCoverageDays", () => {
  it("sorts, dedupes, and drops out-of-range values", () => {
    expect(normalizeCoverageDays([5, 1, 1, 7, -2, 3])).toEqual([1, 3, 5]);
  });
});

describe("toggleCoverageDay", () => {
  it("adds a missing day and keeps the list sorted", () => {
    expect(toggleCoverageDay([1, 3], 2)).toEqual([1, 2, 3]);
  });

  it("removes a present day", () => {
    expect(toggleCoverageDay([1, 2, 3], 2)).toEqual([1, 3]);
  });
});

describe("describeCoverageDays", () => {
  it("names the common cases", () => {
    expect(describeCoverageDays([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(describeCoverageDays([1, 2, 3, 4, 5])).toBe("Mon–Fri");
    expect(describeCoverageDays([])).toBe("No days");
    expect(describeCoverageDays([1, 3, 5])).toBe("Mon, Wed, Fri");
  });
});

describe("shiftRuns", () => {
  it("needs both guards and at least one day", () => {
    expect(shiftRuns(1, [1, 2, 3])).toBe(true);
    expect(shiftRuns(0, [1, 2, 3])).toBe(false);
    expect(shiftRuns(2, [])).toBe(false);
  });
});

// 2026-08-03 is a Monday, so this week runs Mon…Sun through 2026-08-09.
const WEEK_START = "2026-08-03";
const WEEK_END = "2026-08-09";
const MON_FRI = [1, 2, 3, 4, 5];

describe("resolveShiftCoverageDays", () => {
  it("keeps seven-day cover for a site that predates the picker", () => {
    expect(resolveShiftCoverageDays({})).toEqual({
      day: [0, 1, 2, 3, 4, 5, 6],
      night: [0, 1, 2, 3, 4, 5, 6],
    });
  });

  it("reads each shift's picked days independently", () => {
    expect(
      resolveShiftCoverageDays({ rosterDayShiftDays: MON_FRI, rosterNightShiftDays: [] })
    ).toEqual({ day: MON_FRI, night: [] });
  });
});

describe("shiftCoverageOnDateKey", () => {
  const coverage = { day: MON_FRI, night: [0, 1, 2, 3, 4, 5, 6] };

  it("reports both shifts on a covered weekday", () => {
    expect(shiftCoverageOnDateKey(coverage, "2026-08-05")).toEqual({
      day: true,
      night: true,
      anyShift: true,
    });
  });

  it("drops only the uncovered shift on a Saturday", () => {
    expect(shiftCoverageOnDateKey(coverage, "2026-08-08")).toEqual({
      day: false,
      night: true,
      anyShift: true,
    });
  });
});

describe("isNoShiftDateKey", () => {
  const coverage = { day: MON_FRI, night: MON_FRI };

  it("calls a weekend day No Shift when neither shift runs", () => {
    expect(isNoShiftDateKey(coverage, "2026-08-08")).toBe(true);
    expect(isNoShiftDateKey(coverage, "2026-08-05")).toBe(false);
  });

  it("narrows to the filtered shift", () => {
    const dayOnly = { day: MON_FRI, night: [] };
    expect(isNoShiftDateKey(dayOnly, "2026-08-05", "night")).toBe(true);
    expect(isNoShiftDateKey(dayOnly, "2026-08-05", "day")).toBe(false);
    // The day shift still runs, so the date is not a No Shift day overall.
    expect(isNoShiftDateKey(dayOnly, "2026-08-05", "all")).toBe(false);
  });
});

describe("dateKeysInRange", () => {
  it("is inclusive of both ends", () => {
    expect(dateKeysInRange(WEEK_START, WEEK_END)).toHaveLength(7);
    expect(dateKeysInRange(WEEK_START, WEEK_START)).toEqual([WEEK_START]);
  });

  it("returns nothing for a reversed or unparseable range", () => {
    expect(dateKeysInRange(WEEK_END, WEEK_START)).toEqual([]);
    expect(dateKeysInRange("not-a-date", WEEK_END)).toEqual([]);
  });
});

describe("noShiftDateKeys", () => {
  it("lists the weekend for a Mon–Fri site", () => {
    expect(noShiftDateKeys({ day: MON_FRI, night: MON_FRI }, WEEK_START, WEEK_END)).toEqual([
      "2026-08-08",
      "2026-08-09",
    ]);
  });

  it("lists nothing for a seven-day site", () => {
    const allWeek = coverageDaysOrAllWeek(null);
    expect(noShiftDateKeys({ day: allWeek, night: allWeek }, WEEK_START, WEEK_END)).toEqual([]);
  });

  it("keeps a day covered by the night shift off the list", () => {
    expect(
      noShiftDateKeys({ day: MON_FRI, night: coverageDaysOrAllWeek(null) }, WEEK_START, WEEK_END)
    ).toEqual([]);
  });
});
