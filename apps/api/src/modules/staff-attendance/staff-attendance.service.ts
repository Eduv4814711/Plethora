import type { Prisma, StaffAttendanceStatus } from "@prisma/client";
import { createAuditLog } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { getCompanyTimezone } from "../../lib/timezone.js";
import { fromZonedTime } from "date-fns-tz";

/**
 * Daily attendance capture for office staff.
 *
 * Guards are captured through the site timesheet, which is tied to a site, a roster and
 * the occurrence book. Office staff have none of those and are paid a fixed monthly
 * salary, so this surface is deliberately minimal: who was here, and optionally when.
 *
 * Nothing here feeds payroll. It exists for leave cross-checks and reporting.
 */

/** Employee types allowed on this surface. Guards must use the site timesheet. */
const OFFICE_EMPLOYEE_TYPE = "general";

/** Statuses that mean the person was actually at work. */
const AT_WORK_STATUSES = new Set<StaffAttendanceStatus>(["present"]);

/** Employees who have left do not appear on a roll call. */
const INACTIVE_EMPLOYEE_STATUSES = ["offboarded", "applicant"];

export type StaffAttendanceFailureCode =
  | "EMPLOYEE_NOT_FOUND"
  | "NOT_OFFICE_STAFF"
  | "ON_APPROVED_LEAVE"
  | "INVALID_TIMES";

export type StaffAttendanceFailure = {
  employeeId: string;
  code: StaffAttendanceFailureCode;
  message: string;
};

const FAILURE_MESSAGES: Record<StaffAttendanceFailureCode, string> = {
  EMPLOYEE_NOT_FOUND: "This employee no longer exists.",
  NOT_OFFICE_STAFF:
    "This person is a security officer. Capture their attendance on the site timesheet instead.",
  ON_APPROVED_LEAVE:
    "This person is on approved leave for this date. Mark them as leave, or cancel the leave first.",
  INVALID_TIMES: "The end time must be after the start time.",
};

export type StaffAttendanceEntry = {
  employeeId: string;
  status: StaffAttendanceStatus;
  timeIn?: string | null;
  timeOut?: string | null;
  notes?: string | null;
};

function dateOnlyUtc(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/** Combine the work date with an HH:mm wall-clock time in company time. */
function toInstant(dateKey: string, time: string | null | undefined, timeZone: string): Date | null {
  if (!time) return null;
  const instant = fromZonedTime(`${dateKey}T${time}:00`, timeZone);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function hoursBetween(timeIn: Date | null, timeOut: Date | null): number | null {
  if (!timeIn || !timeOut) return null;
  const ms = timeOut.getTime() - timeIn.getTime();
  if (ms <= 0) return null;
  return Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
}

/**
 * The roll call for one day: every office employee, with whatever has been captured and
 * any approved leave that covers the date.
 */
export async function getStaffAttendanceDay(
  companyId: string,
  params: { date: string; q?: string }
) {
  const workDate = dateOnlyUtc(params.date);

  const employees = await prisma.employee.findMany({
    where: {
      companyId,
      employeeType: OFFICE_EMPLOYEE_TYPE,
      status: { notIn: INACTIVE_EMPLOYEE_STATUSES as never },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeNumber: true,
      jobRole: true,
      ordinaryHours: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const employeeIds = employees.map((employee) => employee.id);
  const [records, leave] = await Promise.all([
    employeeIds.length > 0
      ? prisma.staffAttendanceDay.findMany({
          where: { companyId, workDate, employeeId: { in: employeeIds } },
        })
      : [],
    employeeIds.length > 0
      ? prisma.leaveRequest.findMany({
          where: {
            companyId,
            status: "APPROVED",
            employeeId: { in: employeeIds },
            startDate: { lte: workDate },
            endDate: { gte: workDate },
          },
          select: { employeeId: true, leaveType: true },
        })
      : [],
  ]);

  const recordByEmployee = new Map(records.map((record) => [record.employeeId, record]));
  const leaveByEmployee = new Map(leave.map((request) => [request.employeeId, request]));

  const query = params.q?.trim().toLowerCase();
  const rows = employees
    .filter((employee) => {
      if (!query) return true;
      return `${employee.firstName} ${employee.lastName} ${employee.employeeNumber ?? ""}`
        .toLowerCase()
        .includes(query);
    })
    .map((employee) => {
      const record = recordByEmployee.get(employee.id);
      const approvedLeave = leaveByEmployee.get(employee.id);
      return {
        employeeId: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        employeeNumber: employee.employeeNumber,
        jobRole: employee.jobRole,
        ordinaryHours: employee.ordinaryHours,
        status: record?.status ?? null,
        timeIn: record?.timeIn?.toISOString() ?? null,
        timeOut: record?.timeOut?.toISOString() ?? null,
        hoursWorked: record?.hoursWorked != null ? Number(record.hoursWorked) : null,
        notes: record?.notes ?? null,
        onApprovedLeave: Boolean(approvedLeave),
        approvedLeaveType: approvedLeave?.leaveType ?? null,
      };
    });

  const counts = {
    present: rows.filter((row) => row.status === "present").length,
    absent: rows.filter((row) => row.status === "absent").length,
    onLeave: rows.filter((row) => row.onApprovedLeave || row.status === "leave" || row.status === "sick_leave")
      .length,
    notCaptured: rows.filter((row) => row.status === null).length,
  };

  return {
    date: params.date,
    rows,
    counts,
    // Drives whether the office tab is offered at all — a pure guarding company has none.
    totalGeneralEmployees: employees.length,
  };
}

/**
 * Validate and write one day for one employee. Returns a failure code instead of throwing
 * so the bulk path can report per-entry outcomes.
 */
async function resolveEntry(
  companyId: string,
  date: string,
  entry: StaffAttendanceEntry,
  context: {
    timeZone: string;
    employeeTypeById: Map<string, string>;
    leaveEmployeeIds: Set<string>;
  }
): Promise<{ data: Prisma.StaffAttendanceDayUncheckedCreateInput } | { code: StaffAttendanceFailureCode }> {
  const employeeType = context.employeeTypeById.get(entry.employeeId);
  if (!employeeType) return { code: "EMPLOYEE_NOT_FOUND" };
  if (employeeType !== OFFICE_EMPLOYEE_TYPE) return { code: "NOT_OFFICE_STAFF" };

  // Recording someone as at work while their leave is approved would quietly contradict
  // the leave record, which stays the source of truth.
  if (AT_WORK_STATUSES.has(entry.status) && context.leaveEmployeeIds.has(entry.employeeId)) {
    return { code: "ON_APPROVED_LEAVE" };
  }

  const timeIn = toInstant(date, entry.timeIn, context.timeZone);
  const timeOut = toInstant(date, entry.timeOut, context.timeZone);
  if (timeIn && timeOut && timeOut.getTime() <= timeIn.getTime()) {
    return { code: "INVALID_TIMES" };
  }

  return {
    data: {
      companyId,
      employeeId: entry.employeeId,
      workDate: dateOnlyUtc(date),
      status: entry.status,
      timeIn,
      timeOut,
      hoursWorked: hoursBetween(timeIn, timeOut),
      notes: entry.notes?.trim() || null,
    },
  };
}

async function loadEntryContext(
  companyId: string,
  date: string,
  employeeIds: string[]
) {
  const workDate = dateOnlyUtc(date);
  const [timeZone, employees, leave] = await Promise.all([
    getCompanyTimezone(companyId),
    prisma.employee.findMany({
      where: { companyId, id: { in: employeeIds } },
      select: { id: true, employeeType: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        companyId,
        status: "APPROVED",
        employeeId: { in: employeeIds },
        startDate: { lte: workDate },
        endDate: { gte: workDate },
      },
      select: { employeeId: true },
    }),
  ]);

  return {
    timeZone,
    employeeTypeById: new Map(employees.map((employee) => [employee.id, employee.employeeType])),
    leaveEmployeeIds: new Set(leave.map((request) => request.employeeId)),
  };
}

export async function setStaffAttendanceDay(
  companyId: string,
  date: string,
  entry: StaffAttendanceEntry,
  actor: { userId?: string }
) {
  const context = await loadEntryContext(companyId, date, [entry.employeeId]);
  const resolved = await resolveEntry(companyId, date, entry, context);
  if ("code" in resolved) {
    return { error: FAILURE_MESSAGES[resolved.code], code: resolved.code };
  }

  const record = await prisma.staffAttendanceDay.upsert({
    where: {
      companyId_employeeId_workDate: {
        companyId,
        employeeId: entry.employeeId,
        workDate: dateOnlyUtc(date),
      },
    },
    create: { ...resolved.data, recordedBy: actor.userId },
    update: {
      status: resolved.data.status,
      timeIn: resolved.data.timeIn,
      timeOut: resolved.data.timeOut,
      hoursWorked: resolved.data.hoursWorked,
      notes: resolved.data.notes,
      recordedBy: actor.userId,
    },
  });

  await createAuditLog({
    userId: actor.userId,
    companyId,
    action: "staff_attendance.day_set",
    entityType: "StaffAttendanceDay",
    entityId: record.id,
    metadata: { employeeId: entry.employeeId, workDate: date, status: entry.status },
  });

  return { record };
}

export async function bulkSetStaffAttendanceDay(
  companyId: string,
  date: string,
  entries: StaffAttendanceEntry[],
  actor: { userId?: string }
) {
  // De-duplicate so one employee cannot be written twice in a single request.
  const byEmployee = new Map(entries.map((entry) => [entry.employeeId, entry]));
  const context = await loadEntryContext(companyId, date, [...byEmployee.keys()]);

  const writes: Prisma.StaffAttendanceDayUncheckedCreateInput[] = [];
  const failed: StaffAttendanceFailure[] = [];

  for (const [employeeId, entry] of byEmployee) {
    const resolved = await resolveEntry(companyId, date, entry, context);
    if ("code" in resolved) {
      failed.push({ employeeId, code: resolved.code, message: FAILURE_MESSAGES[resolved.code] });
      continue;
    }
    writes.push({ ...resolved.data, recordedBy: actor.userId });
  }

  if (writes.length > 0) {
    await prisma.$transaction(
      writes.map((data) =>
        prisma.staffAttendanceDay.upsert({
          where: {
            companyId_employeeId_workDate: {
              companyId,
              employeeId: data.employeeId,
              workDate: data.workDate as Date,
            },
          },
          create: data,
          update: {
            status: data.status,
            timeIn: data.timeIn,
            timeOut: data.timeOut,
            hoursWorked: data.hoursWorked,
            notes: data.notes,
            recordedBy: actor.userId,
          },
        })
      )
    );
  }

  await createAuditLog({
    userId: actor.userId,
    companyId,
    action: "staff_attendance.bulk_set",
    entityType: "Company",
    entityId: companyId,
    metadata: {
      workDate: date,
      requestedCount: byEmployee.size,
      savedEmployeeIds: writes.map((write) => write.employeeId),
      failedCodes: failed.map((failure) => ({ employeeId: failure.employeeId, code: failure.code })),
    },
  });

  return { ok: writes.map((write) => write.employeeId), failed };
}
