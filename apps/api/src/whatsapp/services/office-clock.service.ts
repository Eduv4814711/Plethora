import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { getCompanyTimezone } from "../../lib/timezone.js";
import { formatInTimeZone } from "date-fns-tz";

export type OfficeEmployee = {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  employeeType?: string | null;
  jobRole?: string | null;
  ordinaryHours?: string | null;
  ordinaryDays?: string | null;
};

/**
 * Handle WhatsApp Clock In for Office Staff (employeeType === "general").
 *
 * Office staff are paid fixed monthly salary and do not have site-based shifts
 * or occurrence book entries. Attendance is captured in StaffAttendanceDay for
 * leave cross-checks, daily presence tracking, and management reporting.
 *
 * It is completely isolated from guard hourly payroll calculations.
 */
export async function handleOfficeClockIn(
  employee: OfficeEmployee,
  _fromWaId: string
): Promise<{ reply: string }> {
  const now = new Date();
  const timeZone = await getCompanyTimezone(employee.companyId);
  const todayDateStr = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const workDate = new Date(`${todayDateStr}T00:00:00.000Z`);

  // 1. Guard against clocking in while on approved leave for today
  const approvedLeave = await prisma.leaveRequest.findFirst({
    where: {
      companyId: employee.companyId,
      employeeId: employee.id,
      status: "APPROVED",
      startDate: { lte: workDate },
      endDate: { gte: workDate },
    },
  });

  if (approvedLeave) {
    const leaveLabel = approvedLeave.leaveType.toLowerCase().replace(/_/g, " ");
    return {
      reply: `❌ You are on approved *${leaveLabel}* leave today (${todayDateStr}). You cannot clock in while on approved leave. Please contact HR if your leave dates have changed.`,
    };
  }

  // 2. Check existing StaffAttendanceDay record for today
  const existing = await prisma.staffAttendanceDay.findUnique({
    where: {
      companyId_employeeId_workDate: {
        companyId: employee.companyId,
        employeeId: employee.id,
        workDate,
      },
    },
  });

  if (existing) {
    if (existing.timeIn && !existing.timeOut) {
      const inFmt = formatInTimeZone(existing.timeIn, timeZone, "HH:mm");
      return {
        reply: `You are already clocked in for today at *${inFmt}* (Office).\n\nReply *2* or *clock out* when your workday ends, or *7* to view your status.`,
      };
    }
    if (existing.timeIn && existing.timeOut) {
      const inFmt = formatInTimeZone(existing.timeIn, timeZone, "HH:mm");
      const outFmt = formatInTimeZone(existing.timeOut, timeZone, "HH:mm");
      const hours = existing.hoursWorked != null ? Number(existing.hoursWorked).toFixed(2) : "0.00";
      return {
        reply: `You have already completed your workday today.\n\n• In: *${inFmt}*\n• Out: *${outFmt}*\n• Total: *${hours} hrs*\n\nReply *7* for status or contact HR if you need an adjustment.`,
      };
    }
  }

  // 3. Upsert StaffAttendanceDay record with status 'present' and timeIn
  const record = await prisma.staffAttendanceDay.upsert({
    where: {
      companyId_employeeId_workDate: {
        companyId: employee.companyId,
        employeeId: employee.id,
        workDate,
      },
    },
    create: {
      companyId: employee.companyId,
      employeeId: employee.id,
      workDate,
      status: "present",
      timeIn: now,
    },
    update: {
      status: "present",
      timeIn: now,
    },
  });

  await createAuditLog({
    companyId: employee.companyId,
    action: "staff_attendance.clock_in",
    entityType: "StaffAttendanceDay",
    entityId: record?.id ?? "staff-att-unknown",
    metadata: {
      source: "whatsapp",
      from: employee.phone,
      timeIn: now,
      workDate: todayDateStr,
    },
  });

  const timeFmt = formatInTimeZone(now, timeZone, "HH:mm");
  const roleStr = employee.jobRole ? ` (${employee.jobRole})` : "";
  return {
    reply:
      `Good day, ${employee.firstName}! 🏢\n\n` +
      `You are clocked in for today at *${timeFmt}*${roleStr}.\n\n` +
      `Have a productive day! Reply *2* or *clock out* when you finish work.`,
  };
}

/**
 * Handle WhatsApp Clock Out for Office Staff (employeeType === "general").
 *
 * Closes the active clock-in for today (or most recent unclosed day) and records
 * calculated hours worked in StaffAttendanceDay.
 */
export async function handleOfficeClockOut(
  employee: OfficeEmployee,
  _fromWaId: string
): Promise<{ reply: string }> {
  const now = new Date();
  const timeZone = await getCompanyTimezone(employee.companyId);
  const todayDateStr = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const workDate = new Date(`${todayDateStr}T00:00:00.000Z`);

  // 1. Look for today's record first
  let record = await prisma.staffAttendanceDay.findUnique({
    where: {
      companyId_employeeId_workDate: {
        companyId: employee.companyId,
        employeeId: employee.id,
        workDate,
      },
    },
  });

  // 2. If no open clock-in on today's record, check the most recent unclosed clock-in (e.g. overnight or recent)
  if (!record || !record.timeIn || record.timeOut) {
    const unclosed = await prisma.staffAttendanceDay.findFirst({
      where: {
        companyId: employee.companyId,
        employeeId: employee.id,
        timeIn: { not: null },
        timeOut: null,
      },
      orderBy: { workDate: "desc" },
    });
    if (unclosed) {
      record = unclosed;
    }
  }

  // 3. If still no active clock-in found
  if (!record || !record.timeIn || record.timeOut) {
    if (record?.timeIn && record?.timeOut) {
      const inFmt = formatInTimeZone(record.timeIn, timeZone, "HH:mm");
      const outFmt = formatInTimeZone(record.timeOut, timeZone, "HH:mm");
      const hours = record.hoursWorked != null ? Number(record.hoursWorked).toFixed(2) : "0.00";
      return {
        reply: `You have already clocked out today at *${outFmt}* (clocked in at ${inFmt}). Total: *${hours} hrs*.\n\nReply *7* for status.`,
      };
    }
    return {
      reply: "No active clock-in found. Reply *1* or *clock in* to record your attendance for today.",
    };
  }

  // 4. Calculate hours worked
  const timeIn = record.timeIn;
  const msWorked = now.getTime() - timeIn.getTime();
  const hoursWorked = Math.max(0, Math.round((msWorked / (1000 * 60 * 60)) * 100) / 100);

  const updated = await prisma.staffAttendanceDay.update({
    where: { id: record.id },
    data: {
      timeOut: now,
      hoursWorked,
    },
  });

  await createAuditLog({
    companyId: employee.companyId,
    action: "staff_attendance.clock_out",
    entityType: "StaffAttendanceDay",
    entityId: updated?.id ?? record.id,
    metadata: {
      source: "whatsapp",
      from: employee.phone,
      timeIn,
      timeOut: now,
      hoursWorked,
    },
  });

  const inFmt = formatInTimeZone(timeIn, timeZone, "HH:mm");
  const outFmt = formatInTimeZone(now, timeZone, "HH:mm");
  return {
    reply:
      `🏢 *Clock Out Confirmed*\n\n` +
      `• Clock In: *${inFmt}*\n` +
      `• Clock Out: *${outFmt}*\n` +
      `• Hours Worked: *${hoursWorked.toFixed(2)} hrs*\n\n` +
      `Have a great evening, ${employee.firstName}!`,
  };
}
