import { prisma } from "../../lib/prisma.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../../lib/timezone.js";
import { deriveTimesheetAttendanceStatus } from "./attendance-status.js";

export type TimesheetSyncOutcome = "synced" | "locked" | "no_row" | "status_conflict";

interface SyncShift {
  id: string;
  companyId: string;
  siteId: string;
  employeeId: string;
  startTime: Date;
  endTime: Date;
}

interface SyncAttendance {
  id: string;
  clockIn: Date | null;
  clockOut: Date | null;
  hoursWorked: unknown;
  overtimeHours: unknown;
}

const LOCKED_TIMESHEET_STATUSES = new Set(["approved", "locked"]);
/** Statuses that are plain "the guard worked" and safe to refine to late/left_early. */
const WORKED_ROW_STATUSES = new Set(["pending", "present", "late", "left_early"]);

/**
 * Copy a shift's attendance onto the draft SiteTimesheetRow the controller reviews.
 *
 * Attendance stays the source of the clock facts; the row is only updated while it is
 * still a draft. An approved/locked row is NEVER touched (payroll already trusts it),
 * and the caller is told so it can raise an exception instead of silently losing hours.
 *
 * The work date is the shift's start date in the COMPANY timezone. Using the UTC date
 * would mis-file early-morning SAST starts onto the previous day.
 */
export async function syncAttendanceToTimesheetRow(
  shift: SyncShift,
  attendance: SyncAttendance
): Promise<TimesheetSyncOutcome> {
  const timeZone = await getCompanyTimezone(shift.companyId);
  const workDate = new Date(`${dateKeyInTimeZone(shift.startTime, timeZone)}T00:00:00.000Z`);

  const row = await prisma.siteTimesheetRow.findFirst({
    where: {
      OR: [
        { sourceShiftId: shift.id },
        { siteId: shift.siteId, workDate, plannedGuardId: shift.employeeId },
      ],
    },
    include: { siteTimesheet: { select: { status: true } } },
  });
  if (!row) return "no_row";

  const sheetStatus = String(row.siteTimesheet?.status ?? "");
  if (row.approvalStatus === "approved" || LOCKED_TIMESHEET_STATUSES.has(sheetStatus)) return "locked";

  const clockIn = attendance.clockIn ?? row.clockIn;
  const clockOut = attendance.clockOut ?? row.clockOut;
  const canRefineStatus = !row.attendanceStatus || WORKED_ROW_STATUSES.has(row.attendanceStatus);

  await prisma.siteTimesheetRow.update({
    where: { id: row.id },
    data: {
      actualGuardId: shift.employeeId,
      clockIn,
      clockOut,
      hoursWorked: (attendance.hoursWorked as never) ?? row.hoursWorked,
      overtimeHours: (attendance.overtimeHours as never) ?? row.overtimeHours,
      sourceAttendanceId: attendance.id,
      sourceShiftId: shift.id,
      ...(canRefineStatus
        ? {
            attendanceStatus: deriveTimesheetAttendanceStatus({
              shiftStart: shift.startTime,
              shiftEnd: shift.endTime,
              clockIn,
              clockOut,
            }),
          }
        : {}),
    },
  });

  return canRefineStatus ? "synced" : "status_conflict";
}
