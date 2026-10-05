import { prisma } from "../../lib/prisma.js";
import { haversineDistance, toGeoNumber } from "../../lib/geo.js";
import { calculateHours } from "../../services/attendance.service.js";
import { triggerPostClockExceptionSync } from "../../modules/attendance-exceptions/post-clock-sync.js";
import { createAuditLog } from "../../lib/audit.js";
import { operationalEventBus } from "../../lib/events.js";
import type { Shift, Site, Attendance, Employee } from "@prisma/client";

export type ShiftWithRelations = Shift & {
  site: Site | null;
  employee?: Employee;
  attendances?: Attendance[];
};

export interface OperationalAttendancePayload {
  employeeId: string;
  latitude: number;
  longitude: number;
  intent?: "clock_in" | "clock_out";
  whatsappMessageId?: string | null;
  whatsappNumber?: string | null;
  timestamp?: Date;
}

export type OperationalAttendanceValidationStatus =
  | "VERIFIED"
  | "REJECTED_GEOFENCE"
  | "FLAGGED_NO_GEOFENCE"
  | "MANUAL_OVERRIDE";

export interface OperationalAttendanceResult {
  success: boolean;
  validationStatus?: OperationalAttendanceValidationStatus;
  status: string;
  message: string;
  distanceMeters?: number | null;
  geofenceRadiusMeters?: number | null;
  attendance?: Attendance;
  shift?: ShiftWithRelations;
}

const OPERATING_WINDOW_HOURS = 2;
const OPERATING_WINDOW_MS = OPERATING_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * Look up the officer's roster shift for the given date, allowing a ±2 hour
 * operating window around shift start/end times.
 */
export async function findActiveRosterShift(
  employeeId: string,
  date: Date = new Date()
): Promise<ShiftWithRelations | null> {
  const windowStart = new Date(date.getTime() - OPERATING_WINDOW_MS);
  const windowEnd = new Date(date.getTime() + OPERATING_WINDOW_MS);

  // A shift is active/accessible if its scheduled operating window overlaps the current time:
  // startTime - 2h <= date <= endTime + 2h
  const shifts = await prisma.shift.findMany({
    where: {
      employeeId,
      startTime: { lte: windowEnd },
      endTime: { gte: windowStart },
    },
    include: {
      site: true,
      employee: true,
      attendances: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { startTime: "asc" },
  });

  if (shifts.length === 0) {
    return null;
  }

  if (shifts.length === 1) {
    return shifts[0]!;
  }

  // If multiple shifts overlap, pick the one closest to current time
  let closestShift = shifts[0]!;
  let smallestDiff = Infinity;
  for (const s of shifts) {
    const diff = Math.min(
      Math.abs(date.getTime() - s.startTime.getTime()),
      Math.abs(date.getTime() - s.endTime.getTime())
    );
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closestShift = s;
    }
  }

  return closestShift;
}

/**
 * Validate GPS geofence against site coordinates and record operational attendance.
 */
export async function validateAndRecordOperationalAttendance(
  payload: OperationalAttendancePayload
): Promise<OperationalAttendanceResult> {
  const now = payload.timestamp ?? new Date();

  // 1. Identity Resolution & Active Check
  const employee = await prisma.employee.findUnique({
    where: { id: payload.employeeId },
  });

  if (!employee || employee.status.toLowerCase() !== "active") {
    return {
      success: false,
      status: "REJECTED",
      message: "❌ Employee profile is not active or could not be verified.",
    };
  }

  // 2. Find Active Roster Shift (±2 hours)
  const shift = await findActiveRosterShift(payload.employeeId, now);
  if (!shift) {
    return {
      success: false,
      status: "NO_SHIFT",
      message: `❌ No rostered shift found within the ±${OPERATING_WINDOW_HOURS}-hour operating window.`,
    };
  }

  const existingAttendance = await prisma.attendance.findFirst({
    where: { shiftId: shift.id },
  });

  // 3. Resolve Intent
  let intent = payload.intent;
  if (!intent) {
    if (
      existingAttendance &&
      existingAttendance.clockIn &&
      !existingAttendance.clockOut &&
      existingAttendance.validationStatus !== "REJECTED_GEOFENCE"
    ) {
      intent = "clock_out";
    } else {
      intent = "clock_in";
    }
  }

  // 4. Duplicate Clock Logic
  if (intent === "clock_in") {
    if (
      existingAttendance &&
      existingAttendance.clockIn &&
      !existingAttendance.clockOut &&
      existingAttendance.validationStatus !== "REJECTED_GEOFENCE"
    ) {
      return {
        success: false,
        status: "DUPLICATE",
        message: "⚠️ You are already clocked in for this shift.",
        shift,
        attendance: existingAttendance,
      };
    }
    if (
      existingAttendance &&
      existingAttendance.clockIn &&
      existingAttendance.clockOut &&
      existingAttendance.validationStatus !== "REJECTED_GEOFENCE"
    ) {
      return {
        success: false,
        status: "DUPLICATE",
        message: "⚠️ You have already completed this shift.",
        shift,
        attendance: existingAttendance,
      };
    }
  } else if (intent === "clock_out") {
    if (
      !existingAttendance ||
      !existingAttendance.clockIn ||
      existingAttendance.validationStatus === "REJECTED_GEOFENCE"
    ) {
      return {
        success: false,
        status: "NOT_CLOCKED_IN",
        message: "⚠️ Cannot clock out: no active clock-in was recorded for this shift.",
        shift,
      };
    }
    if (existingAttendance.clockOut) {
      return {
        success: false,
        status: "DUPLICATE",
        message: "⚠️ You have already clocked out for this shift.",
        shift,
        attendance: existingAttendance,
      };
    }
  }

  // 5. Check Site Geofence Coordinates
  const site = shift.site;
  const siteLat = site ? toGeoNumber(site.latitude) : null;
  const siteLon = site ? toGeoNumber(site.longitude) : null;
  const geofenceRadius = site?.geofenceRadiusMeters ?? null;

  // Case A: Missing Site Coordinates -> Accept as FLAGGED_NO_GEOFENCE
  if (siteLat == null || siteLon == null) {
    let attendance: Attendance;
    if (existingAttendance) {
      attendance = await prisma.attendance.update({
        where: { id: existingAttendance.id },
        data: {
          validationStatus: "FLAGGED_NO_GEOFENCE",
          status: "VERIFIED",
          withinGeofence: false,
          submissionLat: payload.latitude,
          submissionLon: payload.longitude,
          distanceMeters: null,
          geofenceRadiusMeters: geofenceRadius,
          whatsappMessageId: payload.whatsappMessageId ?? undefined,
          whatsappNumber: payload.whatsappNumber ?? undefined,
          ...(intent === "clock_in"
            ? {
                clockIn: now,
                clockInLat: payload.latitude,
                clockInLng: payload.longitude,
              }
            : {
                clockOut: now,
                clockOutLat: payload.latitude,
                clockOutLng: payload.longitude,
                ...calculateAttendanceHours(existingAttendance.clockIn ?? now, now, shift.startTime, shift.endTime),
              }),
        },
      });
    } else {
      attendance = await prisma.attendance.create({
        data: {
          shiftId: shift.id,
          clockIn: intent === "clock_in" ? now : null,
          clockOut: intent === "clock_out" ? now : null,
          clockInLat: intent === "clock_in" ? payload.latitude : null,
          clockInLng: intent === "clock_in" ? payload.longitude : null,
          clockOutLat: intent === "clock_out" ? payload.latitude : null,
          clockOutLng: intent === "clock_out" ? payload.longitude : null,
          status: "VERIFIED",
          validationStatus: "FLAGGED_NO_GEOFENCE",
          withinGeofence: false,
          submissionLat: payload.latitude,
          submissionLon: payload.longitude,
          distanceMeters: null,
          geofenceRadiusMeters: geofenceRadius,
          whatsappMessageId: payload.whatsappMessageId ?? null,
          whatsappNumber: payload.whatsappNumber ?? null,
        },
      });
    }

    await prisma.shift.update({
      where: { id: shift.id },
      data: { status: intent === "clock_out" ? "completed" : "active" },
    });

    await syncSiteTimesheetRow(shift, attendance, intent);

    await createAuditLog({
      companyId: shift.companyId,
      action: intent === "clock_out" ? "attendance.clock_out" : "attendance.clock_in",
      entityType: "attendance",
      entityId: attendance.id,
      metadata: {
        source: "whatsapp",
        from: payload.whatsappNumber,
        validationStatus: "FLAGGED_NO_GEOFENCE",
        latitude: payload.latitude,
        longitude: payload.longitude,
      },
    });

    triggerPostClockExceptionSync(shift.companyId, shift.siteId);

    operationalEventBus.broadcast("ATTENDANCE_VERIFIED", shift.companyId, {
      attendanceId: attendance.id,
      shiftId: shift.id,
      siteId: shift.siteId,
      employeeId: shift.employeeId,
      intent,
      validationStatus: "FLAGGED_NO_GEOFENCE",
      status: "VERIFIED",
    });

    const actionText = intent === "clock_out" ? "Clock-out" : "Clock-in";
    return {
      success: true,
      validationStatus: "FLAGGED_NO_GEOFENCE",
      status: "VERIFIED",
      message: `✅ ${actionText} successful. Note: Site has no GPS geofence configured.`,
      attendance,
      shift,
    };
  }

  // Case B: Calculate Distance using Haversine
  const distance = Math.round(haversineDistance(siteLat, siteLon, payload.latitude, payload.longitude));
  const allowedRadius = geofenceRadius ?? 100;
  const isWithin = distance <= allowedRadius;

  // Case B1: Distance <= Site Radius -> VERIFIED
  if (isWithin) {
    let attendance: Attendance;
    if (existingAttendance) {
      attendance = await prisma.attendance.update({
        where: { id: existingAttendance.id },
        data: {
          validationStatus: "VERIFIED",
          status: "VERIFIED",
          withinGeofence: true,
          submissionLat: payload.latitude,
          submissionLon: payload.longitude,
          distanceMeters: distance,
          geofenceRadiusMeters: allowedRadius,
          rejectionReason: null,
          whatsappMessageId: payload.whatsappMessageId ?? undefined,
          whatsappNumber: payload.whatsappNumber ?? undefined,
          ...(intent === "clock_in"
            ? {
                clockIn: now,
                clockInLat: payload.latitude,
                clockInLng: payload.longitude,
              }
            : {
                clockOut: now,
                clockOutLat: payload.latitude,
                clockOutLng: payload.longitude,
                ...calculateAttendanceHours(existingAttendance.clockIn ?? now, now, shift.startTime, shift.endTime),
              }),
        },
      });
    } else {
      attendance = await prisma.attendance.create({
        data: {
          shiftId: shift.id,
          clockIn: intent === "clock_in" ? now : null,
          clockOut: intent === "clock_out" ? now : null,
          clockInLat: intent === "clock_in" ? payload.latitude : null,
          clockInLng: intent === "clock_in" ? payload.longitude : null,
          clockOutLat: intent === "clock_out" ? payload.latitude : null,
          clockOutLng: intent === "clock_out" ? payload.longitude : null,
          status: "VERIFIED",
          validationStatus: "VERIFIED",
          withinGeofence: true,
          submissionLat: payload.latitude,
          submissionLon: payload.longitude,
          distanceMeters: distance,
          geofenceRadiusMeters: allowedRadius,
          whatsappMessageId: payload.whatsappMessageId ?? null,
          whatsappNumber: payload.whatsappNumber ?? null,
        },
      });
    }

    await prisma.shift.update({
      where: { id: shift.id },
      data: { status: intent === "clock_out" ? "completed" : "active" },
    });

    await syncSiteTimesheetRow(shift, attendance, intent);

    await createAuditLog({
      companyId: shift.companyId,
      action: intent === "clock_out" ? "attendance.clock_out" : "attendance.clock_in",
      entityType: "attendance",
      entityId: attendance.id,
      metadata: {
        source: "whatsapp",
        from: payload.whatsappNumber,
        distanceMeters: distance,
        allowedRadius,
        latitude: payload.latitude,
        longitude: payload.longitude,
      },
    });

    triggerPostClockExceptionSync(shift.companyId, shift.siteId);

    operationalEventBus.broadcast("ATTENDANCE_VERIFIED", shift.companyId, {
      attendanceId: attendance.id,
      shiftId: shift.id,
      siteId: shift.siteId,
      employeeId: shift.employeeId,
      intent,
      validationStatus: "VERIFIED",
      status: "VERIFIED",
    });

    const actionText = intent === "clock_out" ? "Clock-out" : "Clock-in";
    return {
      success: true,
      validationStatus: "VERIFIED",
      status: "VERIFIED",
      message: `✅ ${actionText} successful. Distance: ${distance}m (Allowed: ${allowedRadius}m).`,
      distanceMeters: distance,
      geofenceRadiusMeters: allowedRadius,
      attendance,
      shift,
    };
  }

  // Case B2: Distance > Site Radius -> REJECTED_GEOFENCE (do NOT trigger sync)
  const rejectionReason = `You are ${distance}m away. Allowed: ${allowedRadius}m.`;
  let attendance: Attendance;
  if (existingAttendance) {
    attendance = await prisma.attendance.update({
      where: { id: existingAttendance.id },
      data: {
        validationStatus: "REJECTED_GEOFENCE",
        status: "REJECTED_GEOFENCE",
        withinGeofence: false,
        submissionLat: payload.latitude,
        submissionLon: payload.longitude,
        distanceMeters: distance,
        geofenceRadiusMeters: allowedRadius,
        rejectionReason,
        whatsappMessageId: payload.whatsappMessageId ?? undefined,
        whatsappNumber: payload.whatsappNumber ?? undefined,
      },
    });
  } else {
    attendance = await prisma.attendance.create({
      data: {
        shiftId: shift.id,
        status: "REJECTED_GEOFENCE",
        validationStatus: "REJECTED_GEOFENCE",
        withinGeofence: false,
        submissionLat: payload.latitude,
        submissionLon: payload.longitude,
        distanceMeters: distance,
        geofenceRadiusMeters: allowedRadius,
        rejectionReason,
        whatsappMessageId: payload.whatsappMessageId ?? null,
        whatsappNumber: payload.whatsappNumber ?? null,
      },
    });
  }

  // Record AttendanceException for dashboard visibility
  await prisma.attendanceException
    .create({
      data: {
        companyId: shift.companyId,
        attendanceId: attendance.id,
        shiftId: shift.id,
        employeeId: shift.employeeId,
        siteId: shift.siteId,
        exceptionType: "OUTSIDE_GEOFENCE",
        severity: "CRITICAL",
        description: `Clock-${intent === "clock_out" ? "out" : "in"} rejected: Guard is ${distance}m away from site (allowed: ${allowedRadius}m).`,
        dedupeKey: `OUTSIDE_GEOFENCE:${shift.id}:${intent}`,
        status: "OPEN",
      },
    })
    .catch(() => undefined);

  await createAuditLog({
    companyId: shift.companyId,
    action: "attendance.rejected_geofence",
    entityType: "attendance",
    entityId: attendance.id,
    metadata: {
      source: "whatsapp",
      from: payload.whatsappNumber,
      distanceMeters: distance,
      allowedRadius,
      rejectionReason,
      latitude: payload.latitude,
      longitude: payload.longitude,
    },
  });

  const actionText = intent === "clock_out" ? "Clock-out" : "Clock-in";
  return {
    success: false,
    validationStatus: "REJECTED_GEOFENCE",
    status: "REJECTED_GEOFENCE",
    message: `❌ ${actionText} failed. ${rejectionReason}`,
    distanceMeters: distance,
    geofenceRadiusMeters: allowedRadius,
    attendance,
    shift,
  };
}

function calculateAttendanceHours(
  clockIn: Date,
  clockOut: Date,
  shiftStart: Date,
  shiftEnd: Date
): { hoursWorked: number; overtimeHours: number } {
  return calculateHours(clockIn, clockOut, shiftStart, shiftEnd);
}

/**
 * Interface with existing SiteTimesheetRow records to ensure single source of truth.
 */
async function syncSiteTimesheetRow(
  shift: ShiftWithRelations,
  attendance: Attendance,
  intent: "clock_in" | "clock_out"
): Promise<void> {
  try {
    // Find matching site timesheet row either by sourceShiftId or (siteId, workDate, plannedGuardId)
    const row = await prisma.siteTimesheetRow.findFirst({
      where: {
        OR: [
          { sourceShiftId: shift.id },
          {
            siteId: shift.siteId,
            workDate: new Date(new Date(shift.startTime).setUTCHours(0, 0, 0, 0)),
            plannedGuardId: shift.employeeId,
          },
        ],
      },
    });

    if (row && row.approvalStatus !== "approved") {
      await prisma.siteTimesheetRow.update({
        where: { id: row.id },
        data: {
          actualGuardId: shift.employeeId,
          clockIn: attendance.clockIn ?? row.clockIn,
          clockOut: attendance.clockOut ?? row.clockOut,
          hoursWorked: attendance.hoursWorked ?? row.hoursWorked,
          overtimeHours: attendance.overtimeHours ?? row.overtimeHours,
          sourceAttendanceId: attendance.id,
          sourceShiftId: shift.id,
          attendanceStatus: "present",
        },
      });
    }
  } catch (err) {
    console.warn("[OperationalAttendance] Failed to sync SiteTimesheetRow:", err);
  }
}

export const operationalAttendanceService = {
  findActiveRosterShift,
  validateAndRecordOperationalAttendance,
};
