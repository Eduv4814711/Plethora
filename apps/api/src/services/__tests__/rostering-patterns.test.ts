import { describe, expect, it } from "vitest";
import { getDay } from "date-fns";
import {
  computeDatesFromPattern,
  computeDatesFromPatternDual,
  dualPatternBlocks3On3Off,
  buildGuardPatternSchedule,
} from "../rostering.service.js";

describe("rostering patterns", () => {
  const start = new Date("2026-06-01T00:00:00.000Z");
  const end = new Date("2026-06-14T23:59:59.999Z");

  it("3_on_3_off dual pattern alternates day, night, then off blocks", () => {
    const blocks = dualPatternBlocks3On3Off();
    expect(blocks).toEqual([
      { type: "day", count: 3 },
      { type: "night", count: 3 },
      { type: "off", count: 3 },
    ]);

    const dual = computeDatesFromPatternDual(start, end, "3_on_3_off");
    const dayCount = dual.filter((d) => d.shiftType === "day").length;
    const nightCount = dual.filter((d) => d.shiftType === "night").length;
    expect(dayCount).toBeGreaterThan(0);
    expect(nightCount).toBeGreaterThan(0);
    expect(dual.length).toBe(dayCount + nightCount);
  });

  it("custom_builder pattern respects day/night/off blocks", () => {
    const customBlocks = [
      { type: "day" as const, count: 2 },
      { type: "off" as const, count: 1 },
      { type: "night" as const, count: 2 },
    ];
    const dual = computeDatesFromPatternDual(start, end, "custom_builder", customBlocks);
    expect(dual.some((d) => d.shiftType === "day")).toBe(true);
    expect(dual.some((d) => d.shiftType === "night")).toBe(true);
  });

  it("custom weekday pattern only includes selected days", () => {
    const dates = computeDatesFromPattern(start, end, "custom", [1, 3, 5]);
    for (const d of dates) {
      expect([1, 3, 5]).toContain(getDay(d));
    }
  });

  it("buildGuardPatternSchedule with offset staggers guards on same pattern", () => {
    const blocks = dualPatternBlocks3On3Off();
    const guardA = buildGuardPatternSchedule(start, end, blocks, 0);
    const guardB = buildGuardPatternSchedule(start, end, blocks, 3);
    expect(guardA.length).toBeGreaterThan(0);
    expect(guardB.length).toBeGreaterThan(0);
    const firstA = guardA[0]!;
    const firstB = guardB[0]!;
    expect(firstA.date.toISOString()).not.toBe(firstB.date.toISOString());
  });

  it("weekdays pattern excludes Saturday and Sunday", () => {
    const dates = computeDatesFromPattern(start, end, "weekdays");
    for (const d of dates) {
      const day = getDay(d);
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);
    }
  });
});
