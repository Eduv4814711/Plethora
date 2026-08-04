import { describe, expect, it } from "vitest";
import { calculateHours, calculateManualEntryHours } from "../attendance.service.js";

describe("calculateHours", () => {
  const shiftStart = new Date("2026-05-06T04:00:00.000Z"); // 06:00 SAST
  const shiftEnd = new Date("2026-05-06T16:00:00.000Z"); // 18:00 SAST

  it("pays full scheduled shift when clocked in on time and out on time", () => {
    const clockIn = new Date("2026-05-06T04:00:00.000Z");
    const clockOut = new Date("2026-05-06T16:00:00.000Z");
    const result = calculateHours(clockIn, clockOut, shiftStart, shiftEnd);
    expect(result).toEqual({ hoursWorked: 12, overtimeHours: 0 });
  });

  it("does not pay for time before shift start when clocked in early", () => {
    const clockIn = new Date("2026-05-06T02:00:00.000Z"); // 04:00 SAST
    const clockOut = new Date("2026-05-06T16:00:00.000Z");
    const result = calculateHours(clockIn, clockOut, shiftStart, shiftEnd);
    expect(result).toEqual({ hoursWorked: 12, overtimeHours: 0 });
  });

  it("reduces pay when clocked in late", () => {
    const clockIn = new Date("2026-05-06T06:00:00.000Z"); // 08:00 SAST
    const clockOut = new Date("2026-05-06T16:00:00.000Z");
    const result = calculateHours(clockIn, clockOut, shiftStart, shiftEnd);
    expect(result).toEqual({ hoursWorked: 10, overtimeHours: 0 });
  });

  it("reduces pay when clocked out early", () => {
    const clockIn = new Date("2026-05-06T04:00:00.000Z");
    const clockOut = new Date("2026-05-06T12:00:00.000Z"); // 14:00 SAST
    const result = calculateHours(clockIn, clockOut, shiftStart, shiftEnd);
    expect(result).toEqual({ hoursWorked: 8, overtimeHours: 0 });
  });

  it("adds overtime for time worked after scheduled shift end", () => {
    const clockIn = new Date("2026-05-06T04:00:00.000Z");
    const clockOut = new Date("2026-05-06T18:00:00.000Z"); // 20:00 SAST
    const result = calculateHours(clockIn, clockOut, shiftStart, shiftEnd);
    expect(result).toEqual({ hoursWorked: 12, overtimeHours: 2 });
  });

  it("handles ad-hoc shifts where shift bounds match clock times", () => {
    const clockIn = new Date("2026-05-06T08:00:00.000Z");
    const clockOut = new Date("2026-05-06T16:00:00.000Z");
    const result = calculateHours(clockIn, clockOut, clockIn, clockOut);
    expect(result).toEqual({ hoursWorked: 8, overtimeHours: 0 });
  });

  it("returns zero when clock-out is before shift start", () => {
    const clockIn = new Date("2026-05-06T00:00:00.000Z");
    const clockOut = new Date("2026-05-06T02:00:00.000Z");
    const result = calculateHours(clockIn, clockOut, shiftStart, shiftEnd);
    expect(result).toEqual({ hoursWorked: 0, overtimeHours: 0 });
  });
});

describe("calculateManualEntryHours", () => {
  it("pays all hours as standard when under the standard shift threshold", () => {
    const clockIn = new Date("2026-05-06T04:00:00.000Z");
    const clockOut = new Date("2026-05-06T12:00:00.000Z"); // 8h span
    const result = calculateManualEntryHours(clockIn, clockOut);
    expect(result).toEqual({ hoursWorked: 8, overtimeHours: 0 });
  });

  it("pays all hours as standard when exactly at the standard shift threshold", () => {
    const clockIn = new Date("2026-05-06T04:00:00.000Z");
    const clockOut = new Date("2026-05-06T16:00:00.000Z"); // 12h span
    const result = calculateManualEntryHours(clockIn, clockOut);
    expect(result).toEqual({ hoursWorked: 12, overtimeHours: 0 });
  });

  it("treats time beyond the standard shift threshold as overtime", () => {
    const clockIn = new Date("2026-05-06T04:00:00.000Z");
    const clockOut = new Date("2026-05-06T19:00:00.000Z"); // 15h span
    const result = calculateManualEntryHours(clockIn, clockOut);
    expect(result).toEqual({ hoursWorked: 12, overtimeHours: 3 });
  });
});
