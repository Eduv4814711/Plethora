import { describe, expect, it } from "vitest";
import {
  buildApprovedSiteDateCoverage,
  classifyShiftHours,
} from "../timesheet.service.js";
import { getShiftTimes } from "../../lib/timezone.js";

describe("classifyShiftHours", () => {
  const timeZone = "Africa/Johannesburg";
  const holidays = new Set<string>(["2026-05-01"]);

  it("classifies weekday basic and overtime hours", () => {
    const shiftStart = new Date("2026-05-06T04:00:00.000Z");
    const result = classifyShiftHours({
      shiftStartTime: shiftStart,
      hoursWorked: 8,
      overtimeHours: 2,
      timeZone,
      holidayDates: holidays,
    });
    expect(result).toEqual({
      basicHours: 8,
      overtimeHours: 2,
      sundayHours: 0,
      publicHolidayHours: 0,
    });
  });

  it("classifies Sunday work into sunday bucket (all hours at Sunday rate)", () => {
    const shiftStart = new Date("2026-05-10T04:00:00.000Z");
    const result = classifyShiftHours({
      shiftStartTime: shiftStart,
      hoursWorked: 10,
      overtimeHours: 2,
      timeZone,
      holidayDates: holidays,
    });
    expect(result.sundayHours).toBe(12);
    expect(result.basicHours).toBe(0);
  });

  it("classifies public holiday work into public holiday bucket", () => {
    const shiftStart = new Date("2026-05-01T04:00:00.000Z");
    const result = classifyShiftHours({
      shiftStartTime: shiftStart,
      hoursWorked: 8,
      overtimeHours: 0,
      timeZone,
      holidayDates: holidays,
    });
    expect(result.publicHolidayHours).toBe(8);
    expect(result.sundayHours).toBe(0);
  });

  it("uses shift start date for overnight night shifts (not clock-out day)", () => {
    const date = new Date("2026-05-06T00:00:00.000Z");
    const { shiftStart, shiftEnd } = getShiftTimes(date, "night", timeZone);
    expect(shiftEnd.getTime()).toBeGreaterThan(shiftStart.getTime());

    const result = classifyShiftHours({
      shiftStartTime: shiftStart,
      hoursWorked: 12,
      overtimeHours: 0,
      timeZone,
      holidayDates: holidays,
    });
    expect(result.basicHours).toBe(12);
    expect(result.sundayHours).toBe(0);
  });

  it("overnight shift starting Saturday night is classified by Saturday (not Sunday)", () => {
    const saturday = new Date("2026-05-09T00:00:00.000Z");
    const { shiftStart } = getShiftTimes(saturday, "night", timeZone);
    const result = classifyShiftHours({
      shiftStartTime: shiftStart,
      hoursWorked: 12,
      overtimeHours: 0,
      timeZone,
      holidayDates: holidays,
    });
    expect(result.basicHours).toBe(12);
    expect(result.sundayHours).toBe(0);
  });

  it("tracks approved site-timesheet coverage by exact site and calendar date", () => {
    const covered = buildApprovedSiteDateCoverage([
      {
        siteId: "site-a",
        periodStart: new Date("2026-05-04T00:00:00.000Z"),
        periodEnd: new Date("2026-05-06T23:59:59.999Z"),
      },
    ]);

    expect(covered.has("site-a:2026-05-04")).toBe(true);
    expect(covered.has("site-a:2026-05-06")).toBe(true);
    expect(covered.has("site-a:2026-05-07")).toBe(false);
    expect(covered.has("site-b:2026-05-05")).toBe(false);
  });
});
