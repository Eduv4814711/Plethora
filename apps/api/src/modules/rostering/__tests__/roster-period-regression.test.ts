import { describe, expect, it } from "vitest";

/**
 * Roster period helpers — mirrors payroll-aligned period navigation used by
 * the rostering UI. Kept pure so we can regression-test without touching the
 * roster engine (Phase 3: protect, don't redesign).
 */
export function shiftPayPeriod(
  periodStart: Date,
  periodEnd: Date,
  direction: "prev" | "next"
): { periodStart: Date; periodEnd: Date } {
  const lengthMs = periodEnd.getTime() - periodStart.getTime();
  if (direction === "next") {
    const nextStart = new Date(periodEnd.getTime() + 24 * 3600_000);
    nextStart.setHours(0, 0, 0, 0);
    const nextEnd = new Date(nextStart.getTime() + lengthMs);
    return { periodStart: nextStart, periodEnd: nextEnd };
  }
  const prevEnd = new Date(periodStart.getTime() - 24 * 3600_000);
  prevEnd.setHours(23, 59, 59, 999);
  const prevStart = new Date(prevEnd.getTime() - lengthMs);
  prevStart.setHours(0, 0, 0, 0);
  return { periodStart: prevStart, periodEnd: prevEnd };
}

export function isShiftInPeriod(
  shiftStart: Date,
  periodStart: Date,
  periodEnd: Date
): boolean {
  return shiftStart >= periodStart && shiftStart <= periodEnd;
}

describe("roster period navigation (regression)", () => {
  const start = new Date("2026-07-01T00:00:00Z");
  const end = new Date("2026-07-15T23:59:59.999Z");

  it("moves to the next payroll-aligned period of the same length", () => {
    const next = shiftPayPeriod(start, end, "next");
    expect(next.periodStart.toISOString().slice(0, 10)).toBe("2026-07-16");
    const length = end.getTime() - start.getTime();
    expect(next.periodEnd.getTime() - next.periodStart.getTime()).toBe(length);
  });

  it("moves to the previous period of the same length", () => {
    const prev = shiftPayPeriod(start, end, "prev");
    expect(prev.periodEnd.getTime()).toBeLessThan(start.getTime());
    const length = end.getTime() - start.getTime();
    expect(Math.abs(prev.periodEnd.getTime() - prev.periodStart.getTime() - length)).toBeLessThan(1000);
  });

  it("includes shifts that fall inside the selected period", () => {
    expect(
      isShiftInPeriod(new Date("2026-07-08T06:00:00Z"), start, end)
    ).toBe(true);
    expect(
      isShiftInPeriod(new Date("2026-07-20T06:00:00Z"), start, end)
    ).toBe(false);
  });
});
