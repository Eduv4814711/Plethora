import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";

export class AttendanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceValidationError";
  }
}

const CLOCK_IN_WINDOW_MS = config.attendance.clockInWindowMinutes * 60 * 1000;

export async function validateClockIn(shiftId: string): Promise<{
  shift: { id: string; startTime: Date; endTime: Date };
}> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
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
  const windowEnd = new Date(shift.startTime.getTime() + CLOCK_IN_WINDOW_MS);

  if (now < windowStart) {
    throw new AttendanceValidationError(
      `Clock-in allowed from ${windowStart.toISOString()} (30 min before shift)`
    );
  }

  if (now > windowEnd) {
    throw new AttendanceValidationError(
      `Clock-in window ended at ${windowEnd.toISOString()}`
    );
  }

  return { shift };
}

export function calculateHours(
  clockIn: Date,
  clockOut: Date,
  shiftEndTime: Date
): { hoursWorked: number; overtimeHours: number } {
  const totalMs = clockOut.getTime() - clockIn.getTime();
  const totalHours = totalMs / (1000 * 60 * 60);

  const standardEnd = shiftEndTime.getTime();
  const clockOutMs = clockOut.getTime();

  let overtimeHours = 0;
  if (clockOutMs > standardEnd) {
    overtimeHours = (clockOutMs - standardEnd) / (1000 * 60 * 60);
  }

  const regularHours = Math.max(0, totalHours - overtimeHours);

  return {
    hoursWorked: Math.round(regularHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
  };
}
