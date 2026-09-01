import type {
  AttendanceExceptionType,
  ExceptionSeverity,
} from "@prisma/client";

export const DEFAULT_GRACE_MINUTES = 15;
export const ABSENT_THRESHOLD_MINUTES = 120;

export type ShiftClockSnapshot = {
  shiftId: string;
  employeeId: string | null;
  siteId: string | null;
  scheduledStart: Date;
  scheduledEnd: Date;
  clockIn: Date | null;
  clockOut: Date | null;
  clockInLat?: number | null;
  clockInLng?: number | null;
  geofenceLat?: number | null;
  geofenceLng?: number | null;
  geofenceRadiusMeters?: number | null;
  now?: Date;
};

export type DetectedException = {
  exceptionType: AttendanceExceptionType;
  severity: ExceptionSeverity;
  description: string;
  minutesLate?: number;
  minutesEarly?: number;
  dedupeKey: string;
};

export type ShiftAttendanceResolution = {
  sourceShiftId?: string | null;
  siteId?: string | null;
  workDate?: Date | string | null;
  plannedGuardId?: string | null;
  approvalStatus: string;
  actualGuardId?: string | null;
  attendanceStatus: string;
  plannedShiftType?: string | null;
  actualShiftType?: string | null;
};

export type ShiftAttendanceResolutionTarget = {
  id: string;
  employeeId?: string | null;
  siteId?: string | null;
  workDateKey: string;
  shiftType?: string | null;
};

const COVERED_ATTENDANCE_STATUSES = new Set([
  "present",
  "late",
  "left_early",
  "reliever",
  "shift_swapped",
]);

function resolutionDateKey(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

/**
 * Older and manually-added timesheet rows do not always retain sourceShiftId.
 * Fall back to the same site/date/shift plus either the scheduled or actual guard
 * so an approved swap or reliever record remains authoritative.
 */
export function attendanceResolutionAppliesToShift(
  shift: ShiftAttendanceResolutionTarget,
  row: ShiftAttendanceResolution
): boolean {
  if (row.sourceShiftId === shift.id) return true;
  if (!shift.employeeId || !shift.siteId) return false;
  if (row.siteId !== shift.siteId || resolutionDateKey(row.workDate) !== shift.workDateKey) {
    return false;
  }
  if (row.actualGuardId !== shift.employeeId && row.plannedGuardId !== shift.employeeId) {
    return false;
  }
  if (!shift.shiftType) return true;
  return row.actualShiftType === shift.shiftType || row.plannedShiftType === shift.shiftType;
}

/**
 * Manual attendance review is authoritative over automated clock exceptions.
 * A verified shift, an approved/reviewed timesheet row, or a row showing that
 * somebody covered the shift must not produce another attendance exception.
 */
export function attendanceSupersedesShiftExceptions(
  shiftStatus: string,
  rows: ShiftAttendanceResolution[]
): boolean {
  if (shiftStatus === "verified") return true;
  return rows.some(
    (row) =>
      row.approvalStatus === "reviewed" ||
      row.approvalStatus === "approved" ||
      (Boolean(row.actualGuardId) && COVERED_ATTENDANCE_STATUSES.has(row.attendanceStatus))
  );
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 60_000);
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Detect attendance exceptions for a single shift/clock snapshot.
 * Pure function — safe to unit test without DB.
 */
export function detectExceptionsForShift(
  snap: ShiftClockSnapshot,
  graceMinutes = DEFAULT_GRACE_MINUTES
): DetectedException[] {
  const now = snap.now ?? new Date();
  const out: DetectedException[] = [];
  const sid = snap.shiftId;

  // Outside geofence on clock-in
  if (
    snap.clockIn &&
    snap.clockInLat != null &&
    snap.clockInLng != null &&
    snap.geofenceLat != null &&
    snap.geofenceLng != null &&
    snap.geofenceRadiusMeters != null &&
    snap.geofenceRadiusMeters > 0
  ) {
    const dist = haversineMeters(
      snap.geofenceLat,
      snap.geofenceLng,
      snap.clockInLat,
      snap.clockInLng
    );
    if (dist > snap.geofenceRadiusMeters) {
      out.push({
        exceptionType: "OUTSIDE_GEOFENCE",
        severity: "MEDIUM",
        description: `Clock-in was ${Math.round(dist)}m from site (allowed ${snap.geofenceRadiusMeters}m)`,
        dedupeKey: `OUTSIDE_GEOFENCE:shift:${sid}`,
      });
    }
  }

  // Late arrival
  if (snap.clockIn) {
    const late = minutesBetween(snap.clockIn, snap.scheduledStart);
    if (late > graceMinutes) {
      out.push({
        exceptionType: "LATE_ARRIVAL",
        severity: late > 60 ? "CRITICAL" : "MEDIUM",
        description: `Guard clocked in ${late} minutes late`,
        minutesLate: late,
        dedupeKey: `LATE_ARRIVAL:shift:${sid}`,
      });
    }
  }

  // Early departure
  if (snap.clockOut) {
    const early = minutesBetween(snap.scheduledEnd, snap.clockOut);
    if (early > graceMinutes) {
      out.push({
        exceptionType: "EARLY_DEPARTURE",
        severity: early > 60 ? "CRITICAL" : "MEDIUM",
        description: `Guard clocked out ${early} minutes early`,
        minutesEarly: early,
        dedupeKey: `EARLY_DEPARTURE:shift:${sid}`,
      });
    }
  }

  const pastStartGrace =
    now.getTime() > snap.scheduledStart.getTime() + graceMinutes * 60_000;
  const pastEndGrace =
    now.getTime() > snap.scheduledEnd.getTime() + graceMinutes * 60_000;
  const pastAbsent =
    now.getTime() >
    snap.scheduledStart.getTime() + ABSENT_THRESHOLD_MINUTES * 60_000;

  // Missed clock-in
  if (!snap.clockIn && pastStartGrace && !pastAbsent) {
    out.push({
      exceptionType: "MISSED_CLOCK_IN",
      severity: "CRITICAL",
      description: "Guard missed clock-in for scheduled shift",
      dedupeKey: `MISSED_CLOCK_IN:shift:${sid}`,
    });
  }

  // Absent (no clock-in after longer threshold)
  if (!snap.clockIn && pastAbsent) {
    out.push({
      exceptionType: "ABSENT",
      severity: "CRITICAL",
      description: "No attendance recorded — marked absent",
      dedupeKey: `ABSENT:shift:${sid}`,
    });
  }

  // Missed clock-out
  if (snap.clockIn && !snap.clockOut && pastEndGrace) {
    out.push({
      exceptionType: "MISSED_CLOCK_OUT",
      severity: "MEDIUM",
      description: "Guard missed clock-out after shift ended",
      dedupeKey: `MISSED_CLOCK_OUT:shift:${sid}`,
    });
  }

  return out;
}

export function exceptionTypeLabel(type: AttendanceExceptionType): string {
  const labels: Record<AttendanceExceptionType, string> = {
    LATE_ARRIVAL: "Late arrival",
    EARLY_DEPARTURE: "Early departure",
    MISSED_CLOCK_IN: "Missed clock-in",
    MISSED_CLOCK_OUT: "Missed clock-out",
    ABSENT: "Absent",
    OUTSIDE_GEOFENCE: "Outside geofence",
    UNSCHEDULED_CLOCK_IN: "Unscheduled clock-in",
    PENDING_SUPERVISOR_REVIEW: "Pending supervisor review",
    MANUAL_ADJUSTMENT_REQUIRED: "Manual adjustment required",
    SHIFT_NOT_FOUND: "Shift not found",
    DUPLICATE_CLOCK_EVENT: "Duplicate clock event",
  };
  return labels[type] ?? type;
}
