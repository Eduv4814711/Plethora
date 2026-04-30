import { prisma } from "../lib/prisma.js";
import { AttendanceValidationError, calculateHours, assertWithinSiteGeofence } from "./attendance.service.js";
import { getCompanyTimezone } from "../lib/timezone.js";
import { formatInTimeZone } from "date-fns-tz";

type OfficeClockEmployee = {
  id: string;
  companyId: string;
  employeeType: string;
  status?: string;
};

type OfficeClockCoords = {
  lat: number;
  lng: number;
};

type OfficeAttendanceSettings = {
  officeNoShiftEnabled: boolean;
  officeSiteId: string | null;
  officeOvertimeAfterHours: number;
};

function parsePositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function computeWorkDate(now: Date, timeZone: string): Date {
  const day = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  return new Date(`${day}T00:00:00.000Z`);
}

function computeOfficeHours(clockIn: Date, clockOut: Date, overtimeAfterHours: number) {
  const rawHours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
  const boundedHours = Math.max(0, rawHours);
  const roundedHours = Math.round(boundedHours * 100) / 100;
  const overtime = Math.max(0, boundedHours - overtimeAfterHours);
  const roundedOvertime = Math.round(overtime * 100) / 100;
  return { hoursWorked: roundedHours, overtimeHours: roundedOvertime };
}

export async function getOfficeAttendanceSettings(companyId: string): Promise<OfficeAttendanceSettings> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  const settings = (company?.settings as Record<string, unknown> | null) ?? {};
  const attendanceSettings = (settings.attendance as Record<string, unknown> | undefined) ?? {};

  return {
    officeNoShiftEnabled: Boolean(attendanceSettings.officeNoShiftEnabled),
    officeSiteId:
      typeof attendanceSettings.officeSiteId === "string" && attendanceSettings.officeSiteId.trim().length > 0
        ? attendanceSettings.officeSiteId
        : null,
    officeOvertimeAfterHours: parsePositiveNumber(attendanceSettings.officeOvertimeAfterHours, 8),
  };
}

export async function resolveOfficeSite(companyId: string, siteId?: string | null) {
  if (!siteId) {
    throw new AttendanceValidationError(
      "Office attendance is not configured. Ask admin to set attendance.officeSiteId."
    );
  }

  const site = await prisma.site.findFirst({
    where: { id: siteId, companyId },
  });
  if (!site) {
    throw new AttendanceValidationError("Configured office site not found.");
  }
  return site;
}

export async function getOpenOfficeAttendance(employeeId: string, companyId: string) {
  return prisma.officeAttendance.findFirst({
    where: {
      employeeId,
      companyId,
      status: "clocked_in",
      clockOut: null,
    },
    orderBy: { clockIn: "desc" },
  });
}

export async function startOfficeAttendance(
  employee: OfficeClockEmployee,
  siteId: string,
  coords: OfficeClockCoords
) {
  if (employee.employeeType !== "office") {
    throw new AttendanceValidationError("Office no-shift clock-in is only available for office employees.");
  }
  if (employee.status && employee.status !== "active") {
    throw new AttendanceValidationError("Only active employees can clock in.");
  }

  const [settings, site, open] = await Promise.all([
    getOfficeAttendanceSettings(employee.companyId),
    resolveOfficeSite(employee.companyId, siteId),
    getOpenOfficeAttendance(employee.id, employee.companyId),
  ]);
  if (!settings.officeNoShiftEnabled) {
    throw new AttendanceValidationError("Office no-shift attendance is disabled.");
  }
  if (open) {
    throw new AttendanceValidationError("You already have an active office clock-in.");
  }

  assertWithinSiteGeofence(site, coords.lat, coords.lng);
  const now = new Date();
  const timeZone = await getCompanyTimezone(employee.companyId);
  const workDate = computeWorkDate(now, timeZone);

  return prisma.officeAttendance.create({
    data: {
      companyId: employee.companyId,
      employeeId: employee.id,
      officeSiteId: site.id,
      workDate,
      clockIn: now,
      clockInLat: coords.lat,
      clockInLng: coords.lng,
      status: "clocked_in",
      source: "whatsapp",
    },
    include: { officeSite: true },
  });
}

export async function completeOfficeAttendance(
  employee: OfficeClockEmployee,
  coords: OfficeClockCoords
) {
  if (employee.employeeType !== "office") {
    throw new AttendanceValidationError("Office no-shift clock-out is only available for office employees.");
  }
  if (employee.status && employee.status !== "active") {
    throw new AttendanceValidationError("Only active employees can clock out.");
  }

  const [settings, open] = await Promise.all([
    getOfficeAttendanceSettings(employee.companyId),
    getOpenOfficeAttendance(employee.id, employee.companyId),
  ]);
  if (!settings.officeNoShiftEnabled) {
    throw new AttendanceValidationError("Office no-shift attendance is disabled.");
  }
  if (!open) {
    throw new AttendanceValidationError("No active office clock-in found.");
  }

  const site = await resolveOfficeSite(employee.companyId, open.officeSiteId);
  assertWithinSiteGeofence(site, coords.lat, coords.lng);

  const now = new Date();
  const withShiftMath = calculateHours(now, open.clockIn, now);
  const withPolicyMath = computeOfficeHours(open.clockIn, now, settings.officeOvertimeAfterHours);
  const hoursWorked = Math.max(withShiftMath.hoursWorked ?? 0, withPolicyMath.hoursWorked);
  const overtimeHours = Math.max(withShiftMath.overtimeHours ?? 0, withPolicyMath.overtimeHours);

  return prisma.officeAttendance.update({
    where: { id: open.id },
    data: {
      clockOut: now,
      hoursWorked,
      overtimeHours,
      clockOutLat: coords.lat,
      clockOutLng: coords.lng,
      status: "completed",
      source: "whatsapp",
    },
    include: { officeSite: true },
  });
}
