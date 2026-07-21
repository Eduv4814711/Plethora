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

const EXCEPTION_COPY: Record<string, { title: string; description: string }> = {
  MISSED_CLOCK_IN: { title: "Missing clock-in", description: "No clock-in was recorded for a scheduled shift." },
  MISSED_CLOCK_OUT: { title: "Missing clock-out", description: "The shift started, but no clock-out was recorded." },
  LATE_CLOCK_IN: { title: "Late arrival", description: "The recorded clock-in was later than the allowed arrival window." },
  EARLY_CLOCK_OUT: { title: "Early departure", description: "The recorded clock-out was earlier than the scheduled end time." },
  ABSENT: { title: "Possible absence", description: "The guard was scheduled but may not have worked this shift." },
};

export function attendanceExceptionCopy(type: string) {
  return EXCEPTION_COPY[type] ?? {
    title: type.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    description: "Review the attendance details and choose the outcome that best describes what happened.",
  };
}

export function attendanceExceptionScanCopy(result: { scanned: number; created: number }): string {
  const issueLabel = result.created === 1 ? "issue" : "issues";
  const shiftLabel = result.scanned === 1 ? "shift" : "shifts";
  return `Scan complete: ${result.created} new attendance ${issueLabel} found across ${result.scanned} ${shiftLabel} checked.`;
}
