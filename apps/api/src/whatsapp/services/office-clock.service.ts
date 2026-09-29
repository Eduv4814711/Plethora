import { prisma } from "../../lib/prisma.js";
import { getCompanyTimezone } from "../../lib/timezone.js";
import { formatInTimeZone } from "date-fns-tz";
import { createAuditLog } from "../../lib/audit.js";

export interface OfficeClockResult {
  success: boolean;
  message: string;
}

export async function recordOfficeAttendance(
  employeeId: string,
  latitude: number,
  longitude: number,
  timestamp: Date = new Date()
): Promise<OfficeClockResult> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
  });

  if (!employee) {
    return { success: false, message: "Employee not found." };
  }

  const timeZone = await getCompanyTimezone(employee.companyId);
  const dateKey = formatInTimeZone(timestamp, timeZone, "yyyy-MM-dd");
  const workDate = new Date(`${dateKey}T00:00:00.000Z`);

  const existing = await prisma.staffAttendanceDay.findUnique({
    where: {
      companyId_employeeId_workDate: {
        companyId: employee.companyId,
        employeeId: employee.id,
        workDate,
      },
    },
  });

  if (!existing || !existing.timeIn) {
    // Clock in
    await prisma.staffAttendanceDay.upsert({
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
        timeIn: timestamp,
        notes: `WhatsApp office clock-in (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`,
      },
      update: {
        status: "present",
        timeIn: timestamp,
        notes: `WhatsApp office clock-in (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`,
      },
    });

    await createAuditLog({
      companyId: employee.companyId,
      action: "staff_attendance.clock_in",
      entityType: "staff_attendance",
      entityId: employee.id,
      metadata: { source: "whatsapp", latitude, longitude },
    });

    return {
      success: true,
      message: `✅ Office attendance recorded. Clock-in at ${formatInTimeZone(timestamp, timeZone, "HH:mm")}.`,
    };
  }

  // Clock out
  const hours = Math.round(((timestamp.getTime() - existing.timeIn.getTime()) / (1000 * 60 * 60)) * 100) / 100;
  await prisma.staffAttendanceDay.update({
    where: { id: existing.id },
    data: {
      timeOut: timestamp,
      hoursWorked: hours > 0 ? hours : null,
      notes: `${existing.notes ?? ""}\nWhatsApp office clock-out (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`.trim(),
    },
  });

  await createAuditLog({
    companyId: employee.companyId,
    action: "staff_attendance.clock_out",
    entityType: "staff_attendance",
    entityId: employee.id,
    metadata: { source: "whatsapp", latitude, longitude, hoursWorked: hours },
  });

  return {
    success: true,
    message: `✅ Office attendance recorded. Clock-out at ${formatInTimeZone(timestamp, timeZone, "HH:mm")} (${hours}h worked).`,
  };
}

export const officeClockService = {
  recordOfficeAttendance,
};
