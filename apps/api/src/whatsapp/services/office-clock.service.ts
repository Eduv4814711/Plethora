import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { getCompanyTimezone } from "../../lib/timezone.js";
import { formatInTimeZone } from "date-fns-tz";
import { findOfficeSiteForEmployee, type OfficeGeofenceTarget } from "./office-geofence.service.js";
import { siteHasGeofence, evaluateSiteGeofence, formatDistance } from "../../lib/geo.js";
import { sessionManager } from "./session.service.js";
import type { Site } from "@prisma/client";

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
  geofenceExempt?: boolean;
};

const WHATSAPP_LOCATION_PENDING_MS = 10 * 60 * 1000;

/**
 * Handle WhatsApp Clock In for Office Staff (employeeType === "general").
 *
 * Office staff are paid fixed monthly salary and do not have site-based shifts
 * or occurrence book entries. Attendance is captured in StaffAttendanceDay for
 * leave cross-checks, daily presence tracking, and management reporting.
 *
 * If the employee has an assigned office site with a geofence configured,
 * a pending location request is created requiring a location message.
 */
export async function handleOfficeClockIn(
  employee: OfficeEmployee,
  fromWaId: string
): Promise<{ reply: string } | { sendInteractiveLocation: { body: string } }> {
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

  // 3. Resolve office site
  const officeSite = await findOfficeSiteForEmployee(employee.id, employee.companyId);

  // 4. Check for recently sent location within 3 minutes (Location First flow)
  const session = sessionManager.getSession(fromWaId);
  const recentLocation = session?.data?.lastLocation as
    | { latitude: number; longitude: number; timestamp: number }
    | undefined;

  if (recentLocation && Date.now() - recentLocation.timestamp < 3 * 60 * 1000) {
    if (session) delete session.data.lastLocation;
    return completeOfficeClockInWithLocation(
      employee,
      fromWaId,
      officeSite,
      recentLocation.latitude,
      recentLocation.longitude
    );
  }

  // 5. Mandatory location submission: create pending record and request location
  const expiresAt = new Date(Date.now() + WHATSAPP_LOCATION_PENDING_MS);
  await prisma.whatsAppClockPending.upsert({
    where: { waFrom: fromWaId },
    create: {
      waFrom: fromWaId,
      employeeId: employee.id,
      companyId: employee.companyId,
      intent: "office_clock_in",
      siteId: officeSite?.id ?? null,
      expiresAt,
    },
    update: {
      employeeId: employee.id,
      companyId: employee.companyId,
      intent: "office_clock_in",
      siteId: officeSite?.id ?? null,
      failedAttempts: 0,
      expiresAt,
    },
  });

  const officeLabel = officeSite?.name ? ` for *${officeSite.name}*` : "";
  return {
    sendInteractiveLocation: {
      body: `🏢 Clock in${officeLabel}. Tap 'Send Location' below to verify your arrival.`,
    },
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
  fromWaId: string
): Promise<{ reply: string } | { sendInteractiveLocation: { body: string } }> {
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

  // 2. If no open clock-in on today's record, check unclosed clock-in (e.g. overnight or recent)
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

  // 4. Resolve office site
  const officeSite = await findOfficeSiteForEmployee(employee.id, employee.companyId);

  // 5. Check for recently sent location within 3 minutes (Location First flow)
  const session = sessionManager.getSession(fromWaId);
  const recentLocation = session?.data?.lastLocation as
    | { latitude: number; longitude: number; timestamp: number }
    | undefined;

  if (recentLocation && Date.now() - recentLocation.timestamp < 3 * 60 * 1000) {
    if (session) delete session.data.lastLocation;
    return completeOfficeClockOutWithLocation(
      employee,
      fromWaId,
      officeSite,
      recentLocation.latitude,
      recentLocation.longitude
    );
  }

  // 6. Mandatory location submission: create pending record and request location
  const expiresAt = new Date(Date.now() + WHATSAPP_LOCATION_PENDING_MS);
  await prisma.whatsAppClockPending.upsert({
    where: { waFrom: fromWaId },
    create: {
      waFrom: fromWaId,
      employeeId: employee.id,
      companyId: employee.companyId,
      intent: "office_clock_out",
      siteId: officeSite?.id ?? null,
      expiresAt,
    },
    update: {
      employeeId: employee.id,
      companyId: employee.companyId,
      intent: "office_clock_out",
      siteId: officeSite?.id ?? null,
      failedAttempts: 0,
      expiresAt,
    },
  });

  const officeLabel = officeSite?.name ? ` for *${officeSite.name}*` : "";
  return {
    sendInteractiveLocation: {
      body: `🏢 Clock out${officeLabel}. Tap 'Send Location' below to verify your departure.`,
    },
  };
}

/**
 * Complete WhatsApp Clock In for Office Staff with verified GPS location.
 */
export async function completeOfficeClockInWithLocation(
  employee: OfficeEmployee,
  fromWaId: string,
  site: Site | OfficeGeofenceTarget | null,
  latitude: number,
  longitude: number
): Promise<{ reply: string }> {
  const geoResult = site && siteHasGeofence(site) ? evaluateSiteGeofence(site, latitude, longitude) : null;

  if (geoResult && !geoResult.withinGeofence && !employee.geofenceExempt) {
    await prisma.whatsAppClockPending.update({
      where: { waFrom: fromWaId },
      data: { failedAttempts: { increment: 1 } },
    }).catch(() => undefined);

    const distStr = formatDistance(geoResult.distanceMeters);
    return {
      reply:
        `❌ *Clock In Failed: Outside Office Geofence*\n\n` +
        `You are *${distStr}* away from *${site?.name}*.\n` +
        `You must be within *${geoResult.radiusMeters}m* of the office to clock in.\n\n` +
        `Please move to the office and send your location again.`,
    };
  }

  await prisma.whatsAppClockPending.delete({ where: { waFrom: fromWaId } }).catch(() => undefined);

  const now = new Date();
  const timeZone = await getCompanyTimezone(employee.companyId);
  const todayDateStr = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const workDate = new Date(`${todayDateStr}T00:00:00.000Z`);

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
      siteId: site?.id ?? null,
      clockInLat: latitude,
      clockInLng: longitude,
      clockInDistanceMeters: geoResult ? geoResult.distanceMeters : null,
    },
    update: {
      status: "present",
      timeIn: now,
      siteId: site?.id ?? null,
      clockInLat: latitude,
      clockInLng: longitude,
      clockInDistanceMeters: geoResult ? geoResult.distanceMeters : null,
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
      siteId: site?.id,
      siteName: site?.name,
      latitude,
      longitude,
      distanceMeters: geoResult?.distanceMeters,
    },
  });

  const timeFmt = formatInTimeZone(now, timeZone, "HH:mm");
  const roleStr = employee.jobRole ? ` (${employee.jobRole})` : "";
  const distNote = geoResult
    ? `\n📍 Verified at *${site?.name}* (${formatDistance(geoResult.distanceMeters)} from office)`
    : `\n📍 Location recorded (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;

  return {
    reply:
      `Good day, ${employee.firstName}! 🏢\n\n` +
      `✅ You are clocked in for today at *${timeFmt}*${roleStr}.${distNote}\n\n` +
      `Have a productive day! Reply *2* or *clock out* when you finish work.`,
  };
}

/**
 * Complete WhatsApp Clock Out for Office Staff with verified GPS location.
 */
export async function completeOfficeClockOutWithLocation(
  employee: OfficeEmployee,
  fromWaId: string,
  site: Site | OfficeGeofenceTarget | null,
  latitude: number,
  longitude: number
): Promise<{ reply: string }> {
  const geoResult = site && siteHasGeofence(site) ? evaluateSiteGeofence(site, latitude, longitude) : null;

  if (geoResult && !geoResult.withinGeofence && !employee.geofenceExempt) {
    await prisma.whatsAppClockPending.update({
      where: { waFrom: fromWaId },
      data: { failedAttempts: { increment: 1 } },
    }).catch(() => undefined);

    const distStr = formatDistance(geoResult.distanceMeters);
    return {
      reply:
        `❌ *Clock Out Failed: Outside Office Geofence*\n\n` +
        `You are *${distStr}* away from *${site?.name}*.\n` +
        `You must be within *${geoResult.radiusMeters}m* of the office to clock out.\n\n` +
        `Please return to the office and send your location again.`,
    };
  }

  await prisma.whatsAppClockPending.delete({ where: { waFrom: fromWaId } }).catch(() => undefined);

  const now = new Date();
  const timeZone = await getCompanyTimezone(employee.companyId);
  const todayDateStr = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const workDate = new Date(`${todayDateStr}T00:00:00.000Z`);

  let record = await prisma.staffAttendanceDay.findUnique({
    where: {
      companyId_employeeId_workDate: {
        companyId: employee.companyId,
        employeeId: employee.id,
        workDate,
      },
    },
  });

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

  if (!record || !record.timeIn || record.timeOut) {
    return {
      reply: "No active clock-in found. Reply *1* or *clock in* to record your attendance for today.",
    };
  }

  const timeIn = record.timeIn;
  const msWorked = now.getTime() - timeIn.getTime();
  const hoursWorked = Math.max(0, Math.round((msWorked / (1000 * 60 * 60)) * 100) / 100);

  const updated = await prisma.staffAttendanceDay.update({
    where: { id: record.id },
    data: {
      timeOut: now,
      hoursWorked,
      clockOutLat: latitude,
      clockOutLng: longitude,
      clockOutDistanceMeters: geoResult ? geoResult.distanceMeters : null,
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
      siteId: site?.id,
      siteName: site?.name,
      latitude,
      longitude,
      distanceMeters: geoResult?.distanceMeters,
    },
  });

  const inFmt = formatInTimeZone(timeIn, timeZone, "HH:mm");
  const outFmt = formatInTimeZone(now, timeZone, "HH:mm");
  const distNote = geoResult
    ? `\n• Location: Verified at *${site?.name}* (${formatDistance(geoResult.distanceMeters)} from office)`
    : `\n• Location: (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;

  return {
    reply:
      `🏢 *Clock Out Confirmed*\n\n` +
      `• Clock In: *${inFmt}*\n` +
      `• Clock Out: *${outFmt}*\n` +
      `• Hours Worked: *${hoursWorked.toFixed(2)} hrs*${distNote}\n\n` +
      `Have a great evening, ${employee.firstName}!`,
  };
}

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

  const officeSite = await findOfficeSiteForEmployee(employee.id, employee.companyId);
  const timeZone = await getCompanyTimezone(employee.companyId);
  const todayDateStr = formatInTimeZone(timestamp, timeZone, "yyyy-MM-dd");
  const workDate = new Date(`${todayDateStr}T00:00:00.000Z`);

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
    if (officeSite) {
      const res = await completeOfficeClockInWithLocation(
        employee as unknown as OfficeEmployee,
        employee.phone ?? "",
        officeSite,
        latitude,
        longitude
      );
      return { success: !res.reply.startsWith("❌"), message: res.reply };
    } else {
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
          clockInLat: latitude,
          clockInLng: longitude,
          notes: `WhatsApp office clock-in (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`,
        },
        update: {
          status: "present",
          timeIn: timestamp,
          clockInLat: latitude,
          clockInLng: longitude,
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
  }

  if (officeSite) {
    const res = await completeOfficeClockOutWithLocation(
      employee as unknown as OfficeEmployee,
      employee.phone ?? "",
      officeSite,
      latitude,
      longitude
    );
    return { success: !res.reply.startsWith("❌"), message: res.reply };
  } else {
    const hours = Math.round(((timestamp.getTime() - existing.timeIn.getTime()) / (1000 * 60 * 60)) * 100) / 100;
    await prisma.staffAttendanceDay.update({
      where: { id: existing.id },
      data: {
        timeOut: timestamp,
        hoursWorked: hours > 0 ? hours : null,
        clockOutLat: latitude,
        clockOutLng: longitude,
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
}

export const officeClockService = {
  handleOfficeClockIn,
  handleOfficeClockOut,
  completeOfficeClockInWithLocation,
  completeOfficeClockOutWithLocation,
  recordOfficeAttendance,
};
