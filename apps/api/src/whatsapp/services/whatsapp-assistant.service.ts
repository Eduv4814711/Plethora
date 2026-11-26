import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../lib/env.js";
import { getCompanyTimezone } from "../../lib/timezone.js";
import { getLeaveBalances } from "../../services/leave-v3.service.js";
import { chatWithLlm } from "../../services/ai/llm-client.js";

export interface EmployeeAssistantTarget {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  employeeType?: string | null;
  jobRole?: string | null;
  ordinaryHours?: string | null;
  ordinaryDays?: string | null;
}

export interface EmployeeOperationalSnapshot {
  employeeName: string;
  employeeType: string;
  jobRole: string | null;
  todayDate: string;
  timeZone: string;
  activeDuty: {
    clockedIn: boolean;
    siteName?: string;
    clockedInAt?: string;
  };
  upcomingShifts: Array<{
    date: string;
    startTime: string;
    endTime: string;
    site: string;
    post: string | null;
  }>;
  leaveBalances: Array<{
    leaveType: string;
    availableUnits: number;
  }>;
  recentLeaveRequests: Array<{
    id: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    status: string;
  }>;
  compliance: {
    psiraGrade: string | null;
    psiraNumber: string | null;
    psiraExpiry: string | null;
    armedGuard: boolean;
    firearmCompetency: boolean;
    firearmExpiry: string | null;
  };
}

export async function buildEmployeeOperationalSnapshot(
  employee: EmployeeAssistantTarget
): Promise<EmployeeOperationalSnapshot> {
  const now = new Date();
  const timeZone = await getCompanyTimezone(employee.companyId);
  const todayDate = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const isOffice = (employee.employeeType ?? "security_officer") === "general";

  const [empRecord, activeGuardAttendance, todayOfficeRecord, upcomingShifts, recentLeaves, balances] =
    await Promise.all([
      prisma.employee.findFirst({
        where: { id: employee.id, companyId: employee.companyId },
        select: {
          psiraGrade: true,
          psiraRegistrationNumber: true,
          psiraRegistrationExpiry: true,
          armedGuard: true,
          firearmCompetency: true,
          firearmCompetencyExpiry: true,
        },
      }),
      isOffice
        ? Promise.resolve(null)
        : prisma.attendance.findFirst({
            where: {
              shift: { employeeId: employee.id, companyId: employee.companyId },
              clockIn: { not: null },
              clockOut: null,
              status: "clocked_in",
            },
            include: { shift: { select: { site: { select: { name: true } } } } },
          }),
      isOffice
        ? prisma.staffAttendanceDay.findUnique({
            where: {
              companyId_employeeId_workDate: {
                companyId: employee.companyId,
                employeeId: employee.id,
                workDate: new Date(`${todayDate}T00:00:00.000Z`),
              },
            },
          })
        : Promise.resolve(null),
      isOffice
        ? Promise.resolve([])
        : prisma.shift.findMany({
            where: {
              employeeId: employee.id,
              companyId: employee.companyId,
              endTime: { gte: now },
              startTime: { lte: addDays(now, 30) },
              status: { in: ["assigned", "active", "created"] },
            },
            include: { site: { select: { name: true } } },
            orderBy: { startTime: "asc" },
            take: 7,
          }),
      prisma.leaveRequest.findMany({
        where: { companyId: employee.companyId, employeeId: employee.id },
        orderBy: { createdAt: "desc" },
        take: 3,
      }),
      getLeaveBalances(employee.companyId, employee.id).catch(() => []),
    ]);

  let activeDuty: EmployeeOperationalSnapshot["activeDuty"] = { clockedIn: false };
  if (isOffice && todayOfficeRecord?.timeIn && !todayOfficeRecord.timeOut) {
    activeDuty = {
      clockedIn: true,
      siteName: "Office",
      clockedInAt: formatInTimeZone(todayOfficeRecord.timeIn, timeZone, "HH:mm"),
    };
  } else if (activeGuardAttendance?.clockIn) {
    activeDuty = {
      clockedIn: true,
      siteName: activeGuardAttendance.shift.site?.name ?? "Assigned Post",
      clockedInAt: formatInTimeZone(activeGuardAttendance.clockIn, timeZone, "HH:mm"),
    };
  }

  return {
    employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
    employeeType: employee.employeeType ?? "security_officer",
    jobRole: employee.jobRole ?? null,
    todayDate,
    timeZone,
    activeDuty,
    upcomingShifts: upcomingShifts.map((s) => ({
      date: formatInTimeZone(s.startTime, timeZone, "EEE d MMM yyyy"),
      startTime: formatInTimeZone(s.startTime, timeZone, "HH:mm"),
      endTime: formatInTimeZone(s.endTime, timeZone, "HH:mm"),
      site: s.site?.name ?? "Assigned Site",
      post: s.legacyPostName ?? null,
    })),
    leaveBalances: balances.map((b) => ({
      leaveType: b.leaveType,
      availableUnits: Number(b.availableUnits),
    })),
    recentLeaveRequests: recentLeaves.map((l) => ({
      id: l.id,
      leaveType: l.leaveType,
      startDate: l.startDate.toISOString().slice(0, 10),
      endDate: l.endDate.toISOString().slice(0, 10),
      status: l.status,
    })),
    compliance: {
      psiraGrade: empRecord?.psiraGrade ?? null,
      psiraNumber: empRecord?.psiraRegistrationNumber ?? null,
      psiraExpiry: empRecord?.psiraRegistrationExpiry
        ? empRecord.psiraRegistrationExpiry.toISOString().slice(0, 10)
        : null,
      armedGuard: Boolean(empRecord?.armedGuard),
      firearmCompetency: Boolean(empRecord?.firearmCompetency),
      firearmExpiry: empRecord?.firearmCompetencyExpiry
        ? empRecord.firearmCompetencyExpiry.toISOString().slice(0, 10)
        : null,
    },
  };
}

export function formatDeterministicEmployeeAnswer(
  snapshot: EmployeeOperationalSnapshot,
  intent: "COMPLIANCE_STATUS" | "OPERATIONAL_QUESTION"
): string {
  if (intent === "COMPLIANCE_STATUS") {
    const psiraLine = snapshot.compliance.psiraNumber
      ? `• *PSIRA*: ${snapshot.compliance.psiraNumber}${snapshot.compliance.psiraGrade ? ` (Grade ${snapshot.compliance.psiraGrade})` : ""}${snapshot.compliance.psiraExpiry ? ` — expires *${snapshot.compliance.psiraExpiry}*` : ""}`
      : "• *PSIRA*: Not recorded on profile (contact HR)";
    const firearmLine =
      snapshot.compliance.armedGuard || snapshot.compliance.firearmCompetency
        ? `• *Firearm Competency*: ${snapshot.compliance.firearmCompetency ? "Valid" : "Not recorded"}${snapshot.compliance.firearmExpiry ? ` — expires *${snapshot.compliance.firearmExpiry}*` : ""}`
        : "• *Firearm Competency*: Unarmed profile";
    return (
      `🛡️ *Your Compliance Profile*\n\n` +
      `${psiraLine}\n` +
      `${firearmLine}\n\n` +
      `If any expiry date needs renewal or updating, contact HR or reply *7* to alert a supervisor.`
    );
  }

  const dutyLine = snapshot.activeDuty.clockedIn
    ? `🟢 Clocked in at *${snapshot.activeDuty.siteName}* since ${snapshot.activeDuty.clockedInAt}`
    : "⚪ Not currently clocked in";
  const nextShift = snapshot.upcomingShifts[0];
  const shiftLine = nextShift
    ? `📅 Next shift: *${nextShift.date}* (${nextShift.startTime}–${nextShift.endTime}) at *${nextShift.site}*`
    : "📅 No upcoming shifts scheduled in the next 30 days";
  const balLine =
    snapshot.leaveBalances.length > 0
      ? snapshot.leaveBalances.map((b) => `${b.leaveType}: ${b.availableUnits}`).join(" | ")
      : "Contact HR for leave balances";

  return (
    `📋 *Operational Summary for ${snapshot.employeeName}*\n\n` +
    `• *Duty*: ${dutyLine}\n` +
    `• *Schedule*: ${shiftLine}\n` +
    `• *Leave Available*: ${balLine}\n\n` +
    `Reply *4* for full PDF roster, *5* to apply for leave, or *menu* for all options.`
  );
}

export async function answerEmployeeOperationalQuestion(
  employee: EmployeeAssistantTarget,
  question: string,
  intent: "COMPLIANCE_STATUS" | "OPERATIONAL_QUESTION",
  chatFn: typeof chatWithLlm = chatWithLlm,
  forceAi?: boolean
): Promise<{
  reply: string;
  buttons: { id: string; title: string }[];
  aiUsed: boolean;
}> {
  const snapshot = await buildEmployeeOperationalSnapshot(employee);
  const buttons =
    intent === "COMPLIANCE_STATUS"
      ? [
          { id: "status", title: "6. My Status" },
          { id: "supervisor", title: "7. Contact HR/Sup" },
          { id: "help", title: "Main Menu" },
        ]
      : [
          { id: "roster", title: "4. Full Roster PDF" },
          { id: "leave", title: "5. Apply Leave" },
          { id: "help", title: "Main Menu" },
        ];

  if (forceAi ?? env.ai.enabled) {
    const aiResult = await chatFn({
      temperature: 0.1,
      maxTokens: 350,
      messages: [
        {
          role: "system",
          content: [
            "You are Plethora ERP's WhatsApp Operational Assistant for a verified South African security employee.",
            "Answer the employee's question in clear, polite, concise English (under 450 characters, WhatsApp-friendly bullet points where helpful) using ONLY the verified JSON snapshot provided.",
            "Strict rules:",
            "- Never invent shift dates, hours, leave balances, PSIRA numbers, or pay figures.",
            "- If data is null/missing in the snapshot, state that it is not on file and advise contacting HR.",
            "- If asked about payslips, wages, or tax, state that payslips and net pay are issued externally via Sage Payroll.",
            "- Never claim to have clocked them in, approved leave, or changed records.",
          ].join("\n"),
        },
        {
          role: "user",
          content: `Verified Employee Snapshot:\n${JSON.stringify(snapshot)}\n\nEmployee Question: ${question.trim()}`,
        },
      ],
    });

    if (aiResult?.content) {
      return {
        reply: aiResult.content.slice(0, 1000),
        buttons,
        aiUsed: true,
      };
    }
  }

  return {
    reply: formatDeterministicEmployeeAnswer(snapshot, intent),
    buttons,
    aiUsed: false,
  };
}
