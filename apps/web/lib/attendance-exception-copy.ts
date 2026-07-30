export type AttendanceExceptionAction = "approve" | "reject" | "resolve" | "under_review" | "mark_absent";

export const ATTENDANCE_EXCEPTION_ACTIONS: Array<{
  action: AttendanceExceptionAction;
  label: string;
  description: string;
  danger?: boolean;
}> = [
  { action: "approve", label: "Confirm issue", description: "The issue is valid and has been acknowledged." },
  {
    action: "mark_absent",
    label: "Classify issue as absence",
    description: "Classify and close this issue as an absence. This does not change the attendance record.",
  },
  { action: "resolve", label: "Attendance corrected", description: "The attendance record was fixed and no further action is needed." },
  { action: "under_review", label: "Follow up later", description: "Keep the issue open while a supervisor investigates." },
  { action: "reject", label: "Dismiss issue", description: "The detected issue is not valid.", danger: true },
];

/**
 * Keys must match the `AttendanceExceptionType` enum in prisma/schema.prisma.
 * `howToFix` is the operator-facing remedy shown when an issue blocks payroll.
 */
const EXCEPTION_COPY: Record<
  string,
  { title: string; description: string; howToFix: string }
> = {
  MISSED_CLOCK_IN: {
    title: "Missing clock-in",
    description: "No clock-in was recorded for a scheduled shift.",
    howToFix:
      "Check the site timesheet or ask the supervisor what time the guard actually started. If they worked, capture the correct clock-in and mark the issue Attendance corrected. If they never arrived, use Classify issue as absence.",
  },
  MISSED_CLOCK_OUT: {
    title: "Missing clock-out",
    description: "The shift started, but no clock-out was recorded.",
    howToFix:
      "Confirm when the guard went off post and capture the clock-out, then mark the issue Attendance corrected. Left unresolved, the shift has no end time and hours cannot be costed.",
  },
  LATE_ARRIVAL: {
    title: "Late arrival",
    description: "The recorded clock-in was later than the allowed arrival window.",
    howToFix:
      "If the late clock-in is accurate, use Confirm issue — the shorter hours will be paid as recorded. If the guard was on post earlier and the clock-in is wrong, correct the time and mark it Attendance corrected.",
  },
  EARLY_DEPARTURE: {
    title: "Early departure",
    description: "The recorded clock-out was earlier than the scheduled end time.",
    howToFix:
      "If the guard genuinely left early, use Confirm issue. If a reliever took over or the clock-out is wrong, correct the record and mark it Attendance corrected.",
  },
  ABSENT: {
    title: "Possible absence",
    description: "The guard was scheduled but may not have worked this shift.",
    howToFix:
      "Confirm with the site supervisor. If the guard did not work, use Classify issue as absence so the shift is not paid. If they did work but were never clocked in, capture the attendance and mark it Attendance corrected. If approved leave covers the day, record the leave first.",
  },
  OUTSIDE_GEOFENCE: {
    title: "Clock-in outside site boundary",
    description: "The clock-in location fell outside the site's allowed radius.",
    howToFix:
      "Check whether the guard was genuinely off-site or the site's geofence radius is too tight. Use Confirm issue for a real breach, or Dismiss issue if the geofence is misconfigured — then widen the radius on the site record.",
  },
  UNSCHEDULED_CLOCK_IN: {
    title: "Unscheduled clock-in",
    description: "A clock-in was recorded against a shift the guard was not rostered for.",
    howToFix:
      "Confirm whether the guard covered the post. If so, add the shift to the roster and mark the issue Attendance corrected. If not, Dismiss issue.",
  },
  PENDING_SUPERVISOR_REVIEW: {
    title: "Awaiting supervisor review",
    description: "The record was flagged for a supervisor to confirm before payroll.",
    howToFix:
      "Ask the site supervisor to confirm the hours, then mark the issue Attendance corrected or Confirm issue as appropriate.",
  },
  MANUAL_ADJUSTMENT_REQUIRED: {
    title: "Manual adjustment required",
    description: "The record cannot be resolved automatically and needs a manual correction.",
    howToFix:
      "Open the attendance record, correct the hours by hand, then mark the issue Attendance corrected.",
  },
  SHIFT_NOT_FOUND: {
    title: "No matching shift",
    description: "A clock event could not be matched to any rostered shift.",
    howToFix:
      "Add the missing shift to the roster so the clock event can attach to it, then mark the issue Attendance corrected. If the clock event was a mistake, Dismiss issue.",
  },
  DUPLICATE_CLOCK_EVENT: {
    title: "Duplicate clock event",
    description: "The same clock event was recorded more than once.",
    howToFix:
      "Delete the duplicate so the shift is not counted twice, then mark the issue Attendance corrected.",
  },
};

const GENERIC_HOW_TO_FIX =
  "Open the issue, check the attendance record against what actually happened on site, then choose the outcome that matches — correct the record, confirm the issue, or dismiss it.";

export function attendanceExceptionCopy(type: string) {
  return (
    EXCEPTION_COPY[type] ?? {
      title: type.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      description: "Review the attendance details and choose the outcome that best describes what happened.",
      howToFix: GENERIC_HOW_TO_FIX,
    }
  );
}

export function attendanceExceptionScanCopy(result: { scanned: number; created: number }): string {
  const issueLabel = result.created === 1 ? "issue" : "issues";
  const shiftLabel = result.scanned === 1 ? "shift" : "shifts";
  return `Scan complete: ${result.created} new attendance ${issueLabel} found across ${result.scanned} ${shiftLabel} checked.`;
}
