import type { Site } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import { siteHasGeofence, toGeoNumber, haversineMeters } from "../lib/geo.js";

export class AttendanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceValidationError";
  }
}

const CLOCK_IN_WINDOW_MS = config.attendance.clockInWindowMinutes * 60 * 1000;

export async function validateClockIn(
  shiftId: string,
  companyId: string
): Promise<{
  shift: { id: string; startTime: Date; endTime: Date };
}> {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, companyId },
  });

  if (!shift) {
    throw new AttendanceValidationError("Shift not found");
  }

  if (shift.status !== "assigned" && shift.status !== "active") {
    throw new AttendanceValidationError(
      `Shift must be assigned or active to clock in. Current status: ${shift.status}`
    );
  }

  const existing = await prisma.attendance.findFirst({
    where: { shiftId, clockIn: { not: null }, clockOut: null },
  });

  if (existing) {
    throw new AttendanceValidationError("Already clocked in for this shift");
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

export function calculateHours(
  clockOut: Date,
  shiftStartTime: Date,
  shiftEndTime: Date
): { hoursWorked: number; overtimeHours: number } {
  const shiftDurationMs = shiftEndTime.getTime() - shiftStartTime.getTime();
  const shiftDurationHours = shiftDurationMs / (1000 * 60 * 60);

  const standardEnd = shiftEndTime.getTime();
  const clockOutMs = clockOut.getTime();

  let overtimeHours = 0;
  if (clockOutMs > standardEnd) {
    overtimeHours = (clockOutMs - standardEnd) / (1000 * 60 * 60);
  }

  return {
    hoursWorked: Math.round(shiftDurationHours * 100) / 100,
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
