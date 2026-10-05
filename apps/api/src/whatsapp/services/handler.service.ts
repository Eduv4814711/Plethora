import { prisma } from "../../lib/prisma.js";
import { randomUUID } from "node:crypto";
import { config } from "../../lib/config.js";
import { normalizeWhatsAppPhone } from "../../lib/phone.js";
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
import {
  sendText,
  sendDocument,
  sendInteractiveList,
  sendInteractiveButtons,
  sendInteractiveLocationRequest,
} from "./send.service.js";
import { createAuditLog } from "../../lib/audit.js";
import { storage } from "../../lib/storage.js";
import { operationalEventBus } from "../../lib/events.js";
import { extensionForMime, matchesMagicBytes } from "../../lib/upload-validation.js";
import { triggerPostClockExceptionSync } from "../../modules/attendance-exceptions/post-clock-sync.js";
import { operationalAttendanceService, findActiveRosterShift } from "./operational-attendance.service.js";
import { officeClockService } from "./office-clock.service.js";
import { getCompanyTimezone } from "../../lib/timezone.js";
import { addDays, format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  attachMedicalCertificate,
  cancelLeaveRequest,
  createLeaveRequest,
  getLeaveBalances,
  LeaveV3Error,
} from "../../services/leave-v3.service.js";
import type { LeaveTypeCode, ParentalLeaveScenarioCode } from "../../services/leave-rules.js";
import { sessionManager } from "./session.service.js";
import {
  startIncidentFlow,
  handleIncidentSelectType,
  handleIncidentSelectSite,
  handleIncidentEnterDetails,
} from "./incident-flow.service.js";
import {
  startLeaveFlow,
  handleLeaveSelectType,
  handleLeaveEnterStartDate,
  handleLeaveEnterEndDate,
  handleLeaveEnterReason,
  handleLeaveConfirm,
} from "./leave-flow.service.js";
import { handleStatusFlow } from "./status-flow.service.js";
import { handleSupervisorHandoff } from "./handoff.service.js";
import {
  handleOfficeClockIn,
  handleOfficeClockOut,
  completeOfficeClockInWithLocation,
  completeOfficeClockOutWithLocation,
} from "./office-clock.service.js";
import { findOfficeSiteForEmployee } from "./office-geofence.service.js";
import { evaluateSiteGeofence, formatDistance } from "../../lib/geo.js";
import { upsertAlert } from "../../modules/alerts/alerts.service.js";

type EmployeeWithCompany = {
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

const MAX_LEAVE_DOCUMENT_BYTES = 10 * 1024 * 1024;
const WHATSAPP_MEDIA_TIMEOUT_MS = 30_000;

export async function readResponseBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("EMPTY_MEDIA_BODY");
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) throw new Error("FILE_TOO_LARGE");
      chunks.push(chunk);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, total);
}

export async function findEmployeeByPhone(waId: string): Promise<EmployeeWithCompany | null> {
  const normalized = normalizeWhatsAppPhone(waId);
  if (!normalized) return null;

  const employees = await prisma.employee.findMany({
    where: { status: "active", phone: { not: null } },
    select: {
      id: true,
      companyId: true,
      firstName: true,
      lastName: true,
      phone: true,
      employeeType: true,
      jobRole: true,
      ordinaryHours: true,
      ordinaryDays: true,
    },
  });

  const matches = employees.filter((employee) => normalizeWhatsAppPhone(employee.phone) === normalized);
  // A WhatsApp sender has no tenant identifier. Never guess when the same
  // normalized phone is active on multiple employee rows or companies.
  if (matches.length > 1) {
    console.warn(
      `[WhatsApp Multi-Tenant Safety] Ambiguous phone number ${normalized} matches multiple active employees (${matches.length}). Refusing to guess tenant.`
    );
    return null;
  }
  return matches.length === 1 ? matches[0]! : null;
}

const HELP_TEXT = `*Plethora Operational Assistant*
Welcome to Plethora field & office services.

1️⃣ *Clock In* - Start shift or office workday
2️⃣ *Clock Out* - End shift or office workday
3️⃣ *Report Incident* - Log emergency, safety hazard, or event
4️⃣ *My Shifts & Roster* - Upcoming schedule (PDF)
5️⃣ *Latest Payslip* - Download latest payslip (PDF)
6️⃣ *Leave Services* - Apply for leave or check balances
7️⃣ *Operational Status* - Check current duty & next shift
8️⃣ *Contact Supervisor* - Request human assistance

• Send evidence/photo with caption *incident REF* or *leave REF*
• Reply *1–8*, tap an option, or type a keyword (*status*, *in*, *out*)
• Type *cancel* at any time to return to this menu.`;

const INTERACTIVE_ID_TO_CMD: Record<string, string> = {
  clock_in: "clock in",
  clock_out: "clock out",
  incident: "incident",
  roster: "roster",
  payslip: "payslip",
  leave: "leave",
  status: "status",
  supervisor: "supervisor",
  help: "help",
  menu: "help",
  cancel: "cancel",
  sup_yes: "sup_yes",
  sup_no: "sup_no",
};

const HELP_INTERACTIVE_ROWS = [
  { id: "clock_in", title: "1. Clock In", description: "Clock in for shift or office day" },
  { id: "clock_out", title: "2. Clock Out", description: "Clock out of shift or office day" },
  { id: "incident", title: "3. Report Incident", description: "Log incident or safety risk" },
  { id: "roster", title: "4. My Roster", description: "Upcoming shifts as PDF" },
  { id: "payslip", title: "5. Latest Payslip", description: "Request latest payslip PDF" },
  { id: "leave", title: "6. Apply Leave", description: "Apply for leave or check balance" },
  { id: "status", title: "7. Status", description: "Check current shift & duty status" },
  { id: "supervisor", title: "8. Supervisor", description: "Request supervisor assistance" },
  { id: "help", title: "Help Menu", description: "Show commands & help" },
];

const ROSTER_MAX_SHIFTS = 20;
const ROSTER_HORIZON_DAYS = 45;
const WHATSAPP_LOCATION_PENDING_MS = 10 * 60 * 1000;

export type ProcessResult =
  | {
      reply: string;
      sendDocument?: { buffer: Buffer; filename: string };
      buttons?: { id: string; title: string }[];
    }
  | {
      sendInteractiveList: {
        body: string;
        buttonText: string;
        rows: typeof HELP_INTERACTIVE_ROWS;
      };
    }
  | {
      sendInteractiveButtons: {
        body: string;
        buttons: { id: string; title: string }[];
      };
    }
  | {
      sendInteractiveLocation: {
        body: string;
      };
    };

export async function processIncomingMessage(
  from: string,
  text: string
): Promise<ProcessResult> {
  const rawTrimmed = text.trim();
  let cmd = rawTrimmed.toLowerCase().replace(/\s+/g, " ");
  if (INTERACTIVE_ID_TO_CMD[cmd]) {
    cmd = INTERACTIVE_ID_TO_CMD[cmd];
  }
  const employee = await findEmployeeByPhone(from);

  if (!employee) {
    return {
      reply: "Phone number not registered. Contact HR to update your details.",
    };
  }

  sessionManager.getOrCreateSession(from, employee.id, employee.companyId);

  // Universal abort / cancel commands
  if (cmd === "cancel" || cmd === "exit" || cmd === "stop" || cmd === "abort") {
    sessionManager.clearSession(from);
    await prisma.whatsAppClockPending.deleteMany({ where: { waFrom: from } }).catch(() => undefined);
    return {
      reply: "Operation cancelled. Reply with *menu* or a command to continue.",
      buttons: [
        { id: "clock_in", title: "1. Clock In" },
        { id: "clock_out", title: "2. Clock Out" },
        { id: "help", title: "Main Menu" },
      ],
    };
  }

  // Universal menu / help commands
  if (cmd === "help" || cmd === "menu" || !cmd) {
    sessionManager.clearSession(from);
    return {
      sendInteractiveList: {
        body: "What would you like to do? Tap the button below to choose an option.",
        buttonText: "Choose an option",
        rows: HELP_INTERACTIVE_ROWS,
      },
    };
  }

  // Check active multi-step conversation session
  const session = sessionManager.getSession(from);
  if (session && session.state !== "IDLE") {
    switch (session.state) {
      case "INCIDENT_SELECT_TYPE":
        return handleIncidentSelectType(from, rawTrimmed, session);
      case "INCIDENT_SELECT_SITE":
        return handleIncidentSelectSite(from, rawTrimmed, session);
      case "INCIDENT_ENTER_DETAILS":
        return handleIncidentEnterDetails(from, rawTrimmed, session);
      case "INCIDENT_AWAITING_PHOTO":
        // User typed a command instead of sending a photo -> clear photo wait state and continue
        sessionManager.clearSession(from);
        break;
      case "LEAVE_SELECT_TYPE":
        return handleLeaveSelectType(from, rawTrimmed, session);
      case "LEAVE_ENTER_START_DATE":
        return handleLeaveEnterStartDate(from, rawTrimmed, session);
      case "LEAVE_ENTER_END_DATE":
        return handleLeaveEnterEndDate(from, rawTrimmed, session);
      case "LEAVE_ENTER_REASON":
        return handleLeaveEnterReason(from, rawTrimmed, session);
      case "LEAVE_CONFIRM":
        return handleLeaveConfirm(from, rawTrimmed, session);
      case "AWAITING_SUPERVISOR_CONFIRM":
        if (cmd === "1" || cmd === "yes" || cmd === "sup_yes" || cmd.includes("alert")) {
          return handleSupervisorHandoff(
            from,
            employee.id,
            employee.companyId,
            "User confirmed assistance after repeated unrecognized commands"
          );
        } else {
          sessionManager.clearSession(from);
          return { reply: "Request cancelled. Reply *menu* for available commands." };
        }
    }
  }

  // 1. Clock In
  if (
    cmd === "1" ||
    cmd === "clock in" ||
    cmd === "clockin" ||
    cmd === "in" ||
    cmd === "clock in 1"
  ) {
    sessionManager.resetUnrecognized(from);
    return handleClockIn(employee, from);
  }

  // 2. Clock Out
  if (
    cmd === "2" ||
    cmd === "clock out" ||
    cmd === "clockout" ||
    cmd === "out" ||
    cmd === "clock out 1"
  ) {
    sessionManager.resetUnrecognized(from);
    return handleClockOut(employee, from);
  }

  // 3. Incident Reporting
  if (
    cmd === "3" ||
    cmd === "incident" ||
    cmd === "report" ||
    cmd === "report incident" ||
    cmd === "emergency" ||
    cmd === "hazard"
  ) {
    sessionManager.resetUnrecognized(from);
    return startIncidentFlow(from, employee.id, employee.companyId);
  }

  // 4. Roster / Shifts
  if (
    cmd === "4" ||
    cmd === "roster" ||
    cmd === "schedule" ||
    cmd === "shifts" ||
    cmd === "my shifts"
  ) {
    sessionManager.resetUnrecognized(from);
    return handleRoster(employee, from);
  }

  // 5. Payslip
  if (cmd === "5" || cmd.startsWith("payslip") || cmd === "pay slip") {
    sessionManager.resetUnrecognized(from);
    return handlePayslip(employee);
  }

  // 6. Leave Services
  if (cmd === "leave status" || cmd === "leave history") {
    sessionManager.resetUnrecognized(from);
    return handleLeaveHistory(employee);
  }
  if (cmd === "leave balance" || cmd === "balance") {
    sessionManager.resetUnrecognized(from);
    return handleLeaveBalance(employee);
  }
  if (cmd.startsWith("leave withdraw ")) {
    sessionManager.resetUnrecognized(from);
    return handleLeaveWithdrawal(employee, cmd.slice("leave withdraw ".length).trim());
  }
  if (cmd === "6" || cmd === "leave" || cmd === "apply leave") {
    sessionManager.resetUnrecognized(from);
    return startLeaveFlow(from, employee.id, employee.companyId);
  }
  if (cmd.startsWith("leave ")) {
    sessionManager.resetUnrecognized(from);
    return handleLeave(employee, cmd);
  }

  // 7. Operational Status
  if (cmd === "7" || cmd === "status" || cmd === "my status" || cmd === "shift status") {
    sessionManager.resetUnrecognized(from);
    return handleStatusFlow(employee.id, employee.companyId);
  }

  // 8. Supervisor Handoff / Assistance
  if (
    cmd === "8" ||
    cmd === "supervisor" ||
    cmd === "agent" ||
    cmd === "human" ||
    cmd === "support" ||
    cmd === "dispatch" ||
    cmd === "help me" ||
    cmd === "call supervisor"
  ) {
    sessionManager.resetUnrecognized(from);
    return handleSupervisorHandoff(
      from,
      employee.id,
      employee.companyId,
      "Employee requested contact via WhatsApp keyword"
    );
  }

  // Fallback Handling
  const attempts = sessionManager.incrementUnrecognized(from);
  if (attempts >= 2) {
    sessionManager.setSessionState(from, "AWAITING_SUPERVISOR_CONFIRM", {
      employeeId: employee.id,
      companyId: employee.companyId,
    });
    return {
      reply:
        `We're having trouble understanding your request.\n\n` +
        `Would you like us to alert a supervisor / controller to contact you?\n\n` +
        `1️⃣ *Yes, alert supervisor*\n` +
        `2️⃣ *No, return to menu*\n\n` +
        `Reply *1* or *2*.`,
      buttons: [
        { id: "sup_yes", title: "1. Alert Supervisor" },
        { id: "sup_no", title: "2. Return to Menu" },
      ],
    };
  }

  return {
    reply:
      `Unknown command. Send *help* for available commands.\n\n` +
      `Quick numbers:\n` +
      `• *1* - Clock In\n` +
      `• *2* - Clock Out\n` +
      `• *3* - Report Incident\n` +
      `• *4* - My Roster\n` +
      `• *5* - Payslip\n` +
      `• *6* - Leave\n` +
      `• *7* - Status\n` +
      `• *8* - Call Supervisor`,
  };
}

async function completeWhatsAppClockOut(
  attendanceId: string,
  employee: EmployeeWithCompany,
  clockOutCoords?: { lat: number; lng: number; distanceMeters?: number; siteName?: string }
): Promise<{ reply: string }> {
  const attendance = await prisma.attendance.findFirst({
    where: {
      id: attendanceId,
      shift: { employeeId: employee.id, companyId: employee.companyId },
      clockIn: { not: null },
      clockOut: null,
      status: "clocked_in",
    },
    include: { shift: { select: { siteId: true, startTime: true, endTime: true } } },
  });

  if (!attendance) {
    return { reply: "No active clock-in found." };
  }

  const now = new Date();
  const { hoursWorked, overtimeHours } = calculateHours(
    attendance.clockIn!,
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
      latitude: clockOutCoords?.lat,
      longitude: clockOutCoords?.lng,
      distanceMeters: clockOutCoords?.distanceMeters,
      siteName: clockOutCoords?.siteName,
    },
  });

  triggerPostClockExceptionSync(employee.companyId, attendance.shift.siteId);

  const timeZone = await getCompanyTimezone(employee.companyId);
  const distNote = clockOutCoords?.distanceMeters != null ? ` (Verified on-site: ${formatDistance(clockOutCoords.distanceMeters)})` : "";
  return {
    reply: `Clocked out at ${formatInTimeZone(now, timeZone, "HH:mm")}${distNote}. Hours: ${hoursWorked}, Overtime: ${overtimeHours}h.`,
  };
}

async function handleClockIn(
  employee: EmployeeWithCompany,
  fromWaId: string
): Promise<ProcessResult> {
  if ((employee.employeeType ?? "security_officer") === "general") {
    return handleOfficeClockIn(employee, fromWaId);
  }

  // Operational guard: Look up officer's roster shift (allowing ±2 hr window)
  const shift = await findActiveRosterShift(employee.id, new Date());
  if (!shift) {
    return {
      reply: "No shift available to clock in. Ensure you are within 15 minutes of your shift start.",
    };
  }

  try {
    await validateClockIn(shift.id, employee.companyId);
  } catch (err) {
    if (err instanceof AttendanceValidationError) {
      return { reply: err.message };
    }
    throw err;
  }

  const site = shift.site;

  // Check for recently sent location within 3 minutes (Location First flow)
  const session = sessionManager.getSession(fromWaId);
  const recentLocation = session?.data?.lastLocation as
    | { latitude: number; longitude: number; timestamp: number }
    | undefined;

  if (recentLocation && Date.now() - recentLocation.timestamp < 3 * 60 * 1000) {
    if (session) delete session.data.lastLocation;
    const result = await operationalAttendanceService.validateAndRecordOperationalAttendance({
      employeeId: employee.id,
      latitude: recentLocation.latitude,
      longitude: recentLocation.longitude,
      intent: "clock_in",
      whatsappNumber: fromWaId,
    });
    return { reply: result.message };
  }

  // Mandatory location verification: create pending record and prompt for location
  const expiresAt = new Date(Date.now() + WHATSAPP_LOCATION_PENDING_MS);
  await prisma.whatsAppClockPending.upsert({
    where: { waFrom: fromWaId },
    create: {
      waFrom: fromWaId,
      employeeId: employee.id,
      companyId: employee.companyId,
      intent: "clock_in",
      shiftId: shift.id,
      siteId: site?.id ?? null,
      expiresAt,
    },
    update: {
      employeeId: employee.id,
      companyId: employee.companyId,
      intent: "clock_in",
      shiftId: shift.id,
      siteId: site?.id ?? null,
      failedAttempts: 0,
      expiresAt,
    },
  });

  const siteName = site?.name ?? "your post";
  return {
    sendInteractiveLocation: {
      body: `📍 Clock in for ${siteName}. Tap 'Send Location' below to verify your geofence.`,
    },
  };
}

async function handleClockOut(
  employee: EmployeeWithCompany,
  fromWaId: string
): Promise<ProcessResult> {
  if ((employee.employeeType ?? "security_officer") === "general") {
    return handleOfficeClockOut(employee, fromWaId);
  }

  const attendance = await prisma.attendance.findFirst({
    where: {
      shift: { employeeId: employee.id, companyId: employee.companyId },
      clockIn: { not: null },
      clockOut: null,
      status: "clocked_in",
    },
    include: { shift: { include: { site: true } } },
  });

  if (!attendance) {
    return { reply: "No active clock-in found." };
  }

  const outSite = attendance.shift.site;

  // Check for recently sent location within 3 minutes (Location First flow)
  const session = sessionManager.getSession(fromWaId);
  const recentLocation = session?.data?.lastLocation as
    | { latitude: number; longitude: number; timestamp: number }
    | undefined;

  if (recentLocation && Date.now() - recentLocation.timestamp < 3 * 60 * 1000) {
    if (session) delete session.data.lastLocation;
    const result = await operationalAttendanceService.validateAndRecordOperationalAttendance({
      employeeId: employee.id,
      latitude: recentLocation.latitude,
      longitude: recentLocation.longitude,
      intent: "clock_out",
      whatsappNumber: fromWaId,
    });
    return { reply: result.message };
  }

  // Mandatory location verification on clock-out
  const expiresAt = new Date(Date.now() + WHATSAPP_LOCATION_PENDING_MS);
  await prisma.whatsAppClockPending.upsert({
    where: { waFrom: fromWaId },
    create: {
      waFrom: fromWaId,
      employeeId: employee.id,
      companyId: employee.companyId,
      intent: "clock_out",
      shiftId: attendance.shiftId,
      siteId: outSite?.id ?? null,
      expiresAt,
    },
    update: {
      employeeId: employee.id,
      companyId: employee.companyId,
      intent: "clock_out",
      shiftId: attendance.shiftId,
      siteId: outSite?.id ?? null,
      failedAttempts: 0,
      expiresAt,
    },
  });

  const siteName = outSite?.name ?? "your post";
  return {
    sendInteractiveLocation: {
      body: `📍 Clock out for ${siteName}. Tap 'Send Location' below to verify your geofence.`,
    },
  };
}

export async function processIncomingLocation(
  from: string,
  latitude: number,
  longitude: number,
  messageId?: string
): Promise<ProcessResult> {
  const employee = await findEmployeeByPhone(from);
  if (!employee) {
    return { reply: "Phone number not registered. Contact HR to update your details." };
  }

  const pending = await prisma.whatsAppClockPending.findUnique({
    where: { waFrom: from },
  });

  if (!pending) {
    // Cache the location coordinates in the session for instant 1-tap confirmation
    const session = sessionManager.getSession(from);
    if (session) {
      session.data.lastLocation = { latitude, longitude, timestamp: Date.now() };
    }

    const isGeneral = (employee.employeeType ?? "security_officer") === "general";
    if (isGeneral) {
      const activeOffice = await prisma.staffAttendanceDay.findFirst({
        where: {
          employeeId: employee.id,
          companyId: employee.companyId,
          timeIn: { not: null },
          timeOut: null,
        },
      });
      if (activeOffice) {
        return {
          reply:
            "📍 *Location Received*\n\nYou are currently clocked in at the office.\n\nReply *2* or *clock out* to complete your workday, or *7* to view status.",
          buttons: [
            { id: "clock_out", title: "Clock Out" },
            { id: "status", title: "View Status" },
          ],
        };
      }
      return {
        reply:
          "📍 *Location Received*\n\nYou are not currently clocked in.\n\nReply *1* or *clock in* to record your attendance for today, or *help* for the main menu.",
        buttons: [
          { id: "clock_in", title: "Clock In" },
          { id: "help", title: "Main Menu" },
        ],
      };
    } else {
      const activeGuard = await prisma.attendance.findFirst({
        where: {
          shift: { employeeId: employee.id, companyId: employee.companyId },
          clockIn: { not: null },
          clockOut: null,
          status: "clocked_in",
        },
      });
      if (activeGuard) {
        return {
          reply:
            "📍 *Location Received*\n\nYou are currently clocked in on shift.\n\nReply *2* or *clock out* when finishing duty.",
          buttons: [
            { id: "clock_out", title: "Clock Out" },
            { id: "status", title: "View Status" },
          ],
        };
      }
      return {
        reply:
          "📍 *Location Received*\n\nYou are not currently clocked in on duty.\n\nReply *1* or *clock in* to start your shift.",
        buttons: [
          { id: "clock_in", title: "Clock In" },
          { id: "help", title: "Main Menu" },
        ],
      };
    }
  }

  if (pending.expiresAt.getTime() < Date.now()) {
    try {
      await prisma.whatsAppClockPending.delete({ where: { waFrom: from } });
    } catch {
      // ignore
    }
    return { reply: "That request expired (10 minute limit). Send clock in or clock out again." };
  }

  if (pending.employeeId !== employee.id || pending.companyId !== employee.companyId) {
    try {
      await prisma.whatsAppClockPending.delete({ where: { waFrom: from } });
    } catch {
      // ignore
    }
    return { reply: "Could not verify your session. Try again." };
  }

  // 1. Office Staff Clock In with Location
  if (pending.intent === "office_clock_in") {
    const site = (pending.siteId ? await prisma.site.findUnique({ where: { id: pending.siteId } }) : null)
      ?? (await findOfficeSiteForEmployee(employee.id, employee.companyId));
    return completeOfficeClockInWithLocation(employee as any, from, site, latitude, longitude);
  }

  // 2. Office Staff Clock Out with Location
  if (pending.intent === "office_clock_out") {
    const site = (pending.siteId ? await prisma.site.findUnique({ where: { id: pending.siteId } }) : null)
      ?? (await findOfficeSiteForEmployee(employee.id, employee.companyId));
    return completeOfficeClockOutWithLocation(employee as any, from, site, latitude, longitude);
  }

  // 3. Security Guard Clock In / Clock Out with Location
  const guardIntent = (pending.intent === "clock_in" || pending.intent === "clock_out")
    ? (pending.intent as "clock_in" | "clock_out")
    : undefined;

  const result = await operationalAttendanceService.validateAndRecordOperationalAttendance({
    employeeId: employee.id,
    latitude,
    longitude,
    intent: guardIntent,
    whatsappMessageId: messageId,
    whatsappNumber: from,
  });

  if (result.validationStatus === "REJECTED_GEOFENCE") {
    const nextAttempts = (pending.failedAttempts ?? 0) + 1;
    await prisma.whatsAppClockPending.update({
      where: { waFrom: from },
      data: { failedAttempts: nextAttempts },
    }).catch(() => undefined);

    if (nextAttempts >= 2 && result.shift?.site) {
      const timeZone = await getCompanyTimezone(employee.companyId);
      const todayDateStr = formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd");
      void upsertAlert({
        companyId: employee.companyId,
        title: `Geofence Clock Failed: ${employee.firstName} ${employee.lastName}`,
        message: `${employee.firstName} ${employee.lastName} attempted to clock from ${formatDistance(result.distanceMeters ?? 0)} away from ${result.shift.site.name} (perimeter: ${result.geofenceRadiusMeters ?? 100}m).`,
        priority: "MEDIUM",
        sourceModule: "ATTENDANCE",
        dedupeKey: `geofence_fail:${employee.id}:${todayDateStr}`,
        siteId: result.shift.site.id,
        employeeId: employee.id,
      }).catch(() => undefined);
    }

    return { reply: result.message };
  }

  try {
    await prisma.whatsAppClockPending.deleteMany({ where: { waFrom: from } });
  } catch {
    // ignore
  }
  return { reply: result.message };
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

const LEAVE_TYPE_ALIASES: Record<string, LeaveTypeCode> = {
  annual: "ANNUAL",
  sick: "SICK",
  family: "FAMILY_RESPONSIBILITY",
  family_responsibility: "FAMILY_RESPONSIBILITY",
  parental: "PARENTAL",
  study: "STUDY",
};

const PARENTAL_SCENARIO_ALIASES: Record<string, ParentalLeaveScenarioCode> = {
  sole: "SOLE_OR_ONLY_EMPLOYED_PARENT",
  only: "SOLE_OR_ONLY_EMPLOYED_PARENT",
  shared: "SHARED_POOL",
};

const FAMILY_RESPONSIBILITY_REASON_ALIASES: Record<string, string> = {
  birth: "CHILD_BIRTH",
  child_sick: "CHILD_SICK",
  spouse_death: "SPOUSE_OR_LIFE_PARTNER_DEATH",
  parent_death: "PARENT_DEATH",
  adoptive_parent_death: "ADOPTIVE_PARENT_DEATH",
  grandparent_death: "GRANDPARENT_DEATH",
  child_death: "CHILD_DEATH",
  adopted_child_death: "ADOPTED_CHILD_DEATH",
  grandchild_death: "GRANDCHILD_DEATH",
  sibling_death: "SIBLING_DEATH",
};

/**
 * Format: leave YYYY-MM-DD [end-date] type [scenario/reason] [free text]
 *
 * unitsRequested is not something a WhatsApp user can conveniently type as a
 * separate number, so it defaults to the number of calendar days in the
 * range — a convenience default for this text interface, not a change to
 * the underlying API (which still takes unitsRequested explicitly).
 *
 * PARENTAL requires a scenario token right after the type: "sole"/"only" or
 * "shared". FAMILY_RESPONSIBILITY requires a reason token from the fixed
 * list (see FAMILY_RESPONSIBILITY_REASON_ALIASES) instead of free text.
 */
async function handleLeave(
  employee: EmployeeWithCompany,
  cmd: string
): Promise<{ reply: string }> {
  const match = cmd.match(/leave\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{4}-\d{2}-\d{2}))?\s+(\w+)(?:\s+(.+))?/i);
  if (!match) {
    return {
      reply:
        "Format: leave YYYY-MM-DD [end-date] type [reason]\nExample: leave 2026-08-01 2026-08-03 annual Family trip",
    };
  }

  const [, dateStr, endDateStr, typeInput, trailing] = match;
  const startDate = new Date(`${dateStr}T00:00:00.000Z`);
  const endDate = endDateStr ? new Date(`${endDateStr}T00:00:00.000Z`) : startDate;
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return { reply: "Invalid date. Use YYYY-MM-DD format." };
  }

  const leaveType = LEAVE_TYPE_ALIASES[typeInput.toLowerCase()];
  if (!leaveType) {
    return { reply: "Unknown leave type. Use annual, sick, family, parental, or study." };
  }

  const unitsRequested = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;

  let parentalLeaveScenario: ParentalLeaveScenarioCode | undefined;
  let familyResponsibilityReason: string | undefined;
  let reason: string | undefined = trailing?.trim();

  if (leaveType === "PARENTAL") {
    const [scenarioToken, ...rest] = (trailing ?? "").trim().split(/\s+/);
    parentalLeaveScenario = scenarioToken ? PARENTAL_SCENARIO_ALIASES[scenarioToken.toLowerCase()] : undefined;
    if (!parentalLeaveScenario) {
      return { reply: "Parental leave needs a scenario: leave YYYY-MM-DD [end-date] parental sole|shared" };
    }
    reason = rest.join(" ").trim() || undefined;
  }

  if (leaveType === "FAMILY_RESPONSIBILITY") {
    const [reasonToken, ...rest] = (trailing ?? "").trim().split(/\s+/);
    familyResponsibilityReason = reasonToken ? FAMILY_RESPONSIBILITY_REASON_ALIASES[reasonToken.toLowerCase()] : undefined;
    if (!familyResponsibilityReason) {
      return {
        reply:
          "Family responsibility leave needs a reason keyword: birth, child_sick, spouse_death, parent_death, adoptive_parent_death, grandparent_death, child_death, adopted_child_death, grandchild_death, or sibling_death.",
      };
    }
    reason = rest.join(" ").trim() || undefined;
  }

  try {
    const request = await createLeaveRequest(employee.companyId, employee.id, {
      employeeId: employee.id,
      leaveType,
      startDate,
      endDate,
      unitsRequested,
      reason,
      familyResponsibilityReason,
      parentalLeaveScenario,
    });
    const leaveDateLabel = endDateStr
      ? `${format(startDate, "d MMM yyyy")} to ${format(endDate, "d MMM yyyy")}`
      : format(startDate, "d MMM yyyy");
    const leaveTypeLabel = leaveType.charAt(0) + leaveType.slice(1).toLowerCase().replace(/_/g, " ");
    return { reply: `Leave ${request.id} submitted for ${leaveDateLabel} (${leaveTypeLabel}). HR will review it.` };
  } catch (error) {
    return { reply: error instanceof LeaveV3Error ? error.message : "Could not submit leave. Contact HR." };
  }
}

async function handleLeaveHistory(employee: EmployeeWithCompany): Promise<{ reply: string }> {
  const requests = await prisma.leaveRequest.findMany({
    where: { companyId: employee.companyId, employeeId: employee.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  if (!requests.length) return { reply: "You have no leave requests." };
  return {
    reply: requests.map((item) =>
      `${item.id} — ${item.leaveType}: ${item.startDate.toISOString().slice(0, 10)} to ${item.endDate.toISOString().slice(0, 10)} (${item.status.toLowerCase()})`
    ).join("\n"),
  };
}

async function handleLeaveBalance(employee: EmployeeWithCompany): Promise<{ reply: string }> {
  try {
    const balances = await getLeaveBalances(employee.companyId, employee.id);
    if (!balances.length) return { reply: "No leave balances are available yet. Contact HR." };
    return {
      reply: balances.map((balance) => `${balance.leaveType}: ${balance.availableUnits} available`).join("\n"),
    };
  } catch (error) {
    return { reply: error instanceof LeaveV3Error ? error.message : "Could not load leave balances. Contact HR." };
  }
}

async function handleLeaveWithdrawal(employee: EmployeeWithCompany, requestId: string): Promise<{ reply: string }> {
  const request = await prisma.leaveRequest.findFirst({ where: { id: requestId, companyId: employee.companyId, employeeId: employee.id } });
  if (!request) return { reply: "Leave request not found." };
  try {
    await cancelLeaveRequest({
      companyId: employee.companyId,
      actorUserId: employee.id,
      requestId,
      reason: "Withdrawn by employee through verified WhatsApp",
    });
    return { reply: `Leave request ${requestId} was withdrawn.` };
  } catch (error) {
    return { reply: error instanceof LeaveV3Error ? error.message : "Could not withdraw leave." };
  }
}

function sanitizePdfFilenamePart(s: string): string {
  const t = s.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return t || "user";
}

async function handleRoster(
  employee: EmployeeWithCompany,
  fromWaId: string
): Promise<{ reply: string; sendDocument?: { buffer: Buffer; filename: string } }> {
  if ((employee.employeeType ?? "security_officer") === "general") {
    const roleStr = employee.jobRole ? ` (${employee.jobRole})` : "";
    return {
      reply:
        `📅 *Office Staff Work Schedule*\n\n` +
        `You are registered as office staff${roleStr}.\n` +
        `Office staff follow standard working schedules rather than site-based shifts.\n\n` +
        `• *Working Days*: ${employee.ordinaryDays ?? "Monday – Friday"}\n` +
        `• *Working Hours*: ${employee.ordinaryHours ?? "Standard business hours"}\n\n` +
        `Reply *1* to Clock In or *2* to Clock Out for your workday.`,
    };
  }

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
    include: { site: true },
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
    site: s.site?.name ?? "—",
    post: s.legacyPostName ?? "—",
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

  if ("sendInteractiveLocation" in result && result.sendInteractiveLocation) {
    const { body } = result.sendInteractiveLocation;
    const interactive = await sendInteractiveLocationRequest(from, body);
    if (!interactive.success) {
      console.error(
        "[WhatsApp] Interactive location failed, falling back to text:",
        interactive.error
      );
      const fallback = await sendText(
        from,
        `${body}\n\n(Use WhatsApp 📎 → Location → Send your current location)`
      );
      if (!fallback.success) {
        throw new Error(fallback.error ?? "Failed to send WhatsApp reply");
      }
    }
    return;
  }

  if ("sendInteractiveButtons" in result && result.sendInteractiveButtons) {
    const { body, buttons } = result.sendInteractiveButtons;
    const btnRes = await sendInteractiveButtons(from, body, buttons);
    if (!btnRes.success) {
      console.warn("[WhatsApp] Interactive buttons failed, falling back to text:", btnRes.error);
      const fallback = await sendText(from, body);
      if (!fallback.success) {
        throw new Error(fallback.error ?? "Failed to send WhatsApp reply");
      }
    }
    return;
  }

  if ("reply" in result) {
    if (result.buttons && result.buttons.length > 0) {
      const btnRes = await sendInteractiveButtons(from, result.reply, result.buttons);
      if (!btnRes.success) {
        const textRes = await sendText(from, result.reply);
        if (!textRes.success) {
          throw new Error(textRes.error ?? "Failed to send WhatsApp reply");
        }
      }
    } else {
      const sent = await sendText(from, result.reply);
      if (!sent.success) {
        throw new Error(sent.error ?? "Failed to send WhatsApp reply");
      }
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
  const result = await processIncomingMessage(from, text);
  await deliverProcessResult(from, result);
}

export async function processLocationAndSend(
  from: string,
  latitude: number,
  longitude: number,
  messageId?: string
): Promise<void> {
  const result = await processIncomingLocation(from, latitude, longitude, messageId);
  await deliverProcessResult(from, result);
}

async function attachIncidentEvidence(
  employee: EmployeeWithCompany,
  incidentRef: string,
  mediaId: string,
  declaredMimeType: string,
  filename: string | undefined
): Promise<ProcessResult> {
  const incident = await prisma.incident.findFirst({
    where: {
      companyId: employee.companyId,
      OR: [{ id: incidentRef }, { incidentNumber: incidentRef }],
    },
  });

  if (!incident) {
    return {
      reply: `Incident reference "${incidentRef}" not found for your company. Please check the reference number.`,
    };
  }

  const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(declaredMimeType)) {
    return { reply: "Evidence must be an image (JPEG, PNG, WebP) or PDF file." };
  }

  const auth = { Authorization: `Bearer ${config.whatsapp.accessToken}` };
  let metadataResponse: Response;
  try {
    metadataResponse = await fetch(
      `https://graph.facebook.com/${config.whatsapp.apiVersion}/${encodeURIComponent(mediaId)}?phone_number_id=${encodeURIComponent(config.whatsapp.phoneNumberId)}`,
      { headers: auth, signal: AbortSignal.timeout(WHATSAPP_MEDIA_TIMEOUT_MS) }
    );
  } catch {
    return { reply: "WhatsApp could not retrieve that file. Please send it again." };
  }
  if (!metadataResponse.ok) return { reply: "WhatsApp could not retrieve that file. Please send it again." };
  const metadata = (await metadataResponse.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!metadata.url || (metadata.file_size ?? 0) > MAX_LEAVE_DOCUMENT_BYTES) {
    return { reply: "The document is missing or exceeds the 10MB limit." };
  }

  let download: Response;
  try {
    download = await fetch(metadata.url, { headers: auth, signal: AbortSignal.timeout(WHATSAPP_MEDIA_TIMEOUT_MS) });
  } catch {
    return { reply: "The WhatsApp file link expired. Please send the document again." };
  }
  if (!download.ok) return { reply: "The WhatsApp file link expired. Please send the document again." };

  const contentLength = Number(download.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_LEAVE_DOCUMENT_BYTES) {
    return { reply: "The document exceeds the 10MB limit." };
  }

  const mimeType = (metadata.mime_type ?? download.headers.get("content-type") ?? declaredMimeType).split(";", 1)[0]!.trim().toLowerCase();
  let buffer: Buffer;
  try {
    buffer = await readResponseBodyWithLimit(download, MAX_LEAVE_DOCUMENT_BYTES);
  } catch {
    return { reply: "The document failed file type or size validation." };
  }

  if (!allowed.has(mimeType) || !matchesMagicBytes(buffer, mimeType)) {
    return { reply: "The document failed file type or format validation." };
  }

  const key = `incidents/${employee.companyId}/${incident.id}/${randomUUID()}.${extensionForMime(mimeType)}`;
  await storage.uploadFile({ key, body: buffer, contentType: mimeType });

  const attachment = await prisma.incidentAttachment.create({
    data: {
      incidentId: incident.id,
      filename: filename || `whatsapp-evidence-${Date.now()}.${extensionForMime(mimeType)}`,
      mimeType,
      size: buffer.length,
      url: storage.getAssetUrl(key),
      uploadedById: incident.reportedById,
    },
  });

  // Broadcast real-time attachment arrival to Control Room
  operationalEventBus.broadcast("INCIDENT_ATTACHMENT_ADDED", employee.companyId, {
    incidentId: incident.id,
    incidentNumber: incident.incidentNumber,
    attachment,
  });

  return {
    reply: `📸 Photo/Evidence successfully attached to incident *${incident.incidentNumber}*. The control room has been updated.`,
  };
}

/**
 * WhatsApp media receiver: handles both medical certificates (caption: leave ID)
 * and incident evidence (caption: incident ID or pending photo upload session).
 */
export async function processLeaveDocumentAndSend(
  from: string,
  mediaId: string,
  declaredMimeType: string,
  filename: string | undefined,
  caption: string | undefined
): Promise<void> {
  const employee = await findEmployeeByPhone(from);
  if (!employee) return deliverProcessResult(from, { reply: "Phone number not registered. Contact HR to update your details." });

  const session = sessionManager.getSession(from);
  const incidentMatch = caption?.trim().match(/^incident\s+([A-Za-z0-9_-]+)$/i)?.[1];
  const isAwaitingIncidentPhoto = session?.state === "INCIDENT_AWAITING_PHOTO" && session.data?.incidentId;
  const incidentRef = incidentMatch || (isAwaitingIncidentPhoto ? (session.data.incidentId as string) : undefined);

  if (incidentRef) {
    const res = await attachIncidentEvidence(employee, incidentRef, mediaId, declaredMimeType, filename);
    sessionManager.clearSession(from);
    return deliverProcessResult(from, res);
  }

  const requestId = caption?.trim().match(/^leave\s+([A-Za-z0-9_-]+)$/i)?.[1];
  if (!requestId) {
    return deliverProcessResult(from, {
      reply:
        "To attach evidence, please caption the image or document:\n" +
        "• *incident <INCIDENT_NUMBER>* for incident photos\n" +
        "• *leave <REQUEST_ID>* for medical certificates",
    });
  }
  const application = await prisma.leaveRequest.findFirst({
    where: { id: requestId, companyId: employee.companyId, employeeId: employee.id, leaveType: "SICK", status: { in: ["PENDING", "APPROVED"] } },
  });
  if (!application) return deliverProcessResult(from, { reply: "That active sick leave request was not found for your verified phone number." });
  const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(declaredMimeType)) return deliverProcessResult(from, { reply: "Leave evidence must be a PDF, JPEG, PNG, or WebP file." });
  const auth = { Authorization: `Bearer ${config.whatsapp.accessToken}` };
  let metadataResponse: Response;
  try {
    metadataResponse = await fetch(`https://graph.facebook.com/${config.whatsapp.apiVersion}/${encodeURIComponent(mediaId)}?phone_number_id=${encodeURIComponent(config.whatsapp.phoneNumberId)}`, { headers: auth, signal: AbortSignal.timeout(WHATSAPP_MEDIA_TIMEOUT_MS) });
  } catch {
    return deliverProcessResult(from, { reply: "WhatsApp could not retrieve that file. Please send it again." });
  }
  if (!metadataResponse.ok) return deliverProcessResult(from, { reply: "WhatsApp could not retrieve that file. Please send it again." });
  const metadata = await metadataResponse.json() as { url?: string; mime_type?: string; file_size?: number };
  if (!metadata.url || (metadata.file_size ?? 0) > MAX_LEAVE_DOCUMENT_BYTES) return deliverProcessResult(from, { reply: "The leave document is missing or exceeds the 10MB limit." });
  let download: Response;
  try {
    download = await fetch(metadata.url, { headers: auth, signal: AbortSignal.timeout(WHATSAPP_MEDIA_TIMEOUT_MS) });
  } catch {
    return deliverProcessResult(from, { reply: "The WhatsApp file link expired. Please send the document again." });
  }
  if (!download.ok) return deliverProcessResult(from, { reply: "The WhatsApp file link expired. Please send the document again." });
  const contentLength = Number(download.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_LEAVE_DOCUMENT_BYTES) {
    return deliverProcessResult(from, { reply: "The leave document is missing or exceeds the 10MB limit." });
  }
  const mimeType = (metadata.mime_type ?? download.headers.get("content-type") ?? declaredMimeType).split(";", 1)[0]!.trim().toLowerCase();
  let buffer: Buffer;
  try {
    buffer = await readResponseBodyWithLimit(download, MAX_LEAVE_DOCUMENT_BYTES);
  } catch {
    return deliverProcessResult(from, { reply: "The leave document failed file type or size validation." });
  }
  if (!allowed.has(mimeType) || !matchesMagicBytes(buffer, mimeType)) {
    return deliverProcessResult(from, { reply: "The leave document failed file type or size validation." });
  }
  const key = `leave-medical-certificates/${employee.companyId}/${application.id}/${randomUUID()}.${extensionForMime(mimeType)}`;
  await storage.uploadFile({ key, body: buffer, contentType: mimeType });
  try {
    const today = new Date();
    await attachMedicalCertificate({
      companyId: employee.companyId,
      actorUserId: employee.id,
      leaveRequestId: application.id,
      practitionerName: "Submitted via WhatsApp — pending HR completion",
      practitionerRegistrationNumber: "N/A",
      consultationDate: today,
      bookedOffStartDate: application.startDate,
      bookedOffEndDate: application.endDate,
      fileReference: storage.getAssetUrl(key),
    });
  } catch (error) {
    await storage.deleteFile(key).catch((cleanupError) => {
      console.error("Failed to remove orphaned WhatsApp leave document", cleanupError);
    });
    return deliverProcessResult(from, {
      reply: error instanceof LeaveV3Error ? error.message : "Could not attach the medical certificate. Contact HR.",
    });
  }
  await deliverProcessResult(from, {
    reply: `Certificate received for leave ${application.id}. HR will complete the practitioner details.`,
  });
}

export async function sendUnsupportedTypeReply(from: string): Promise<void> {
  const sent = await sendText(from, UNSUPPORTED_TYPE_REPLY);
  if (!sent.success) {
    throw new Error(sent.error ?? "Failed to send WhatsApp reply");
  }
}
