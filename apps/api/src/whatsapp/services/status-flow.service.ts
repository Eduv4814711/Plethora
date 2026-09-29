import { prisma } from "../../lib/prisma.js";
import { getCompanyTimezone } from "../../lib/timezone.js";
import { formatInTimeZone } from "date-fns-tz";
import { differenceInMinutes } from "date-fns";

export async function handleStatusFlow(
  employeeId: string,
  companyId: string
): Promise<{ reply: string }> {
  const timeZone = await getCompanyTimezone(companyId);
  const now = new Date();

  // Check employee type to route between Office Staff vs Guard status
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      firstName: true,
      employeeType: true,
      jobRole: true,
      ordinaryHours: true,
      ordinaryDays: true,
    },
  });

  const isOfficeStaff = (employee?.employeeType ?? "security_officer") === "general";

  if (isOfficeStaff) {
    const todayDateStr = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
    const workDate = new Date(`${todayDateStr}T00:00:00.000Z`);

    const todayRecord = await prisma.staffAttendanceDay.findUnique({
      where: {
        companyId_employeeId_workDate: {
          companyId,
          employeeId,
          workDate,
        },
      },
    });

    let officeStatusText = "⚪ *Not Clocked In Today*";
    if (todayRecord?.timeIn && !todayRecord.timeOut) {
      const elapsedMins = differenceInMinutes(now, todayRecord.timeIn);
      const hours = Math.floor(elapsedMins / 60);
      const mins = elapsedMins % 60;
      const inFmt = formatInTimeZone(todayRecord.timeIn, timeZone, "HH:mm");
      officeStatusText = `🟢 *Active at Office*\n  Clocked in: ${inFmt} (${hours}h ${mins}m elapsed)`;
    } else if (todayRecord?.timeIn && todayRecord.timeOut) {
      const inFmt = formatInTimeZone(todayRecord.timeIn, timeZone, "HH:mm");
      const outFmt = formatInTimeZone(todayRecord.timeOut, timeZone, "HH:mm");
      const hours = todayRecord.hoursWorked != null ? Number(todayRecord.hoursWorked).toFixed(2) : "0.00";
      officeStatusText = `🏁 *Workday Completed*\n  In: ${inFmt} | Out: ${outFmt} (${hours} hrs)`;
    }

    const scheduleDays = employee?.ordinaryDays ?? "Monday – Friday";
    const scheduleHours = employee?.ordinaryHours ?? "Standard business hours";
    const scheduleText = `📅 *Office Schedule*:\n  ${scheduleDays} (${scheduleHours})`;

    const pendingLeaves = await prisma.leaveRequest.count({
      where: {
        employeeId,
        companyId,
        status: "PENDING",
      },
    });

    return {
      reply:
        `📊 *Your Office Status*\n\n` +
        `👤 *Today's Attendance*:\n${officeStatusText}\n\n` +
        `🕒 *Working Schedule*:\n${scheduleText}\n\n` +
        `📋 *Leave Requests*:\n` +
        (pendingLeaves > 0
          ? `• ${pendingLeaves} pending application(s) awaiting review`
          : `• No pending leave applications`) +
        `\n\n` +
        `Reply *1* to Clock In, *2* to Clock Out, *6* for Leave, or *menu* for all options.`,
    };
  }

  // 1. Current Clock-In Status (Security Officer / Guard)
  const activeAttendance = await prisma.attendance.findFirst({
    where: {
      shift: { employeeId, companyId },
      clockIn: { not: null },
      clockOut: null,
      status: "clocked_in",
    },
    include: { shift: { include: { site: true } } },
  });

  let clockStatusText = "⚪ *Not Clocked In*";
  if (activeAttendance && activeAttendance.clockIn) {
    const elapsedMins = differenceInMinutes(now, activeAttendance.clockIn);
    const hours = Math.floor(elapsedMins / 60);
    const mins = elapsedMins % 60;
    const timeFormatted = formatInTimeZone(activeAttendance.clockIn, timeZone, "HH:mm");
    const siteName = activeAttendance.shift.site?.name ?? "Post";
    clockStatusText = `🟢 *Active Duty* at *${siteName}*\n  Clocked in: ${timeFormatted} (${hours}h ${mins}m elapsed)`;
  }

  // 2. Next Upcoming Shift
  const nextShift = await prisma.shift.findFirst({
    where: {
      employeeId,
      companyId,
      endTime: { gt: now },
      status: { in: ["assigned", "active", "created"] },
    },
    include: { site: true },
    orderBy: { startTime: "asc" },
  });

  let nextShiftText = "No upcoming shifts scheduled in near horizon.";
  if (nextShift) {
    const isToday =
      formatInTimeZone(nextShift.startTime, timeZone, "yyyy-MM-dd") ===
      formatInTimeZone(now, timeZone, "yyyy-MM-dd");
    const dateLabel = isToday
      ? "Today"
      : formatInTimeZone(nextShift.startTime, timeZone, "EEE d MMM");
    const startFmt = formatInTimeZone(nextShift.startTime, timeZone, "HH:mm");
    const endFmt = formatInTimeZone(nextShift.endTime, timeZone, "HH:mm");
    const siteName = nextShift.site?.name ?? "Assigned Site";
    nextShiftText = `📅 *${dateLabel}* (${startFmt} – ${endFmt})\n  Site: *${siteName}*`;
  }

  // 3. Pending Leave Requests
  const pendingLeaves = await prisma.leaveRequest.count({
    where: {
      employeeId,
      companyId,
      status: "PENDING",
    },
  });

  return {
    reply:
      `📊 *Your Operational Status*\n\n` +
      `👤 *Shift Status*:\n${clockStatusText}\n\n` +
      `🕒 *Next Rostered Shift*:\n${nextShiftText}\n\n` +
      `📋 *Leave Requests*:\n` +
      (pendingLeaves > 0
        ? `• ${pendingLeaves} pending application(s) awaiting review`
        : `• No pending leave applications`) +
      `\n\n` +
      `Reply *1* to Clock In, *2* to Clock Out, *4* for Roster, or *menu* for all options.`,
  };
}
