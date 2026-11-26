import { addDays, format, isValid, parseISO } from "date-fns";
import { createLeaveRequest, LeaveV3Error } from "../../services/leave-v3.service.js";
import type { LeaveTypeCode } from "../../services/leave-rules.js";
import type { ExtractedLeaveParams } from "../../services/ai/whatsapp-intent.service.js";
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
  family_responsibility: { code: "FAMILY_RESPONSIBILITY", label: "Family Responsibility Leave" },
  study: { code: "STUDY", label: "Study Leave" },
};

const LEAVE_CODE_LABELS: Record<string, string> = {
  ANNUAL: "Annual Leave",
  SICK: "Sick Leave",
  FAMILY_RESPONSIBILITY: "Family Responsibility Leave",
  STUDY: "Study Leave",
};

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

export function parseUserDate(input: string, referenceDate: Date = new Date()): Date | null {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, " ");
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);

  if (trimmed === "today") return today;
  if (trimmed === "tomorrow") return addDays(today, 1);

  // 1. YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = parseISO(trimmed);
    return isValid(parsed) ? parsed : null;
  }

  // 2. DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]) - 1;
    const year = Number(dmyMatch[3]);
    const candidate = new Date(year, month, day);
    if (
      candidate.getFullYear() === year &&
      candidate.getMonth() === month &&
      candidate.getDate() === day
    ) {
      return candidate;
    }
    return null;
  }

  // 3. "28 Nov" / "28 November 2026" or "Nov 28" / "November 28, 2026"
  const dayMonthMatch =
    trimmed.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/) ??
    trimmed.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (dayMonthMatch) {
    const isDayFirst = /^\d/.test(dayMonthMatch[1]!);
    const day = Number(isDayFirst ? dayMonthMatch[1] : dayMonthMatch[2]);
    const monthToken = (isDayFirst ? dayMonthMatch[2] : dayMonthMatch[1])!;
    const explicitYear = dayMonthMatch[3] ? Number(dayMonthMatch[3]) : undefined;
    const month = MONTH_INDEX[monthToken];
    if (month !== undefined && day >= 1 && day <= 31) {
      let year = explicitYear ?? today.getFullYear();
      let candidate = new Date(year, month, day);
      if (
        candidate.getFullYear() === year &&
        candidate.getMonth() === month &&
        candidate.getDate() === day
      ) {
        if (explicitYear === undefined && candidate.getTime() < today.getTime() - 30 * 86_400_000) {
          year += 1;
          candidate = new Date(year, month, day);
        }
        return candidate;
      }
    }
  }

  // 4. Weekday names ("friday", "this monday", "next monday")
  const weekdayMatch = trimmed.match(/^(?:(this|next)\s+)?([a-z]+)$/);
  if (weekdayMatch) {
    const modifier = weekdayMatch[1];
    const dayToken = weekdayMatch[2]!;
    const targetDow = WEEKDAY_INDEX[dayToken];
    if (targetDow !== undefined) {
      const currentDow = today.getDay();
      let delta = (targetDow - currentDow + 7) % 7;
      if (delta === 0) {
        delta = modifier === "next" ? 7 : 0;
      } else if (modifier === "next" && delta < 7) {
        // "next monday" when today is Friday -> upcoming Monday (+3); when today is Monday -> +7
      }
      return addDays(today, delta);
    }
  }

  return null;
}

function buildLeaveConfirmResult(
  leaveTypeLabel: string,
  startDateIso: string,
  endDateIso: string,
  days: number,
  reason: string,
  fastTracked = false
): LeaveFlowResult {
  const startFmt = format(parseISO(startDateIso), "d MMM yyyy");
  const endFmt = format(parseISO(endDateIso), "d MMM yyyy");
  const periodLabel = days === 1 ? startFmt : `${startFmt} – ${endFmt}`;
  const header = fastTracked
    ? `✨ *AI Pre-Filled Leave Application*\nPlease review and confirm:`
    : `📋 *Please Confirm Your Leave Application*:`;

  return {
    reply:
      `${header}\n\n` +
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

export async function startSmartLeaveFlow(
  from: string,
  employeeId: string,
  companyId: string,
  extracted?: ExtractedLeaveParams
): Promise<LeaveFlowResult> {
  if (!extracted?.leaveType) {
    return startLeaveFlow(from, employeeId, companyId);
  }

  const leaveType = extracted.leaveType as LeaveTypeCode;
  const leaveTypeLabel = LEAVE_CODE_LABELS[leaveType] ?? "Leave";

  const parsedStart = extracted.startDateIso ? parseUserDate(extracted.startDateIso) : null;
  if (!parsedStart) {
    sessionManager.setSessionState(from, "LEAVE_ENTER_START_DATE", {
      employeeId,
      companyId,
      startedAt: new Date().toISOString(),
      leaveType,
      leaveTypeLabel,
      prefilledReason: extracted.reason,
    });

    return {
      reply:
        `📅 *Leave Start Date* (Step 2/4)\n\n` +
        `Type: *${leaveTypeLabel}*\n\n` +
        `When does your leave start?\n` +
        `Reply with a date (e.g. \`${format(addDays(new Date(), 1), "yyyy-MM-dd")}\`, *28 Nov*, *tomorrow*, or *today*):\n\n` +
        `(Type *cancel* to abort)`,
    };
  }

  const parsedEndCandidate = extracted.endDateIso ? parseUserDate(extracted.endDateIso) : parsedStart;
  const parsedEnd =
    parsedEndCandidate && parsedEndCandidate.getTime() >= parsedStart.getTime()
      ? parsedEndCandidate
      : parsedStart;

  const startDateIso = format(parsedStart, "yyyy-MM-dd");
  const endDateIso = format(parsedEnd, "yyyy-MM-dd");
  const days = Math.round((parsedEnd.getTime() - parsedStart.getTime()) / 86_400_000) + 1;
  const defaultReason = leaveType === "SICK" ? "Medical illness" : "Personal Leave";
  const reason = extracted.reason?.trim() || defaultReason;

  sessionManager.setSessionState(from, "LEAVE_CONFIRM", {
    employeeId,
    companyId,
    startedAt: new Date().toISOString(),
    leaveType,
    leaveTypeLabel,
    startDate: startDateIso,
    endDate: endDateIso,
    days,
    reason,
  });

  return buildLeaveConfirmResult(leaveTypeLabel, startDateIso, endDateIso, days, reason, true);
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
      `Reply with date in *YYYY-MM-DD* format (e.g. \`${format(addDays(new Date(), 1), "yyyy-MM-dd")}\`), *28 Nov*, *tomorrow*, or *today*:\n\n` +
      `(Type *cancel* to abort)`,
  };
}

export async function handleLeaveEnterStartDate(
  from: string,
  text: string,
  _session: ConversationSession
): Promise<LeaveFlowResult> {
  const date = parseUserDate(text);
  if (!date) {
    return {
      reply:
        `⚠️ Invalid date format.\n\n` +
        `Please enter the date using *YYYY-MM-DD* (e.g. \`2026-10-01\`), *28 Nov*, *tomorrow*, or *today*.\n\n` +
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
      `• Or enter the end date (e.g. \`${format(addDays(date, 2), "yyyy-MM-dd")}\` or *30 Nov*):`,
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
  if (clean === "leave_end_cancel") {
    sessionManager.clearSession(from);
    return { reply: "Leave application cancelled. Reply *menu* for available commands." };
  }

  const startDate = parseISO(session.data.startDate);

  let endDate: Date | null = null;
  if (clean === "1" || clean === "same" || clean === "single" || clean === "leave_end_1day") {
    endDate = startDate;
  } else {
    endDate = parseUserDate(clean, startDate);
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

  if (typeof session.data.prefilledReason === "string" && session.data.prefilledReason.trim()) {
    const reason = session.data.prefilledReason.trim();
    sessionManager.setSessionState(from, "LEAVE_CONFIRM", {
      endDate: endDateIso,
      days,
      reason,
    });
    return buildLeaveConfirmResult(
      session.data.leaveTypeLabel,
      session.data.startDate,
      endDateIso,
      days,
      reason,
      true
    );
  }

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
  return buildLeaveConfirmResult(leaveTypeLabel, startDate, endDate, days, reason, false);
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

      if (leaveType === "SICK") {
        sessionManager.setSessionState(from, "LEAVE_AWAITING_CERTIFICATE", {
          employeeId: session.employeeId,
          companyId: session.companyId,
          leaveRequestId: request.id,
        });
      } else {
        sessionManager.clearSession(from);
      }

      const medicalNote =
        leaveType === "SICK"
          ? `\n\n📄 *Medical Certificate*: Send your doctor's certificate right now as a photo or PDF to attach it automatically (or later with caption *leave ${request.id}*).`
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
