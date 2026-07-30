import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_EXCEPTION_ACTIONS,
  attendanceExceptionCopy,
  attendanceExceptionScanCopy,
} from "../attendance-exception-copy";

describe("attendance exception wording", () => {
  it("maps every user-facing outcome to the existing API action", () => {
    expect(Object.fromEntries(ATTENDANCE_EXCEPTION_ACTIONS.map((item) => [item.label, item.action]))).toEqual({
      "Confirm issue": "approve",
      "Classify issue as absence": "mark_absent",
      "Attendance corrected": "resolve",
      "Follow up later": "under_review",
      "Dismiss issue": "reject",
    });
  });

  it("states that classifying an absence does not mutate attendance", () => {
    const action = ATTENDANCE_EXCEPTION_ACTIONS.find((item) => item.action === "mark_absent");
    expect(action?.description).toBe(
      "Classify and close this issue as an absence. This does not change the attendance record."
    );
  });

  it("uses plain language for known and unknown issue types", () => {
    expect(attendanceExceptionCopy("MISSED_CLOCK_IN").title).toBe("Missing clock-in");
    expect(attendanceExceptionCopy("CUSTOM_ATTENDANCE_PROBLEM").title).toBe("Custom Attendance Problem");
  });

  // These keys are the AttendanceExceptionType enum in prisma/schema.prisma.
  // A mismatch silently downgrades the type to generic filler copy, which is
  // exactly what happened when the map used LATE_CLOCK_IN / EARLY_CLOCK_OUT.
  const SCHEMA_EXCEPTION_TYPES = [
    "LATE_ARRIVAL",
    "EARLY_DEPARTURE",
    "MISSED_CLOCK_IN",
    "MISSED_CLOCK_OUT",
    "ABSENT",
    "OUTSIDE_GEOFENCE",
    "UNSCHEDULED_CLOCK_IN",
    "PENDING_SUPERVISOR_REVIEW",
    "MANUAL_ADJUSTMENT_REQUIRED",
    "SHIFT_NOT_FOUND",
    "DUPLICATE_CLOCK_EVENT",
  ];

  it("has dedicated copy for every exception type the schema can produce", () => {
    const generic = attendanceExceptionCopy("DEFINITELY_NOT_A_REAL_TYPE");
    for (const type of SCHEMA_EXCEPTION_TYPES) {
      const copy = attendanceExceptionCopy(type);
      expect(copy.howToFix, `${type} fell through to generic copy`).not.toBe(generic.howToFix);
      expect(copy.description, `${type} fell through to generic copy`).not.toBe(
        generic.description
      );
    }
  });

  it("names the exact outcome buttons in its remedies so the guidance is followable", () => {
    const labels = ATTENDANCE_EXCEPTION_ACTIONS.map((a) => a.label);
    for (const type of SCHEMA_EXCEPTION_TYPES) {
      const { howToFix } = attendanceExceptionCopy(type);
      expect(
        labels.some((label) => howToFix.includes(label)),
        `${type} guidance names no actual outcome button`
      ).toBe(true);
    }
  });

  it("maps the two enum values that were previously mis-keyed", () => {
    expect(attendanceExceptionCopy("LATE_ARRIVAL").title).toBe("Late arrival");
    expect(attendanceExceptionCopy("EARLY_DEPARTURE").title).toBe("Early departure");
  });

  it("describes the detection response using scanned and created counts", () => {
    expect(attendanceExceptionScanCopy({ scanned: 12, created: 2 })).toBe(
      "Scan complete: 2 new attendance issues found across 12 shifts checked."
    );
    expect(attendanceExceptionScanCopy({ scanned: 1, created: 1 })).toBe(
      "Scan complete: 1 new attendance issue found across 1 shift checked."
    );
  });
});
