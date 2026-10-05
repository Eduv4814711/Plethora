import { DEFAULT_GRACE_MINUTES } from "../attendance-exceptions/exception-detection.js";

/**
 * The single controller-facing status for one rostered guard on one shift.
 *
 * This is DERIVED from Roster (shift window) + Attendance (clock events) and is
 * never stored, so it cannot drift from the records payroll reads. It uses the
 * same grace rules as exception detection so the two always agree.
 */
export type ControllerAttendanceStatus =
  | "scheduled"
  | "clocked_in"
  | "clocked_out"
  | "missing_clock_in"
  | "missing_clock_out"
  | "absent"
  | "requires_review";

export type CaptureMethod = "whatsapp" | "manual" | "rest" | "none";

export interface AttendanceStatusInput {
  shiftStart: Date;
  shiftEnd: Date;
  clockIn: Date | null;
  clockOut: Date | null;
  /** Attendance.validationStatus, e.g. VERIFIED | REJECTED_GEOFENCE | FLAGGED_NO_GEOFENCE | MANUAL_OVERRIDE */
  validationStatus?: string | null;
  /** Attendance.source, "manual" for controller capture. */
  source?: string | null;
  whatsappMessageId?: string | null;
  /** A controller has confirmed this guard did not report for the shift. */
  confirmedAbsent?: boolean;
  /** An open, non-routine exception (geofence, unscheduled, duplicate...) needs a human. */
  hasBlockingException?: boolean;
  now?: Date;
  graceMinutes?: number;
}

export interface DerivedAttendanceStatus {
  status: ControllerAttendanceStatus;
  late: boolean;
  earlyDeparture: boolean;
  minutesLate: number | null;
  minutesEarly: number | null;
  manuallyAdjusted: boolean;
  captureMethod: CaptureMethod;
  /** True when the controller must do something. Completed rows are false. */
  needsAction: boolean;
}

const MS_PER_MINUTE = 60_000;

export function deriveCaptureMethod(input: {
  source?: string | null;
  whatsappMessageId?: string | null;
  validationStatus?: string | null;
  hasAttendance: boolean;
}): CaptureMethod {
  if (!input.hasAttendance) return "none";
  if (input.source === "manual" || input.validationStatus === "MANUAL_OVERRIDE") return "manual";
  if (input.whatsappMessageId) return "whatsapp";
  // WhatsApp location-first clock-ins may not carry a wamid, but REST clocks use source "clock_in".
  if (input.source === "clock_in") return "rest";
  return "whatsapp";
}

export function deriveAttendanceStatus(input: AttendanceStatusInput): DerivedAttendanceStatus {
  const now = input.now ?? new Date();
  const grace = input.graceMinutes ?? DEFAULT_GRACE_MINUTES;
  const { shiftStart, shiftEnd, clockIn, clockOut } = input;

  const minutesLate = clockIn
    ? Math.max(0, Math.round((clockIn.getTime() - shiftStart.getTime()) / MS_PER_MINUTE))
    : null;
  const minutesEarly = clockOut
    ? Math.max(0, Math.round((shiftEnd.getTime() - clockOut.getTime()) / MS_PER_MINUTE))
    : null;
  const late = minutesLate !== null && minutesLate > grace;
  const earlyDeparture = minutesEarly !== null && minutesEarly > grace;

  const rejected = input.validationStatus === "REJECTED_GEOFENCE" && !clockIn;
  const manuallyAdjusted = input.source === "manual" || input.validationStatus === "MANUAL_OVERRIDE";
  const captureMethod = deriveCaptureMethod({
    source: input.source,
    whatsappMessageId: input.whatsappMessageId,
    validationStatus: input.validationStatus,
    hasAttendance: Boolean(clockIn || clockOut || input.validationStatus),
  });

  let status: ControllerAttendanceStatus;
  if (rejected) {
    status = "requires_review";
  } else if (!clockIn) {
    if (input.confirmedAbsent) status = "absent";
    else if (now.getTime() > shiftStart.getTime() + grace * MS_PER_MINUTE) status = "missing_clock_in";
    else status = "scheduled";
  } else if (!clockOut) {
    status =
      now.getTime() > shiftEnd.getTime() + grace * MS_PER_MINUTE ? "missing_clock_out" : "clocked_in";
  } else {
    status = "clocked_out";
  }

  if (input.hasBlockingException && (status === "clocked_in" || status === "clocked_out")) {
    status = "requires_review";
  }

  const needsAction =
    status === "missing_clock_in" || status === "missing_clock_out" || status === "requires_review";

  return { status, late, earlyDeparture, minutesLate, minutesEarly, manuallyAdjusted, captureMethod, needsAction };
}

/**
 * The SiteTimesheetRow attendance value for a clocked guard. Payroll pays these
 * statuses identically ("present" | "late" | "left_early"), so this only improves
 * what the controller sees and never changes pay.
 */
export function deriveTimesheetAttendanceStatus(input: {
  shiftStart: Date;
  shiftEnd: Date;
  clockIn: Date | null;
  clockOut: Date | null;
  graceMinutes?: number;
}): "present" | "late" | "left_early" {
  const grace = input.graceMinutes ?? DEFAULT_GRACE_MINUTES;
  if (input.clockOut) {
    const early = Math.round((input.shiftEnd.getTime() - input.clockOut.getTime()) / MS_PER_MINUTE);
    if (early > grace) return "left_early";
  }
  if (input.clockIn) {
    const late = Math.round((input.clockIn.getTime() - input.shiftStart.getTime()) / MS_PER_MINUTE);
    if (late > grace) return "late";
  }
  return "present";
}
