import { describe, it, expect } from "vitest";
import { summariseWorkPattern } from "../leave-work-pattern.js";

/** `count` consecutive-cycle work days starting at 2026-01-01, `on` days on then `off` days off. */
function rotation(onDays: number, offDays: number, cycles: number): string[] {
  const keys: string[] = [];
  const start = Date.UTC(2026, 0, 1);
  let day = 0;
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (let i = 0; i < onDays; i += 1) {
      keys.push(new Date(start + (day + i) * 86_400_000).toISOString().slice(0, 10));
    }
    day += onDays + offDays;
  }
  return keys;
}

const shifts = (count: number, minutes: number) => Array.from({ length: count }, () => minutes);

describe("summariseWorkPattern", () => {
  it("returns null when there are no usable shifts", () => {
    expect(summariseWorkPattern({ shiftMinutes: [], workedDayKeys: [] })).toBeNull();
    expect(summariseWorkPattern({ shiftMinutes: [0, -5], workedDayKeys: [] })).toBeNull();
  });

  it("reads a twelve-hour guard shift", () => {
    const days = rotation(3, 3, 10);
    const result = summariseWorkPattern({
      shiftMinutes: shifts(days.length, 720),
      workedDayKeys: days,
    });
    expect(result?.minutesPerShift).toBe(720);
  });

  it("reads an eight-hour office shift", () => {
    const days = rotation(5, 2, 8);
    const result = summariseWorkPattern({
      shiftMinutes: shifts(days.length, 480),
      workedDayKeys: days,
    });
    expect(result?.minutesPerShift).toBe(480);
  });

  it("uses the median so one double shift cannot inflate entitlement", () => {
    const days = rotation(3, 3, 10);
    const lengths = shifts(days.length, 720);
    lengths[0] = 1440; // a single 24-hour cover
    const result = summariseWorkPattern({ shiftMinutes: lengths, workedDayKeys: days });
    expect(result?.minutesPerShift).toBe(720);
  });

  it("derives roughly 3.5 days a week from a three-on-three-off rotation", () => {
    const days = rotation(3, 3, 10);
    const result = summariseWorkPattern({
      shiftMinutes: shifts(days.length, 720),
      workedDayKeys: days,
    });
    // The span runs to the last worked day, so the trailing rest period is not
    // counted and the figure sits a little above the 3.5 steady state. The bias
    // is small and favours the employee, which is the safe direction for a
    // statutory minimum.
    expect(result?.daysPerWeek).toBeGreaterThanOrEqual(3.5);
    expect(result?.daysPerWeek).toBeLessThan(3.8);
  });

  it("derives roughly 5 days a week from a Monday-to-Friday pattern", () => {
    const days = rotation(5, 2, 8);
    const result = summariseWorkPattern({
      shiftMinutes: shifts(days.length, 480),
      workedDayKeys: days,
    });
    expect(result?.daysPerWeek).toBeGreaterThanOrEqual(5);
    expect(result?.daysPerWeek).toBeLessThan(5.4);
  });

  it("measures across the rostered span, not a nominal lookback", () => {
    // The regression this guards: a four-week roster inside a 180-day query
    // window must read as its own rotation, not as one day a week.
    const days = rotation(3, 3, 5); // 15 worked days across 30 calendar days
    const result = summariseWorkPattern({
      shiftMinutes: shifts(days.length, 720),
      workedDayKeys: days,
    });
    expect(result?.daysPerWeek).toBeGreaterThan(3);
    expect(result?.daysPerWeek).toBeLessThan(4);
  });

  it("reports days per week as unknown when the span is too short to infer a rotation", () => {
    // One published week would otherwise read as seven days a week.
    const days = ["2026-01-01", "2026-01-02", "2026-01-03"];
    const result = summariseWorkPattern({
      shiftMinutes: shifts(3, 720),
      workedDayKeys: days,
    });
    expect(result?.minutesPerShift).toBe(720);
    expect(result?.daysPerWeek).toBe(0);
  });

  it("never reports more than seven days a week", () => {
    const days: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      days.push(new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
    }
    const result = summariseWorkPattern({
      shiftMinutes: shifts(days.length, 720),
      workedDayKeys: days,
    });
    expect(result?.daysPerWeek).toBeLessThanOrEqual(7);
  });

  it("ignores duplicate day keys from double shifts", () => {
    const days = rotation(3, 3, 10);
    const withDuplicates = [...days, ...days];
    const result = summariseWorkPattern({
      shiftMinutes: shifts(withDuplicates.length, 720),
      workedDayKeys: withDuplicates,
    });
    const single = summariseWorkPattern({
      shiftMinutes: shifts(days.length, 720),
      workedDayKeys: days,
    });
    expect(result?.daysPerWeek).toBe(single?.daysPerWeek);
  });

  it("survives malformed day keys without inventing a pattern", () => {
    const result = summariseWorkPattern({
      shiftMinutes: shifts(3, 720),
      workedDayKeys: ["not-a-date", "also-bad"],
    });
    expect(result?.minutesPerShift).toBe(720);
    expect(result?.daysPerWeek).toBe(0);
  });
});
