import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {},
}));

import {
  buildCalendarDays,
  buildSiteDemandSlots,
  computeFairnessTargets,
  validateDailyCoverage,
} from "../roster-scheduler.js";
import { resolveSiteCoverageDays } from "../../lib/site-coverage-days.js";

/** 2026-06-01 (Mon) – 2026-06-14 (Sun): exactly two whole weeks. */
const TWO_WEEKS = buildCalendarDays(
  new Date("2026-06-01T00:00:00.000Z"),
  new Date("2026-06-14T23:59:59.999Z")
);

const NO_GENDER_RULES = { rosterDayShiftGender: null, rosterNightShiftGender: null };

const WEEKDAYS = [1, 2, 3, 4, 5];

describe("buildSiteDemandSlots with per-shift weekday cover", () => {
  it("creates no day demand on weekends for a Mon–Fri day shift", () => {
    const { slots } = buildSiteDemandSlots({
      siteId: "site-1",
      calendarDays: TWO_WEEKS,
      dayPosts: [{ id: "d1" }],
      nightPosts: [{ id: "n1" }],
      staffing: { day: 1, night: 1 },
      siteGenderRules: NO_GENDER_RULES,
      coverageDays: resolveSiteCoverageDays({
        rosterDayShiftDays: WEEKDAYS,
        rosterNightShiftDays: [0, 1, 2, 3, 4, 5, 6],
      }),
    });

    const daySlots = slots.filter((s) => s.shiftType === "day");
    const nightSlots = slots.filter((s) => s.shiftType === "night");
    expect(daySlots).toHaveLength(10);
    expect(nightSlots).toHaveLength(14);
    // Saturday 2026-06-06 and Sunday 2026-06-07 get night cover only.
    expect(daySlots.some((s) => s.dateKey === "2026-06-06")).toBe(false);
    expect(daySlots.some((s) => s.dateKey === "2026-06-07")).toBe(false);
    expect(nightSlots.some((s) => s.dateKey === "2026-06-07")).toBe(true);
  });

  it("keeps the legacy seven-day behaviour when coverageDays is omitted", () => {
    const { slots } = buildSiteDemandSlots({
      siteId: "site-1",
      calendarDays: TWO_WEEKS,
      dayPosts: [{ id: "d1" }],
      nightPosts: [{ id: "n1" }],
      staffing: { day: 1, night: 1 },
      siteGenderRules: NO_GENDER_RULES,
    });
    expect(slots).toHaveLength(28);
  });

  it("raises no MISSING_NIGHT_POSTS warning when the night shift covers no days", () => {
    const { slots, warnings } = buildSiteDemandSlots({
      siteId: "site-1",
      calendarDays: TWO_WEEKS,
      dayPosts: [{ id: "d1" }],
      nightPosts: [],
      staffing: { day: 1, night: 1 },
      siteGenderRules: NO_GENDER_RULES,
      coverageDays: resolveSiteCoverageDays({
        rosterDayShiftDays: WEEKDAYS,
        rosterNightShiftDays: [],
      }),
    });

    expect(warnings).toHaveLength(0);
    expect(slots.every((s) => s.shiftType === "day")).toBe(true);
    expect(slots).toHaveLength(10);
  });
});

describe("validateDailyCoverage with per-shift weekday cover", () => {
  const coverageDays = resolveSiteCoverageDays({
    rosterDayShiftDays: WEEKDAYS,
    rosterNightShiftDays: WEEKDAYS,
  });

  it("does not flag an empty weekend on a Mon–Fri site", () => {
    // A full Mon–Fri week of entries, nothing on Sat/Sun.
    const entries = ["01", "02", "03", "04", "05"].flatMap((dd) => [
      { startTime: `2026-06-${dd}T06:00:00.000Z`, shiftType: "day" as const },
      { startTime: `2026-06-${dd}T18:00:00.000Z`, shiftType: "night" as const },
    ]);
    const week = buildCalendarDays(
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-07T23:59:59.999Z")
    );

    expect(validateDailyCoverage(entries, week, { day: 1, night: 1 }, coverageDays)).toEqual([]);
    // Without the weekday cover it is reported as two uncovered days — the old behaviour.
    expect(validateDailyCoverage(entries, week, { day: 1, night: 1 })).toHaveLength(2);
  });

  it("still flags a genuine gap on a covered weekday", () => {
    const week = buildCalendarDays(
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2026-06-07T23:59:59.999Z")
    );
    const uncovered = validateDailyCoverage(
      [{ startTime: "2026-06-01T06:00:00.000Z", shiftType: "day" }],
      week,
      { day: 1, night: 1 },
      coverageDays
    );

    // Monday is short its night shift; Tue–Fri are short both; Sat/Sun are not covered.
    expect(uncovered).toHaveLength(5);
    expect(uncovered[0]!.date).toBe("2026-06-01");
    expect(uncovered[0]!.missing).toEqual(["night"]);
    expect(uncovered.some((u) => u.date === "2026-06-06" || u.date === "2026-06-07")).toBe(false);
  });
});

describe("computeFairnessTargets with per-shift weekday cover", () => {
  it("scales the workload target to covered days only", () => {
    const fullWeek = computeFairnessTargets(4, TWO_WEEKS, { day: 1, night: 1 });
    const weekdaysOnly = computeFairnessTargets(
      4,
      TWO_WEEKS,
      { day: 1, night: 1 },
      resolveSiteCoverageDays({ rosterDayShiftDays: WEEKDAYS, rosterNightShiftDays: WEEKDAYS })
    );

    // 28 demand slots over 4 guards vs 20 over 4.
    expect(fullWeek.targetDay + fullWeek.targetNight).toBe(7);
    expect(weekdaysOnly.targetDay + weekdaysOnly.targetNight).toBe(5);
    // Fewer worked days means more rest days per guard.
    expect(weekdaysOnly.targetOff).toBeGreaterThan(fullWeek.targetOff);
  });

  it("drops the Sunday target to zero when no shift runs on a Sunday", () => {
    const weekdaysOnly = computeFairnessTargets(
      4,
      TWO_WEEKS,
      { day: 1, night: 1 },
      resolveSiteCoverageDays({ rosterDayShiftDays: WEEKDAYS, rosterNightShiftDays: WEEKDAYS })
    );
    expect(weekdaysOnly.targetSunday).toBe(0);
  });
});
