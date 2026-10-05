import { prisma } from "../../lib/prisma.js";
import { formatInTimeZone } from "date-fns-tz";
import { addDays } from "date-fns";
import { getCompanyTimezone, localTimeInZone, parseDateOnly } from "../../lib/timezone.js";
import {
  deriveAttendanceStatus,
  type ControllerAttendanceStatus,
  type CaptureMethod,
} from "./attendance-status.js";

export interface GuardAttendanceItem {
  shiftId: string;
  attendanceId: string | null;
  employeeId: string;
  guardName: string;
  guardPhone: string | null;
  shiftType: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  clockInTime: string | null;
  clockOutTime: string | null;
  hoursWorked: number | null;
  overtimeHours: number | null;
  status: ControllerAttendanceStatus;
  late: boolean;
  earlyDeparture: boolean;
  minutesLate: number | null;
  minutesEarly: number | null;
  manuallyAdjusted: boolean;
  captureMethod: CaptureMethod;
  needsAction: boolean;
  exceptionDescription?: string | null;
  postName?: string | null;
  siteId: string;
  isReplacement?: boolean;
  originalGuardName?: string | null;
}

export interface SiteAttendanceGroup {
  siteId: string;
  siteName: string;
  supervisorName: string | null;
  guards: GuardAttendanceItem[];
  totalScheduled: number;
  totalClockedIn: number;
  totalClockedOut: number;
  totalMissing: number;
  totalExceptions: number;
}

export interface ShiftWindowGroup {
  shiftType: "day" | "night" | "other";
  shiftLabel: string;
  windowStartTime: string;
  windowEndTime: string;
  sites: SiteAttendanceGroup[];
}

export interface TodayAttendanceResponse {
  date: string;
  timeZone: string;
  totalScheduled: number;
  totalClockedIn: number;
  totalClockedOut: number;
  totalMissing: number;
  totalExceptions: number;
  shifts: ShiftWindowGroup[];
}

export async function getTodayAttendance(
  companyId: string,
  params: {
    date?: string; // YYYY-MM-DD
    shiftType?: "day" | "night" | "all";
    siteId?: string;
    searchQuery?: string;
  }
): Promise<TodayAttendanceResponse> {
  const timeZone = await getCompanyTimezone(companyId);
  const now = new Date();
  const dateStr = params.date || formatInTimeZone(now, timeZone, "yyyy-MM-dd");

  // Determine window for 24h day in company timezone (00:00 to 23:59:59 in local time converted to UTC)
  // E.g. for Africa/Johannesburg (UTC+2), 2026-10-05 00:00 is 2026-10-04 22:00 UTC
  const dayStart = localTimeInZone(parseDateOnly(dateStr), 0, 0, timeZone);
  const nextDayStart = localTimeInZone(addDays(parseDateOnly(dateStr), 1), 0, 0, timeZone);
  const dayEnd = new Date(nextDayStart.getTime() - 1);

  const shifts = await prisma.shift.findMany({
    where: {
      companyId,
      startTime: { gte: dayStart, lte: dayEnd },
      ...(params.siteId ? { siteId: params.siteId } : {}),
      ...(params.shiftType && params.shiftType !== "all"
        ? { shiftType: params.shiftType }
        : {}),
      ...(params.searchQuery
        ? {
            OR: [
              { employee: { firstName: { contains: params.searchQuery, mode: "insensitive" } } },
              { employee: { lastName: { contains: params.searchQuery, mode: "insensitive" } } },
              { employee: { employeeNumber: { contains: params.searchQuery, mode: "insensitive" } } },
              { site: { name: { contains: params.searchQuery, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: {
      employee: {
        select: { id: true, firstName: true, lastName: true, phone: true, employeeNumber: true },
      },
      site: {
        select: {
          id: true,
          name: true,
          supervisor: { select: { id: true, name: true } },
        },
      },
      attendances: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ startTime: "asc" }, { site: { name: "asc" } }],
  });

  // Also query open AttendanceExceptions for these shifts to flag them
  const shiftIds = shifts.map((s) => s.id);
  const [exceptions, replacementEvents] = await Promise.all([
    shiftIds.length > 0
      ? prisma.attendanceException.findMany({
          where: {
            companyId,
            shiftId: { in: shiftIds },
            status: "OPEN",
          },
          select: { shiftId: true, exceptionType: true, description: true, severity: true },
        })
      : [],
    shiftIds.length > 0
      ? prisma.attendanceEvent.findMany({
          where: {
            companyId,
            shiftId: { in: shiftIds },
            eventType: "REPLACE_GUARD",
          },
          select: { shiftId: true, metadata: true },
          orderBy: { occurredAt: "desc" },
        })
      : [],
  ]);

  const exceptionsByShift = new Map<string, (typeof exceptions)[0]>();
  for (const exc of exceptions) {
    if (exc.shiftId) exceptionsByShift.set(exc.shiftId, exc);
  }

  const replacementsByShift = new Map<string, Record<string, unknown>>();
  for (const rep of replacementEvents) {
    if (rep.shiftId && !replacementsByShift.has(rep.shiftId)) {
      replacementsByShift.set(rep.shiftId, (rep.metadata as Record<string, unknown>) ?? {});
    }
  }

  // Grouping by Shift Window (e.g. Day Shift 06:00 - 18:00 vs Night Shift 18:00 - 06:00)
  // then Site
  const dayShifts: GuardAttendanceItem[] = [];
  const nightShifts: GuardAttendanceItem[] = [];
  const otherShifts: GuardAttendanceItem[] = [];

  let totalScheduled = 0;
  let totalClockedIn = 0;
  let totalClockedOut = 0;
  let totalMissing = 0;
  let totalExceptions = 0;

  type GuardWithSite = GuardAttendanceItem & { siteId: string; siteName: string; supervisorName: string | null };
  const allItems: GuardWithSite[] = [];

  for (const shift of shifts) {
    totalScheduled += 1;
    const att = shift.attendances?.[0] ?? null;
    const exc = exceptionsByShift.get(shift.id);

    const derived = deriveAttendanceStatus({
      shiftStart: shift.startTime,
      shiftEnd: shift.endTime,
      clockIn: att?.clockIn ?? null,
      clockOut: att?.clockOut ?? null,
      validationStatus: att?.validationStatus,
      source: att?.source,
      whatsappMessageId: att?.whatsappMessageId,
      hasBlockingException: Boolean(exc && (exc.severity === "CRITICAL" || exc.exceptionType === "OUTSIDE_GEOFENCE")),
      now,
    });

    if (derived.status === "clocked_in") totalClockedIn += 1;
    else if (derived.status === "clocked_out") totalClockedOut += 1;
    else if (derived.status === "missing_clock_in" || derived.status === "missing_clock_out") totalMissing += 1;

    if (derived.status === "requires_review" || exc) totalExceptions += 1;

    const guardName = shift.employee
      ? `${shift.employee.firstName} ${shift.employee.lastName}`.trim()
      : "Unassigned Guard";

    const item: GuardWithSite = {
      shiftId: shift.id,
      attendanceId: att?.id ?? null,
      employeeId: shift.employeeId,
      guardName,
      guardPhone: shift.employee?.phone ?? null,
      shiftType: shift.shiftType ?? "day",
      scheduledStartTime: formatInTimeZone(shift.startTime, timeZone, "HH:mm"),
      scheduledEndTime: formatInTimeZone(shift.endTime, timeZone, "HH:mm"),
      clockInTime: att?.clockIn ? formatInTimeZone(att.clockIn, timeZone, "HH:mm") : null,
      clockOutTime: att?.clockOut ? formatInTimeZone(att.clockOut, timeZone, "HH:mm") : null,
      hoursWorked: att?.hoursWorked != null ? Number(att.hoursWorked) : null,
      overtimeHours: att?.overtimeHours != null ? Number(att.overtimeHours) : null,
      status: derived.status,
      late: derived.late,
      earlyDeparture: derived.earlyDeparture,
      minutesLate: derived.minutesLate,
      minutesEarly: derived.minutesEarly,
      manuallyAdjusted: derived.manuallyAdjusted,
      captureMethod: derived.captureMethod,
      needsAction: derived.needsAction,
      exceptionDescription: exc?.description ?? null,
      postName: shift.legacyPostName ?? null,
      siteId: shift.siteId,
      siteName: shift.site?.name ?? "Unassigned Site",
      supervisorName: shift.site?.supervisor?.name ?? null,
      isReplacement: Boolean(replacementsByShift.has(shift.id)),
      originalGuardName: (replacementsByShift.get(shift.id)?.originalGuardName as string) ?? null,
    };

    allItems.push(item);
  }

  // Helper to partition by shiftType and group by site
  function buildShiftWindow(
    type: "day" | "night" | "other",
    label: string,
    items: GuardWithSite[]
  ): ShiftWindowGroup | null {
    if (items.length === 0) return null;
    const siteMap = new Map<string, SiteAttendanceGroup>();

    for (const item of items) {
      if (!siteMap.has(item.siteId)) {
        siteMap.set(item.siteId, {
          siteId: item.siteId,
          siteName: item.siteName,
          supervisorName: item.supervisorName,
          guards: [],
          totalScheduled: 0,
          totalClockedIn: 0,
          totalClockedOut: 0,
          totalMissing: 0,
          totalExceptions: 0,
        });
      }
      const sg = siteMap.get(item.siteId)!;
      sg.guards.push(item);
      sg.totalScheduled += 1;
      if (item.status === "clocked_in") sg.totalClockedIn += 1;
      else if (item.status === "clocked_out") sg.totalClockedOut += 1;
      else if (item.status === "missing_clock_in" || item.status === "missing_clock_out") sg.totalMissing += 1;
      if (item.status === "requires_review" || item.exceptionDescription) sg.totalExceptions += 1;
    }

    return {
      shiftType: type,
      shiftLabel: label,
      windowStartTime: type === "day" ? "06:00" : type === "night" ? "18:00" : "00:00",
      windowEndTime: type === "day" ? "18:00" : type === "night" ? "06:00" : "23:59",
      sites: Array.from(siteMap.values()),
    };
  }

  const dayItems = allItems.filter((i) => i.shiftType.toLowerCase() === "day");
  const nightItems = allItems.filter((i) => i.shiftType.toLowerCase() === "night");
  const otherItems = allItems.filter(
    (i) => i.shiftType.toLowerCase() !== "day" && i.shiftType.toLowerCase() !== "night"
  );

  const shiftWindows: ShiftWindowGroup[] = [];
  const dayWin = buildShiftWindow("day", "Day Shift (06:00 – 18:00)", dayItems);
  if (dayWin) shiftWindows.push(dayWin);

  const nightWin = buildShiftWindow("night", "Night Shift (18:00 – 06:00)", nightItems);
  if (nightWin) shiftWindows.push(nightWin);

  const otherWin = buildShiftWindow("other", "Other Shifts", otherItems);
  if (otherWin) shiftWindows.push(otherWin);

  return {
    date: dateStr,
    timeZone,
    totalScheduled,
    totalClockedIn,
    totalClockedOut,
    totalMissing,
    totalExceptions,
    shifts: shiftWindows,
  };
}
