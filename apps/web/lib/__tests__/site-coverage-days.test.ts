import { describe, it, expect } from "vitest";
import {
  coverageDaysOrAllWeek,
  describeCoverageDays,
  normalizeCoverageDays,
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
