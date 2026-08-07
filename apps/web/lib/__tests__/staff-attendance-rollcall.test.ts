import { describe, expect, it } from "vitest";
import type { StaffAttendanceRow } from "../staff-attendance-api";
import {
  defaultOfficeTimes,
  formatStaffName,
  formatTimeOfDay,
  remainingToCapture,
  rollCallState,
} from "../staff-attendance-utils";

function makeRow(overrides: Partial<StaffAttendanceRow> = {}): StaffAttendanceRow {
  return {
    employeeId: "e-1",
    firstName: "Ayanda",
    lastName: "Bell",
    employeeNumber: "E-001",
    jobRole: "HR Manager",
    ordinaryHours: null,
    status: null,
    timeIn: null,
    timeOut: null,
    hoursWorked: null,
    notes: null,
    onApprovedLeave: false,
    approvedLeaveType: null,
    ...overrides,
  };
}

describe("defaultOfficeTimes", () => {
  it("falls back to a standard office day when hours are not a time range", () => {
    expect(defaultOfficeTimes(null)).toEqual({ timeIn: "08:00", timeOut: "17:00" });
    expect(defaultOfficeTimes("45 hours/week")).toEqual({ timeIn: "08:00", timeOut: "17:00" });
    expect(defaultOfficeTimes("")).toEqual({ timeIn: "08:00", timeOut: "17:00" });
  });

  it("uses an explicit range when one is recorded", () => {
    expect(defaultOfficeTimes("07:30-16:00")).toEqual({ timeIn: "07:30", timeOut: "16:00" });
    expect(defaultOfficeTimes("Mon-Fri 08:00 to 16:30")).toEqual({
      timeIn: "08:00",
      timeOut: "16:30",
    });
  });

  it("pads a single-digit start hour", () => {
    expect(defaultOfficeTimes("7:30-16:00")).toEqual({ timeIn: "07:30", timeOut: "16:00" });
  });

  it("rejects a range that does not move forward", () => {
    expect(defaultOfficeTimes("17:00-08:00")).toEqual({ timeIn: "08:00", timeOut: "17:00" });
    expect(defaultOfficeTimes("09:00-09:00")).toEqual({ timeIn: "08:00", timeOut: "17:00" });
  });

  it("rejects an impossible hour", () => {
    expect(defaultOfficeTimes("38:00-42:00")).toEqual({ timeIn: "08:00", timeOut: "17:00" });
  });
});

describe("rollCallState", () => {
  it("reports what has been captured", () => {
    expect(rollCallState(makeRow())).toBe("not_captured");
    expect(rollCallState(makeRow({ status: "present" }))).toBe("present");
    expect(rollCallState(makeRow({ status: "absent" }))).toBe("absent");
    expect(rollCallState(makeRow({ status: "sick_leave" }))).toBe("leave");
    expect(rollCallState(makeRow({ status: "public_holiday" }))).toBe("other");
  });

  // The leave record is the source of truth, so it must win over anything captured here.
  it("treats approved leave as leave regardless of what was captured", () => {
    expect(rollCallState(makeRow({ onApprovedLeave: true, status: "present" }))).toBe("leave");
    expect(rollCallState(makeRow({ onApprovedLeave: true, status: null }))).toBe("leave");
  });
});

describe("remainingToCapture", () => {
  it("returns only people with nothing recorded and no approved leave", () => {
    const rows = [
      makeRow({ employeeId: "e-1" }),
      makeRow({ employeeId: "e-2", status: "present" }),
      makeRow({ employeeId: "e-3", onApprovedLeave: true }),
      makeRow({ employeeId: "e-4" }),
    ];
    expect(remainingToCapture(rows).map((row) => row.employeeId)).toEqual(["e-1", "e-4"]);
  });
});

describe("formatStaffName", () => {
  it("joins the name parts", () => {
    expect(formatStaffName(makeRow())).toBe("Ayanda Bell");
  });
});

describe("formatTimeOfDay", () => {
  it("returns an empty string for missing or invalid input", () => {
    expect(formatTimeOfDay(null)).toBe("");
    expect(formatTimeOfDay("not-a-date")).toBe("");
  });
});
