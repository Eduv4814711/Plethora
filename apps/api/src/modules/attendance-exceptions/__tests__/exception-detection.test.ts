import { describe, expect, it } from "vitest";
import { detectExceptionsForShift } from "../exception-detection.js";

describe("detectExceptionsForShift", () => {
  const baseStart = new Date("2026-07-09T06:00:00Z");
  const baseEnd = new Date("2026-07-09T18:00:00Z");

  it("detects late arrival beyond grace", () => {
    const result = detectExceptionsForShift({
      shiftId: "s1",
      employeeId: "e1",
      siteId: "site1",
      scheduledStart: baseStart,
      scheduledEnd: baseEnd,
      clockIn: new Date("2026-07-09T06:30:00Z"),
      clockOut: null,
      now: new Date("2026-07-09T07:00:00Z"),
    });
    expect(result.some((r) => r.exceptionType === "LATE_ARRIVAL")).toBe(true);
    const late = result.find((r) => r.exceptionType === "LATE_ARRIVAL");
    expect(late?.minutesLate).toBe(30);
  });

  it("does not flag late within grace", () => {
    const result = detectExceptionsForShift({
      shiftId: "s1",
      employeeId: "e1",
      siteId: "site1",
      scheduledStart: baseStart,
      scheduledEnd: baseEnd,
      clockIn: new Date("2026-07-09T06:10:00Z"),
      clockOut: null,
      now: new Date("2026-07-09T07:00:00Z"),
    });
    expect(result.some((r) => r.exceptionType === "LATE_ARRIVAL")).toBe(false);
  });

  it("detects missed clock-in", () => {
    const result = detectExceptionsForShift({
      shiftId: "s1",
      employeeId: "e1",
      siteId: "site1",
      scheduledStart: baseStart,
      scheduledEnd: baseEnd,
      clockIn: null,
      clockOut: null,
      now: new Date("2026-07-09T06:30:00Z"),
    });
    expect(result.some((r) => r.exceptionType === "MISSED_CLOCK_IN")).toBe(true);
  });

  it("detects absent after threshold", () => {
    const result = detectExceptionsForShift({
      shiftId: "s1",
      employeeId: "e1",
      siteId: "site1",
      scheduledStart: baseStart,
      scheduledEnd: baseEnd,
      clockIn: null,
      clockOut: null,
      now: new Date("2026-07-09T09:00:00Z"),
    });
    expect(result.some((r) => r.exceptionType === "ABSENT")).toBe(true);
    expect(result.some((r) => r.exceptionType === "MISSED_CLOCK_IN")).toBe(false);
  });

  it("detects early departure", () => {
    const result = detectExceptionsForShift({
      shiftId: "s1",
      employeeId: "e1",
      siteId: "site1",
      scheduledStart: baseStart,
      scheduledEnd: baseEnd,
      clockIn: baseStart,
      clockOut: new Date("2026-07-09T16:00:00Z"),
      now: new Date("2026-07-09T19:00:00Z"),
    });
    expect(result.some((r) => r.exceptionType === "EARLY_DEPARTURE")).toBe(true);
  });

  it("detects missed clock-out", () => {
    const result = detectExceptionsForShift({
      shiftId: "s1",
      employeeId: "e1",
      siteId: "site1",
      scheduledStart: baseStart,
      scheduledEnd: baseEnd,
      clockIn: baseStart,
      clockOut: null,
      now: new Date("2026-07-09T18:30:00Z"),
    });
    expect(result.some((r) => r.exceptionType === "MISSED_CLOCK_OUT")).toBe(true);
  });

  it("detects outside geofence", () => {
    const result = detectExceptionsForShift({
      shiftId: "s1",
      employeeId: "e1",
      siteId: "site1",
      scheduledStart: baseStart,
      scheduledEnd: baseEnd,
      clockIn: baseStart,
      clockOut: null,
      clockInLat: -26.2,
      clockInLng: 28.0,
      geofenceLat: -26.2041,
      geofenceLng: 28.0473,
      geofenceRadiusMeters: 100,
      now: new Date("2026-07-09T07:00:00Z"),
    });
    expect(result.some((r) => r.exceptionType === "OUTSIDE_GEOFENCE")).toBe(true);
  });
});
