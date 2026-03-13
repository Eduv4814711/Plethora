import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import { validateClockIn, calculateHours, AttendanceValidationError } from "../../services/attendance.service.js";
import { fetchPayslipData, buildPayslipTemplateData } from "../../services/payslip-data.service.js";
import { generatePayslipPDFFromTemplate } from "../../services/payslip-pdf.service.js";
import { sendText, sendDocument } from "./send.service.js";
import { createAuditLog } from "../../lib/audit.js";
import { format } from "date-fns";

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
• *clock in* / *in* - Clock in for your shift
• *clock out* / *out* - Clock out
• *payslip* - Request your latest payslip
• *leave YYYY-MM-DD type* - Apply for leave (e.g. leave 2025-03-15 annual)
  Types: annual, sick, family, maternity, parental, unpaid
• *help* - Show this menu`;

export async function processIncomingMessage(
  from: string,
  text: string
): Promise<{ reply: string; sendDocument?: { buffer: Buffer; filename: string } }> {
  const cmd = text.trim().toLowerCase();
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
    return { reply: HELP_TEXT };
  }

  if (
    cmd === "clock in" ||
    cmd === "clockin" ||
    cmd === "in" ||
    cmd === "clock in 1"
  ) {
    return handleClockIn(employee);
  }

  if (
    cmd === "clock out" ||
    cmd === "clockout" ||
    cmd === "out" ||
    cmd === "clock out 1"
  ) {
    return handleClockOut(employee);
  }

  if (cmd.startsWith("payslip")) {
    return handlePayslip(employee);
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

async function handleClockIn(
  employee: EmployeeWithCompany
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
  return {
    reply: `Clocked in for ${siteName} at ${format(now, "HH:mm")}.`,
  };
}

async function handleClockOut(
  employee: EmployeeWithCompany
): Promise<{ reply: string }> {
  const attendance = await prisma.attendance.findFirst({
    where: {
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

  return {
    reply: `Clocked out at ${format(now, "HH:mm")}. Hours: ${hoursWorked}, Overtime: ${overtimeHours}h.`,
  };
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

export async function processAndSend(from: string, text: string): Promise<void> {
  const result = await processIncomingMessage(from, text);
  await sendText(from, result.reply);
  if (result.sendDocument) {
    await sendDocument(from, result.sendDocument.buffer, result.sendDocument.filename);
  }
}
