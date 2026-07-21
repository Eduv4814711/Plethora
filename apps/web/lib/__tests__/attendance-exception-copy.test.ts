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

  it("describes the detection response using scanned and created counts", () => {
    expect(attendanceExceptionScanCopy({ scanned: 12, created: 2 })).toBe(
      "Scan complete: 2 new attendance issues found across 12 shifts checked."
    );
    expect(attendanceExceptionScanCopy({ scanned: 1, created: 1 })).toBe(
      "Scan complete: 1 new attendance issue found across 1 shift checked."
    );
  });
});
