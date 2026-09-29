import { addDays, format, isValid, parseISO } from "date-fns";
import { createLeaveRequest, LeaveV3Error } from "../../services/leave-v3.service.js";
import type { LeaveTypeCode } from "../../services/leave-rules.js";
import { sessionManager, type ConversationSession } from "./session.service.js";

export interface LeaveFlowResult {
  reply: string;
  buttons?: { id: string; title: string }[];
  sendInteractiveList?: {
    body: string;
    buttonText: string;
    rows: { id: string; title: string; description?: string }[];
  };
}

const LEAVE_TYPE_MAP: Record<string, { code: LeaveTypeCode; label: string }> = {
  "1": { code: "ANNUAL", label: "Annual Leave" },
  "2": { code: "SICK", label: "Sick Leave" },
  "3": { code: "FAMILY_RESPONSIBILITY", label: "Family Responsibility Leave" },
  "4": { code: "STUDY", label: "Study Leave" },
  annual: { code: "ANNUAL", label: "Annual Leave" },
  sick: { code: "SICK", label: "Sick Leave" },
  family: { code: "FAMILY_RESPONSIBILITY", label: "Family Responsibility Leave" },
  study: { code: "STUDY", label: "Study Leave" },
};

function parseUserDate(input: string): Date | null {
  const trimmed = input.trim().toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (trimmed === "today") return today;
  if (trimmed === "tomorrow") return addDays(today, 1);

  // Check YYYY-MM-DD format strictly
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  const parsed = parseISO(trimmed);
  return isValid(parsed) ? parsed : null;
}

export async function startLeaveFlow(
  from: string,
  employeeId: string,
  companyId: string
): Promise<LeaveFlowResult> {
  sessionManager.setSessionState(from, "LEAVE_SELECT_TYPE", {
    employeeId,
    companyId,
    startedAt: new Date().toISOString(),
  });

  return {
    reply:
      `🌴 *Apply for Leave* (Step 1/4)\n\n` +
      `Select the type of leave you wish to take:\n\n` +
      `1️⃣ *Annual Leave* (Vacation / Personal)\n` +
      `2️⃣ *Sick Leave* (Medical illness or injury)\n` +
      `3️⃣ *Family Responsibility* (Bereavement / Child illness)\n` +
      `4️⃣ *Study Leave* (Exams / Approved courses)\n\n` +
      `Reply with *1–4* or type *cancel* to abort.`,
    buttons: [
      { id: "leave_type_1", title: "1. Annual Leave" },
      { id: "leave_type_2", title: "2. Sick Leave" },
      { id: "leave_type_3", title: "3. Family Resp." },
    ],
  };
}

export async function handleLeaveSelectType(
  from: string,
  text: string,
  session: ConversationSession
): Promise<LeaveFlowResult> {
  const clean = text.trim().toLowerCase().replace(/^leave_type_/, "");
  const selected = LEAVE_TYPE_MAP[clean];

  if (!selected) {
    return {
      reply:
        `⚠️ Invalid selection. Please choose a valid leave type by replying with *1, 2, 3, or 4*:\n\n` +
        `1️⃣ Annual Leave\n` +
        `2️⃣ Sick Leave\n` +
        `3️⃣ Family Responsibility\n` +
        `4️⃣ Study Leave\n\n` +
        `Or type *cancel* to exit.`,
    };
  }

  sessionManager.setSessionState(from, "LEAVE_ENTER_START_DATE", {
    leaveType: selected.code,
    leaveTypeLabel: selected.label,
  });

  return {
    reply:
      `📅 *Leave Start Date* (Step 2/4)\n\n` +
      `Type: *${selected.label}*\n\n` +
      `When does your leave start?\n` +
      `Reply with date in *YYYY-MM-DD* format (e.g. \`${format(addDays(new Date(), 1), "yyyy-MM-dd")}\`), or reply *tomorrow* or *today*:\n\n` +
      `(Type *cancel* to abort)`,
  };
}

export async function handleLeaveEnterStartDate(
  from: string,
  text: string,
  session: ConversationSession
): Promise<LeaveFlowResult> {
  const date = parseUserDate(text);
  if (!date) {
    return {
      reply:
        `⚠️ Invalid date format.\n\n` +
        `Please enter the date using *YYYY-MM-DD* (e.g. \`2026-10-01\`), or type *tomorrow* or *today*.\n\n` +
        `Or type *cancel* to exit.`,
    };
  }

  const startDateIso = format(date, "yyyy-MM-dd");
  sessionManager.setSessionState(from, "LEAVE_ENTER_END_DATE", {
    startDate: startDateIso,
  });

  return {
    reply:
      `📅 *Leave End Date* (Step 3/4)\n\n` +
      `Start Date: *${format(date, "EEE, d MMM yyyy")}*\n\n` +
      `When is the last day of your leave?\n` +
      `• Reply *1* or *same* for a 1-day leave\n` +
      `• Or enter the end date in *YYYY-MM-DD* format (e.g. \`${format(addDays(date, 2), "yyyy-MM-dd")}\`):`,
    buttons: [
      { id: "leave_end_1day", title: "Single Day (1 day)" },
      { id: "leave_end_cancel", title: "Cancel" },
    ],
  };
}

export async function handleLeaveEnterEndDate(
  from: string,
  text: string,
  session: ConversationSession
): Promise<LeaveFlowResult> {
  const clean = text.trim().toLowerCase();
  const startDate = parseISO(session.data.startDate);

  let endDate: Date | null = null;
  if (clean === "1" || clean === "same" || clean === "single" || clean === "leave_end_1day") {
    endDate = startDate;
  } else {
    endDate = parseUserDate(clean);
  }

  if (!endDate) {
    return {
      reply:
        `⚠️ Invalid end date.\n\n` +
        `Reply *1* for a single day, or enter the date as *YYYY-MM-DD* (e.g. \`${format(addDays(startDate, 1), "yyyy-MM-dd")}\`).`,
    };
  }

  if (endDate.getTime() < startDate.getTime()) {
    return {
      reply:
        `⚠️ End date cannot be before start date (*${format(startDate, "yyyy-MM-dd")}*).\n\n` +
        `Please reply with a valid end date on or after the start date:`,
    };
  }

  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
  const endDateIso = format(endDate, "yyyy-MM-dd");

  sessionManager.setSessionState(from, "LEAVE_ENTER_REASON", {
    endDate: endDateIso,
    days,
  });

  return {
    reply:
      `📝 *Reason for Leave* (Step 4/4)\n\n` +
      `Duration: *${days} day(s)* (${format(startDate, "d MMM")} – ${format(endDate, "d MMM yyyy")})\n\n` +
      `Please provide a brief reason for your leave application (or reply *skip*):`,
  };
}

export async function handleLeaveEnterReason(
  from: string,
  text: string,
  session: ConversationSession
): Promise<LeaveFlowResult> {
  const clean = text.trim();
  const reason = clean.toLowerCase() === "skip" ? "Personal Leave" : clean;

  sessionManager.setSessionState(from, "LEAVE_CONFIRM", {
    reason,
  });

  const { leaveTypeLabel, startDate, endDate, days } = session.data;
  const startFmt = format(parseISO(startDate), "d MMM yyyy");
  const endFmt = format(parseISO(endDate), "d MMM yyyy");
  const periodLabel = days === 1 ? startFmt : `${startFmt} – ${endFmt}`;

  return {
    reply:
      `📋 *Please Confirm Your Leave Application*:\n\n` +
      `• Type: *${leaveTypeLabel}*\n` +
      `• Period: *${periodLabel}* (${days} day${days === 1 ? "" : "s"})\n` +
      `• Reason: *${reason}*\n\n` +
      `1️⃣ *Confirm & Submit*\n` +
      `2️⃣ *Cancel Application*\n\n` +
      `Reply *1* or *yes* to submit, or *cancel* to discard.`,
    buttons: [
      { id: "leave_confirm_yes", title: "Confirm & Submit" },
      { id: "leave_confirm_cancel", title: "Cancel" },
    ],
  };
}

export async function handleLeaveConfirm(
  from: string,
  text: string,
  session: ConversationSession
): Promise<LeaveFlowResult> {
  const clean = text.trim().toLowerCase();
  if (
    clean === "1" ||
    clean === "yes" ||
    clean === "confirm" ||
    clean === "submit" ||
    clean === "leave_confirm_yes"
  ) {
    const { leaveType, leaveTypeLabel, startDate, endDate, days, reason } = session.data;
    const startObj = new Date(`${startDate}T00:00:00.000Z`);
    const endObj = new Date(`${endDate}T00:00:00.000Z`);

    try {
      const request = await createLeaveRequest(session.companyId, session.employeeId, {
        employeeId: session.employeeId,
        leaveType,
        startDate: startObj,
        endDate: endObj,
        unitsRequested: days,
        reason,
        familyResponsibilityReason:
          leaveType === "FAMILY_RESPONSIBILITY" ? "CHILD_SICK" : undefined,
      });

      sessionManager.clearSession(from);

      const medicalNote =
        leaveType === "SICK"
          ? `\n\n📄 *Medical Certificate*: If you have a doctor's certificate or note, please send it as a photo or PDF with caption: *leave ${request.id}*.`
          : "";

      return {
        reply:
          `✅ *Leave Application Submitted*\n\n` +
          `• Reference: *${request.id}*\n` +
          `• Type: *${leaveTypeLabel}*\n` +
          `• Duration: *${days} day(s)* (${startDate} to ${endDate})\n` +
          `• Status: *Pending Approval*\n\n` +
          `Your supervisor and HR have been notified.${medicalNote}\n\n` +
          `Reply *menu* for main commands.`,
      };
    } catch (error) {
      sessionManager.clearSession(from);
      const msg = error instanceof LeaveV3Error ? error.message : "Could not submit leave request.";
      return {
        reply: `⚠️ ${msg}\nPlease contact your HR manager or submit via the web dashboard.`,
      };
    }
  }

  // Cancelled
  sessionManager.clearSession(from);
  return {
    reply: `Leave application cancelled. Reply *menu* for available commands.`,
  };
}
