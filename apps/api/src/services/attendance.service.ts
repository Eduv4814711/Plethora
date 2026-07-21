import type { Site } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import { siteHasGeofence, toGeoNumber, haversineMeters } from "../lib/geo.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../lib/timezone.js";
import { normalizeLeaveDate } from "./leave-availability.service.js";

export class AttendanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceValidationError";
  }
}

const CLOCK_IN_WINDOW_MS = config.attendance.clockInWindowMinutes * 60 * 1000;

export async function findApprovedLeaveConflict(companyId: string, employeeId: string, leaveDate: Date) {
  const [occurrence, application, legacyRecord] = await Promise.all([
    prisma.leaveOccurrence.findFirst({
      where: {
        companyId,
        employeeId,
        leaveDate,
        status: { in: ["APPROVED", "PAYROLL_PROCESSED"] },
      },
      select: { id: true, applicationId: true },
    }),
    prisma.leaveApplication.findFirst({
      where: {
        companyId,
        employeeId,
        startDate: { lte: leaveDate },
        endDate: { gte: leaveDate },
        status: { in: ["APPROVED", "CANCELLATION_REQUESTED", "PAYROLL_PROCESSED", "ADJUSTMENT_REQUIRED", "IMPORTED_APPROVED"] },
      },
      select: { id: true },
    }),
    prisma.leaveRecord.findFirst({
      where: { employeeId, employee: { companyId }, date: leaveDate },
      select: { id: true },
    }),
  ]);
  return occurrence || application || legacyRecord ? { occurrence, application, legacyRecord } : null;
}

export async function validateClockIn(
  shiftId: string,
  companyId: string
): Promise<{ shift: { id: string; startTime: Date; endTime: Date } }> {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, companyId },
  });

  if (!shift) {
    throw new AttendanceValidationError("Shift not found");
  }

  const timeZone = await getCompanyTimezone(companyId);
  const shiftDate = normalizeLeaveDate(dateKeyInTimeZone(shift.startTime, timeZone));
  if (await findApprovedLeaveConflict(companyId, shift.employeeId, shiftDate)) {
    throw new AttendanceValidationError(
      "Employee is on approved leave. Cancel or adjust the leave before recording attendance."
    );
  }

  if (shift.status !== "assigned" && shift.status !== "active" && shift.status !== "created") {
    throw new AttendanceValidationError(
      `Shift must be created, assigned, or active to clock in. Current status: ${shift.status}`
    );
  }

  const existing = await prisma.attendance.findFirst({
    where: { shiftId, clockIn: { not: null } },
  });

  if (existing) {
    throw new AttendanceValidationError("Attendance has already been recorded for this shift");
  }

  const now = new Date();
  const windowStart = new Date(shift.startTime.getTime() - CLOCK_IN_WINDOW_MS);

  if (now < windowStart) {
    throw new AttendanceValidationError(
      `Clock-in allowed from ${windowStart.toISOString()} (${config.attendance.clockInWindowMinutes} min before shift)`
    );
  }

  if (now > shift.endTime) {
    throw new AttendanceValidationError(
      "Clock-in window ended. Cannot clock in after shift end time."
    );
  }

  return { shift };
}

/**
 * Compute standard and overtime hours from clock times.
 * Standard hours = time from max(clockIn, shiftStart) to min(clockOut, shiftEnd).
 * Overtime = time worked after scheduled shift end.
 */
export function calculateHours(
  clockIn: Date,
  clockOut: Date,
  shiftStartTime: Date,
  shiftEndTime: Date
): { hoursWorked: number; overtimeHours: number } {
  const msPerHour = 1000 * 60 * 60;
  const payableStartMs = Math.max(clockIn.getTime(), shiftStartTime.getTime());
  const standardEndMs = Math.min(clockOut.getTime(), shiftEndTime.getTime());
  const standardHours = Math.max(0, (standardEndMs - payableStartMs) / msPerHour);

  let overtimeHours = 0;
  if (clockOut.getTime() > shiftEndTime.getTime()) {
    overtimeHours = (clockOut.getTime() - shiftEndTime.getTime()) / msPerHour;
  }

  return {
    hoursWorked: Math.round(standardHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
  };
}

/** Throws if the point is outside the site geofence. No-op if geofence is not configured on the site. */
export function assertWithinSiteGeofence(site: Site, lat: number, lng: number): void {
  if (!siteHasGeofence(site)) return;

  const centerLat = toGeoNumber(site.latitude);
  const centerLng = toGeoNumber(site.longitude);
  const radius = site.geofenceRadiusMeters;
  if (centerLat == null || centerLng == null || radius == null || radius <= 0) return;

  const d = haversineMeters(centerLat, centerLng, lat, lng);
  if (d > radius) {
    throw new AttendanceValidationError(
      `You must be within ${radius}m of the site to clock in or out. (${Math.round(d)}m away)`
    );
  }
}
