import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import {
  validateClockIn,
  calculateHours,
  assertWithinSiteGeofence,
  AttendanceValidationError,
} from "../../services/attendance.service.js";
import { siteHasGeofence } from "../../lib/geo.js";
import { fetchPayslipData, buildPayslipTemplateData } from "../../services/payslip-data.service.js";
import { generatePayslipPDFFromTemplate } from "../../services/payslip-pdf.service.js";
import { generateRosterPDF } from "../../services/roster-pdf.service.js";
import { sendText, sendDocument, sendInteractiveList } from "./send.service.js";
import { createAuditLog } from "../../lib/audit.js";
import { getCompanyTimezone } from "../../lib/timezone.js";
import { addDays, format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

type EmployeeWithCompany = {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
};

/**
 * Normalize phone for matching. WhatsApp sends IDs like "27821234567" (no +).
 * Employee.phone may be stored as "+27821234567" or "0821234567" etc.
 */
function normalizePhone(waId: string): string {
  const digits = waId.replace(/\D/g, "");
  if (digits.startsWith("27") && digits.length === 11) return digits;
  if (digits.startsWith("0") && digits.length === 10) return "27" + digits.slice(1);
  return digits;
}

function normalizeStoredPhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("27") && digits.length === 11) return digits;
  if (digits.startsWith("0") && digits.length === 10) return "27" + digits.slice(1);
  return digits;
}

export async function findEmployeeByPhone(waId: string): Promise<EmployeeWithCompany | null> {
  const normalized = normalizePhone(waId);
  if (!normalized) return null;

  const employees = await prisma.employee.findMany({
    where: { status: "active", phone: { not: null } },
    select: { id: true, companyId: true, firstName: true, lastName: true, phone: true },
  });

  for (const emp of employees) {
    if (normalizeStoredPhone(emp.phone) === normalized) {
      return emp;
    }
  }
  return null;
}

const HELP_TEXT = `*Plethora - Commands*
• *clock in* / *in* - Clock in for your shift (geofenced sites: then share your location when asked)
• *clock out* / *out* - Clock out (same for geofenced sites)
• *payslip* - Request your latest payslip
• *roster* / *schedule* / *shifts* / *my shifts* - Upcoming shifts (PDF, mobile-friendly)
• *leave YYYY-MM-DD type* - Apply for leave (e.g. leave 2025-03-15 annual)
  Types: annual, sick, family, maternity, parental, unpaid
• *help* - Show this menu`;

const INTERACTIVE_ID_TO_CMD: Record<string, string> = {
  clock_in: "clock in",
  clock_out: "clock out",
  payslip: "payslip",
  roster: "roster",
  leave: "apply leave",
  help: "help",
};

const HELP_INTERACTIVE_ROWS = [
  { id: "clock_in", title: "Clock In", description: "Clock in for your shift" },
  { id: "clock_out", title: "Clock Out", description: "Clock out" },
  { id: "payslip", title: "Payslip", description: "Request your latest payslip" },
  { id: "roster", title: "My roster", description: "Upcoming shifts as PDF" },
  { id: "leave", title: "Apply Leave", description: "Apply for leave" },
  { id: "help", title: "Help", description: "Show this menu" },
];

const ROSTER_MAX_SHIFTS = 20;
const ROSTER_HORIZON_DAYS = 45;
const WHATSAPP_LOCATION_PENDING_MS = 10 * 60 * 1000;

type ProcessResult =
  | { reply: string; sendDocument?: { buffer: Buffer; filename: string } }
  | { sendInteractiveList: { body: string; buttonText: string; rows: typeof HELP_INTERACTIVE_ROWS } };

export async function processIncomingMessage(
  from: string,
  text: string
): Promise<ProcessResult> {
  let cmd = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (INTERACTIVE_ID_TO_CMD[cmd]) {
    cmd = INTERACTIVE_ID_TO_CMD[cmd];
  }
  const employee = await findEmployeeByPhone(from);

  if (!employee) {
    return {
      reply: "Phone number not registered. Contact HR to update your details.",
    };
  }

  if (!cmd) {
    return { reply: HELP_TEXT };
  }

  if (cmd === "help" || cmd === "menu") {
    return {
      sendInteractiveList: {
        body: "What would you like to do? Tap the button below to choose an option.",
        buttonText: "Choose an option",
        rows: HELP_INTERACTIVE_ROWS,
      },
    };
  }

  if (
    cmd === "clock in" ||
    cmd === "clockin" ||
    cmd === "in" ||
    cmd === "clock in 1"
  ) {
    return handleClockIn(employee, from);
  }

  if (
    cmd === "clock out" ||
    cmd === "clockout" ||
    cmd === "out" ||
    cmd === "clock out 1"
  ) {
    return handleClockOut(employee, from);
  }

  if (cmd.startsWith("payslip")) {
    return handlePayslip(employee);
  }

  if (
    cmd === "roster" ||
    cmd === "schedule" ||
    cmd === "shifts" ||
    cmd === "my shifts"
  ) {
    return handleRoster(employee, from);
  }

  if (cmd.startsWith("leave ") || cmd === "apply leave") {
    if (cmd === "apply leave") {
      return {
        reply:
          "Format: leave YYYY-MM-DD type\nExample: leave 2025-03-15 annual\nTypes: annual, sick, family, maternity, parental, unpaid",
      };
    }
    return handleLeave(employee, cmd);
  }

  return { reply: `Unknown command. Send *help* for available commands.` };
}

async function completeWhatsAppClockOut(
  attendanceId: string,
  employee: EmployeeWithCompany,
  clockOutCoords?: { lat: number; lng: number }
): Promise<{ reply: string }> {
  const attendance = await prisma.attendance.findFirst({
    where: {
      id: attendanceId,
      shift: { employeeId: employee.id, companyId: employee.companyId },
      clockIn: { not: null },
      clockOut: null,
      status: "clocked_in",
    },
    include: { shift: true },
  });

  if (!attendance) {
    return { reply: "No active clock-in found." };
  }

  const now = new Date();
  const { hoursWorked, overtimeHours } = calculateHours(
    now,
    attendance.shift.startTime,
    attendance.shift.endTime
  );

  await prisma.attendance.update({
    where: { id: attendance.id },
    data: {
      clockOut: now,
      hoursWorked,
      overtimeHours,
      status: "completed",
      clockOutLat: clockOutCoords?.lat,
      clockOutLng: clockOutCoords?.lng,
    },
  });

  await prisma.shift.update({
    where: { id: attendance.shiftId },
    data: { status: "completed" },
  });

  await createAuditLog({
    companyId: employee.companyId,
    action: "attendance.clock_out",
    entityType: "attendance",
    entityId: attendance.id,
    metadata: {
      source: "whatsapp",
      from: employee.phone,
      hoursWorked,
      overtimeHours,
    },
  });

  const timeZone = await getCompanyTimezone(employee.companyId);
  return {
    reply: `Clocked out at ${formatInTimeZone(now, timeZone, "HH:mm")}. Hours: ${hoursWorked}, Overtime: ${overtimeHours}h.`,
  };
}

async function handleClockIn(
  employee: EmployeeWithCompany,
  fromWaId: string
): Promise<{ reply: string }> {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);

  const shifts = await prisma.shift.findMany({
    where: {
      employeeId: employee.id,
      companyId: employee.companyId,
      status: { in: ["assigned", "active"] },
      startTime: { gte: dayStart, lte: dayEnd },
      endTime: { gt: now },
    },
    include: {
      post: { include: { site: true } },
    },
    orderBy: { startTime: "asc" },
  });

  const windowMs = config.attendance.clockInWindowMinutes * 60 * 1000;
  const eligibleShifts = shifts.filter(
    (s) => now.getTime() >= new Date(s.startTime).getTime() - windowMs
  );

  if (eligibleShifts.length === 0) {
    return {
      reply: "No shift available to clock in. Ensure you are within 15 minutes of your shift start.",
    };
  }

  if (eligibleShifts.length > 1) {
    return {
      reply: "You have multiple shifts. Please clock in via the dashboard.",
    };
  }

  const shift = eligibleShifts[0];
  try {
    await validateClockIn(shift.id, employee.companyId);
  } catch (err) {
    if (err instanceof AttendanceValidationError) {
      return { reply: err.message };
    }
    throw err;
  }

  const site = shift.post?.site;
  if (site && siteHasGeofence(site)) {
    const expiresAt = new Date(Date.now() + WHATSAPP_LOCATION_PENDING_MS);
    await prisma.whatsAppClockPending.upsert({
      where: { waFrom: fromWaId },
      create: {
        waFrom: fromWaId,
        employeeId: employee.id,
        companyId: employee.companyId,
        intent: "clock_in",
        shiftId: shift.id,
        expiresAt,
      },
      update: {
        employeeId: employee.id,
        companyId: employee.companyId,
        intent: "clock_in",
        shiftId: shift.id,
        expiresAt,
      },
    });
    return {
      reply:
        `This site requires your location. Tap 📎 → *Location* → *Send your current location* within 10 minutes to complete clock-in.`,
    };
  }

  const attendance = await prisma.attendance.create({
    data: {
      shiftId: shift.id,
      clockIn: now,
      status: "clocked_in",
    },
    include: {
      shift: {
        include: {
          post: { include: { site: true } },
        },
      },
    },
  });

  await prisma.shift.update({
    where: { id: shift.id },
    data: { status: "active" },
  });

  await createAuditLog({
    companyId: employee.companyId,
    action: "attendance.clock_in",
    entityType: "attendance",
    entityId: attendance.id,
    metadata: { source: "whatsapp", from: employee.phone, shiftId: shift.id },
  });

  const siteName = shift.post?.site?.name ?? "your post";
  const timeZone = await getCompanyTimezone(employee.companyId);
  return {
    reply: `Clocked in for ${siteName} at ${formatInTimeZone(now, timeZone, "HH:mm")}.`,
  };
}

async function handleClockOut(
  employee: EmployeeWithCompany,
  fromWaId: string
): Promise<{ reply: string }> {
  const attendance = await prisma.attendance.findFirst({
    where: {
      shift: { employeeId: employee.id, companyId: employee.companyId },
      clockIn: { not: null },
      clockOut: null,
      status: "clocked_in",
    },
    include: { shift: { include: { post: { include: { site: true } } } } },
  });

  if (!attendance) {
    return { reply: "No active clock-in found." };
  }

  const activeCount = await prisma.attendance.count({
    where: {
      shift: { employeeId: employee.id },
      clockIn: { not: null },
      clockOut: null,
      status: "clocked_in",
    },
  });

  if (activeCount > 1) {
    return {
      reply: "You have multiple active clock-ins. Please clock out via the dashboard.",
    };
  }

  const outSite = attendance.shift.post?.site;
  if (outSite && siteHasGeofence(outSite)) {
    const expiresAt = new Date(Date.now() + WHATSAPP_LOCATION_PENDING_MS);
    await prisma.whatsAppClockPending.upsert({
      where: { waFrom: fromWaId },
      create: {
        waFrom: fromWaId,
        employeeId: employee.id,
        companyId: employee.companyId,
        intent: "clock_out",
        shiftId: attendance.shiftId,
        expiresAt,
      },
      update: {
        employeeId: employee.id,
        companyId: employee.companyId,
        intent: "clock_out",
        shiftId: attendance.shiftId,
        expiresAt,
      },
    });
    return {
      reply:
        `This site requires your location to clock out. Tap 📎 → *Location* → *Send your current location* within 10 minutes to complete clock-out.`,
    };
  }

  return completeWhatsAppClockOut(attendance.id, employee);
}

export async function processIncomingLocation(
  from: string,
  latitude: number,
  longitude: number
): Promise<ProcessResult> {
  const employee = await findEmployeeByPhone(from);
  if (!employee) {
    return { reply: "Phone number not registered. Contact HR to update your details." };
  }

  const pending = await prisma.whatsAppClockPending.findUnique({
    where: { waFrom: from },
  });

  if (!pending) {
    return {
      reply:
        "Send *clock in* or *clock out* first. Sites with a geofence need your location after that command.",
    };
  }

  if (pending.expiresAt.getTime() < Date.now()) {
    await prisma.whatsAppClockPending.delete({ where: { waFrom: from } });
    return { reply: "That request expired. Send clock in or clock out again." };
  }

  if (pending.employeeId !== employee.id || pending.companyId !== employee.companyId) {
    await prisma.whatsAppClockPending.delete({ where: { waFrom: from } });
    return { reply: "Could not verify your session. Try again." };
  }

  if (pending.intent === "clock_in") {
    try {
      await validateClockIn(pending.shiftId, employee.companyId);
    } catch (err) {
      if (err instanceof AttendanceValidationError) {
        await prisma.whatsAppClockPending.delete({ where: { waFrom: from } });
        return { reply: err.message };
      }
      throw err;
    }

    const shift = await prisma.shift.findFirst({
      where: { id: pending.shiftId, companyId: employee.companyId },
      include: { post: { include: { site: true } } },
    });
    if (!shift?.post?.site) {
      await prisma.whatsAppClockPending.delete({ where: { waFrom: from } });
      return { reply: "Shift or site not found. Contact HR." };
    }

    try {
      assertWithinSiteGeofence(shift.post.site, latitude, longitude);
    } catch (err) {
      if (err instanceof AttendanceValidationError) {
        return { reply: err.message };
      }
      throw err;
    }

    const now = new Date();
    const attendance = await prisma.attendance.create({
      data: {
        shiftId: shift.id,
        clockIn: now,
        status: "clocked_in",
        clockInLat: latitude,
        clockInLng: longitude,
      },
      include: {
        shift: { include: { post: { include: { site: true } } } },
      },
    });

    await prisma.shift.update({
      where: { id: shift.id },
      data: { status: "active" },
    });

    await prisma.whatsAppClockPending.delete({ where: { waFrom: from } });

    await createAuditLog({
      companyId: employee.companyId,
      action: "attendance.clock_in",
      entityType: "attendance",
      entityId: attendance.id,
      metadata: {
        source: "whatsapp",
        from: employee.phone,
        shiftId: shift.id,
        latitude,
        longitude,
      },
    });

    const siteName = shift.post?.site?.name ?? "your post";
    const timeZone = await getCompanyTimezone(employee.companyId);
    return {
      reply: `Clocked in for ${siteName} at ${formatInTimeZone(now, timeZone, "HH:mm")}.`,
    };
  }

  if (pending.intent === "clock_out") {
    const attendance = await prisma.attendance.findFirst({
      where: {
        shiftId: pending.shiftId,
        shift: { employeeId: employee.id, companyId: employee.companyId },
        clockIn: { not: null },
        clockOut: null,
        status: "clocked_in",
      },
      include: { shift: { include: { post: { include: { site: true } } } } },
    });

    if (!attendance) {
      await prisma.whatsAppClockPending.delete({ where: { waFrom: from } });
      return { reply: "No active clock-in found for that shift." };
    }

    const site = attendance.shift.post?.site;
    if (site) {
      try {
        assertWithinSiteGeofence(site, latitude, longitude);
      } catch (err) {
        if (err instanceof AttendanceValidationError) {
          return { reply: err.message };
        }
        throw err;
      }
    }

    await prisma.whatsAppClockPending.delete({ where: { waFrom: from } });
    return completeWhatsAppClockOut(attendance.id, employee, { lat: latitude, lng: longitude });
  }

  await prisma.whatsAppClockPending.delete({ where: { waFrom: from } });
  return { reply: "Unknown pending action. Send clock in or clock out again." };
}

async function handlePayslip(
  employee: EmployeeWithCompany
): Promise<{ reply: string; sendDocument?: { buffer: Buffer; filename: string } }> {
  const item = await prisma.payrollItem.findFirst({
    where: {
      employeeId: employee.id,
      payrollRun: {
        companyId: employee.companyId,
        status: { in: ["approved", "paid"] },
      },
      payslip: { isNot: null },
    },
    include: {
      payrollRun: true,
      employee: true,
      payslip: true,
    },
    orderBy: { payrollRun: { periodEnd: "desc" } },
  });

  if (!item) {
    return { reply: "No payslip available. Contact HR." };
  }

  const payslipInput = await fetchPayslipData(
    item.payrollRunId,
    item.id,
    employee.companyId
  );
  if (!payslipInput) {
    return { reply: "Could not generate payslip. Contact HR." };
  }

  const templateData = buildPayslipTemplateData(payslipInput);
  const pdfBuffer = await generatePayslipPDFFromTemplate(templateData);
  const filename = `payslip-${employee.firstName}-${employee.lastName}-${format(payslipInput.periodStart, "yyyy-MM")}.pdf`;

  await createAuditLog({
    companyId: employee.companyId,
    action: "payslip.request",
    entityType: "payslip",
    entityId: item.payslip?.id ?? undefined,
    metadata: { source: "whatsapp", from: employee.phone },
  });

  return {
    reply: `Your payslip for ${format(payslipInput.periodStart, "MMM yyyy")} has been sent.`,
    sendDocument: { buffer: pdfBuffer, filename },
  };
}

const LEAVE_TYPE_ALIASES: Record<string, string> = {
  annual: "annual",
  sick: "sick",
  family: "family_responsibility",
  family_responsibility: "family_responsibility",
  maternity: "maternity",
  parental: "parental",
  unpaid: "unpaid",
};

async function handleLeave(
  employee: EmployeeWithCompany,
  cmd: string
): Promise<{ reply: string }> {
  const match = cmd.match(/leave\s+(\d{4}-\d{2}-\d{2})\s+(\w+)(?:\s+(.+))?/i);
  if (!match) {
    return {
      reply:
        "Format: leave YYYY-MM-DD type\nExample: leave 2025-03-15 annual\nTypes: annual, sick, family, maternity, parental, unpaid",
    };
  }

  const [, dateStr, typeInput, reason] = match;
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);

  if (isNaN(date.getTime())) {
    return { reply: "Invalid date. Use YYYY-MM-DD format." };
  }

  if (date < new Date()) {
    return { reply: "Cannot apply for leave in the past." };
  }

  const type = LEAVE_TYPE_ALIASES[typeInput.toLowerCase()];
  if (!type) {
    return { reply: "Leave type must be: annual, sick, family, maternity, parental, or unpaid." };
  }

  const record = await prisma.leaveRequest.create({
    data: {
      employeeId: employee.id,
      date,
      type,
      hours: 8,
      reason: reason?.trim() || null,
      status: "pending",
    },
  });

  await createAuditLog({
    companyId: employee.companyId,
    action: "leave_request.create",
    entityType: "leave_request",
    entityId: record.id,
    metadata: { source: "whatsapp", from: employee.phone },
  });

  const leaveDate = format(date, "d MMM yyyy");
  const leaveType = type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ");
  return {
    reply: `Leave request submitted for ${leaveDate} (${leaveType}). HR will review shortly.`,
  };
}

function sanitizePdfFilenamePart(s: string): string {
  const t = s.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return t || "user";
}

async function handleRoster(
  employee: EmployeeWithCompany,
  fromWaId: string
): Promise<{ reply: string; sendDocument?: { buffer: Buffer; filename: string } }> {
  const now = new Date();
  const horizonEnd = addDays(now, ROSTER_HORIZON_DAYS);
  const timeZone = await getCompanyTimezone(employee.companyId);

  const company = await prisma.company.findUnique({
    where: { id: employee.companyId },
    select: { name: true },
  });

  const shifts = await prisma.shift.findMany({
    where: {
      employeeId: employee.id,
      companyId: employee.companyId,
      endTime: { gte: now },
      startTime: { lte: horizonEnd },
      status: { in: ["assigned", "active", "created"] },
    },
    include: { post: { include: { site: true } } },
    orderBy: { startTime: "asc" },
    take: ROSTER_MAX_SHIFTS,
  });

  await createAuditLog({
    companyId: employee.companyId,
    action: "roster.whatsapp_request",
    entityType: "employee",
    entityId: employee.id,
    metadata: { source: "whatsapp", from: employee.phone, waId: fromWaId, shiftCount: shifts.length },
  });

  if (shifts.length === 0) {
    return {
      reply:
        "You have no upcoming shifts in the next 45 days. If this looks wrong, contact scheduling or HR.",
    };
  }

  const tzLabel = timeZone.replace(/_/g, " ");
  const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
  const pdfRows = shifts.map((s) => ({
    dateLine: formatInTimeZone(s.startTime, timeZone, "EEE d MMM yyyy"),
    timeRange: `${formatInTimeZone(s.startTime, timeZone, "HH:mm")} – ${formatInTimeZone(s.endTime, timeZone, "HH:mm")}`,
    site: s.post?.site?.name ?? "—",
    post: s.post?.name ?? "—",
  }));

  const pdfBuffer = await generateRosterPDF({
    companyName: company?.name ?? undefined,
    employeeName,
    generatedAtLabel: formatInTimeZone(now, timeZone, "d MMM yyyy, HH:mm"),
    timeZoneLabel: tzLabel,
    shifts: pdfRows,
  });

  const datePart = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const filename = `roster-${sanitizePdfFilenamePart(employee.firstName)}-${sanitizePdfFilenamePart(employee.lastName)}-${datePart}.pdf`;

  return {
    reply:
      `Your roster (${shifts.length} shift${shifts.length === 1 ? "" : "s"}) is attached as a PDF. ` +
      `Times use your company timezone (${tzLabel}).`,
    sendDocument: { buffer: pdfBuffer, filename },
  };
}

const UNSUPPORTED_TYPE_REPLY =
  "I can only read text messages and menu selections. Send *help* for available commands.";

async function deliverProcessResult(from: string, result: ProcessResult): Promise<void> {
  if ("sendInteractiveList" in result && result.sendInteractiveList) {
    const { body, buttonText, rows } = result.sendInteractiveList;
    const interactive = await sendInteractiveList(from, body, buttonText, rows);
    if (!interactive.success) {
      console.error(
        "[WhatsApp] Interactive list failed, falling back to text:",
        interactive.error
      );
      const fallback = await sendText(from, HELP_TEXT);
      if (!fallback.success) {
        throw new Error(fallback.error ?? "Failed to send WhatsApp reply");
      }
    }
    return;
  }

  if ("reply" in result) {
    const sent = await sendText(from, result.reply);
    if (!sent.success) {
      throw new Error(sent.error ?? "Failed to send WhatsApp reply");
    }
    if (result.sendDocument) {
      const docSent = await sendDocument(
        from,
        result.sendDocument.buffer,
        result.sendDocument.filename
      );
      if (!docSent) {
        throw new Error("Failed to send WhatsApp document");
      }
    }
  }
}

export async function processAndSend(from: string, text: string): Promise<void> {
  const employee = await findEmployeeByPhone(from);
  const result = await processIncomingMessage(from, text);
  // #region agent log
  fetch("http://127.0.0.1:7660/ingest/9bfc1ce4-07b7-42be-b006-8b46257a3ce2", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5e86f2" },
    body: JSON.stringify({
      sessionId: "5e86f2",
      runId: "pre-fix",
      hypothesisId: "D",
      location: "handler.service.ts:processAndSend",
      message: "Message processed — employee lookup result",
      data: {
        employeeFound: !!employee,
        resultType: "sendInteractiveList" in result ? "interactive" : "reply",
        fromSuffix: from.slice(-4),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  await deliverProcessResult(from, result);
}

export async function processLocationAndSend(
  from: string,
  latitude: number,
  longitude: number
): Promise<void> {
  const result = await processIncomingLocation(from, latitude, longitude);
  await deliverProcessResult(from, result);
}

export async function sendUnsupportedTypeReply(from: string): Promise<void> {
  const sent = await sendText(from, UNSUPPORTED_TYPE_REPLY);
  if (!sent.success) {
    throw new Error(sent.error ?? "Failed to send WhatsApp reply");
  }
}
