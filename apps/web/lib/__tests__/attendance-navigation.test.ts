import { describe, expect, it } from "vitest";
import {
  attendanceOverviewHref,
  attendanceSiteHref,
  parseAttendanceDateRange,
} from "../attendance-navigation";

const state = { start: "2026-07-01", end: "2026-07-31", shiftType: "night" as const };

describe("attendance navigation", () => {
  it("preserves the period and shift in a focused site link", () => {
    expect(attendanceSiteHref("site 1/alpha", state)).toBe(
      "/attendance/sites/site%201%2Falpha?start=2026-07-01&end=2026-07-31&shiftType=night"
    );
  });

  it("preserves the same context when returning to the overview", () => {
    expect(attendanceOverviewHref(state)).toBe(
      "/attendance?start=2026-07-01&end=2026-07-31&shiftType=night"
    );
  });

  it("accepts real ordered date keys", () => {
    expect(parseAttendanceDateRange("2028-02-29", "2028-03-01")).toEqual({
      start: "2028-02-29",
      end: "2028-03-01",
    });
  });

  it.each([
    ["not-a-date", "2026-07-31"],
    ["2026-02-30", "2026-03-01"],
    ["2026-08-01", "2026-07-31"],
    ["2026-07-01", null],
  ])("rejects an unsafe deep-link range (%s to %s)", (start, end) => {
    expect(parseAttendanceDateRange(start, end)).toBeNull();
  });
});
