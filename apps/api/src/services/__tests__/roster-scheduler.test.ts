import { describe, it, expect } from "vitest";
import {
  buildCalendarDays,
  buildPatternPreferenceGrid,
  computeFairnessTargets,
  computeStaggerOffsets,
  getPatternShiftAtOffset,
  scoreGuardForSlot,
  validateDailyCoverage,
} from "../roster-scheduler.js";

describe("roster-scheduler", () => {
  it("buildCalendarDays includes start and end", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-03T23:59:59.999Z");
    const days = buildCalendarDays(start, end);
    expect(days).toHaveLength(3);
    expect(days[0]!.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(days[2]!.toISOString().slice(0, 10)).toBe("2026-05-03");
  });

  it("computeStaggerOffsets spaces phases across the cycle", () => {
    expect(computeStaggerOffsets(3, 9)).toEqual([0, 3, 6]);
    expect(computeStaggerOffsets(2, 9)).toEqual([0, 4]);
    expect(computeStaggerOffsets(5, 9)).toEqual([0, 1, 3, 5, 7]);
  });

  it("getPatternShiftAtOffset follows 3_on_3_off cycle", () => {
    expect(getPatternShiftAtOffset(0, "3_on_3_off")).toBe("day");
    expect(getPatternShiftAtOffset(2, "3_on_3_off")).toBe("day");
    expect(getPatternShiftAtOffset(3, "3_on_3_off")).toBe("night");
    expect(getPatternShiftAtOffset(6, "3_on_3_off")).toBe("off");
    expect(getPatternShiftAtOffset(8, "3_on_3_off")).toBe("off");
    expect(getPatternShiftAtOffset(9, "3_on_3_off")).toBe("day");
  });

  it("preference grid respects stagger offsets", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-05T23:59:59.999Z");
    const days = buildCalendarDays(start, end);
    const grid = buildPatternPreferenceGrid({
      guardIds: ["g1", "g2"],
      calendarDays: days,
      patternStartDate: start,
      pattern: "3_on_3_off",
      staggerOffsets: new Map([
        ["g1", 0],
        ["g2", 1],
      ]),
    });
    expect(grid.get("g1")!.get("2026-05-01")).toBe("day");
    expect(grid.get("g2")!.get("2026-05-01")).toBe("off");
    expect(grid.get("g2")!.get("2026-05-02")).toBe("day");
  });

  it("scoreGuardForSlot prefers guard below day target", () => {
    const targets = computeFairnessTargets(2, buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-14T23:59:59.999Z")
    ));
    const low: import("../roster-scheduler.js").GuardStats = {
      employeeId: "a",
      dayCount: 0,
      nightCount: 5,
      offCount: 0,
      sundayCount: 0,
      weekendCount: 0,
    };
    const high: import("../roster-scheduler.js").GuardStats = {
      employeeId: "b",
      dayCount: 7,
      nightCount: 0,
      offCount: 0,
      sundayCount: 0,
      weekendCount: 0,
    };
    const date = new Date("2026-05-05T00:00:00.000Z");
    const scoreLow = scoreGuardForSlot(low, "day", date, targets, "off");
    const scoreHigh = scoreGuardForSlot(high, "day", date, targets, "day");
    expect(scoreLow).toBeLessThan(scoreHigh);
  });

  it("validateDailyCoverage detects missing shifts", () => {
    const days = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-02T23:59:59.999Z")
    );
    const uncovered = validateDailyCoverage(
      [
        {
          startTime: "2026-05-01T04:00:00.000Z",
          shiftType: "day",
        },
      ],
      days
    );
    expect(uncovered).toHaveLength(2);
    expect(uncovered[0]!.missing).toContain("night");
  });

  it("validateDailyCoverage enforces minimum guards per shift", () => {
    const days = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-01T23:59:59.999Z")
    );
    const uncovered = validateDailyCoverage(
      [
        { startTime: "2026-05-01T04:00:00.000Z", shiftType: "day" },
        { startTime: "2026-05-01T16:00:00.000Z", shiftType: "night" },
      ],
      days,
      { day: 2, night: 1 }
    );
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0]!.missing).toEqual(["day"]);
    expect(uncovered[0]!.counts?.day).toBe(1);
    expect(uncovered[0]!.required?.day).toBe(2);
  });
});
