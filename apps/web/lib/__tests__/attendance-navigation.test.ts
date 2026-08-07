import { describe, expect, it } from "vitest";
import {
  attendanceOverviewHref,
  attendanceSiteHref,
  attendanceStaffHref,
  parseAttendanceDate,
  parseAttendanceDateRange,
  parseAttendanceView,
  shiftDateKey,
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

describe("attendance view", () => {
  it("only recognises the office staff view explicitly", () => {
    expect(parseAttendanceView("staff")).toBe("staff");
    expect(parseAttendanceView("sites")).toBe("sites");
  });

  // Guards are the default so an unknown or missing value never lands somewhere surprising.
  it.each([null, undefined, "", "guards", "STAFF"])(
    "falls back to the guard view for %s",
    (value) => {
      expect(parseAttendanceView(value)).toBe("sites");
    }
  );

  it("builds an office roll-call link for a date", () => {
    expect(attendanceStaffHref("2026-08-03")).toBe("/attendance/staff?date=2026-08-03");
  });
});

describe("parseAttendanceDate", () => {
  it("accepts a real date key", () => {
    expect(parseAttendanceDate("2028-02-29")).toBe("2028-02-29");
  });

  it.each([null, undefined, "", "2026-02-30", "03-08-2026", "2026-8-3"])(
    "rejects %s",
    (value) => {
      expect(parseAttendanceDate(value)).toBeNull();
    }
  );
});

describe("shiftDateKey", () => {
  it("steps forward and back", () => {
    expect(shiftDateKey("2026-08-03", 1)).toBe("2026-08-04");
    expect(shiftDateKey("2026-08-03", -1)).toBe("2026-08-02");
  });

  it("crosses month and year boundaries", () => {
    expect(shiftDateKey("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDateKey("2028-02-28", 1)).toBe("2028-02-29");
  });
});
