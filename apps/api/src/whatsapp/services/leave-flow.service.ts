import { addDays, format, isValid, parseISO } from "date-fns";
import type { LeaveDocumentKind } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  attachLeaveSupportingDocument,
  createLeaveRequest,
  defaultDocumentKindForLeaveType,
  getLeaveBalances,
  LeaveV3Error,
  previewLeaveRequest,
} from "../../services/leave-v3.service.js";
import {
  isEligibleForFamilyResponsibilityLeave,
  isLeaveTypeAvailable,
  type LeaveTypeCode,
} from "../../services/leave-rules.js";
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

export interface PendingLeaveDocument {
  kind: LeaveDocumentKind;
  fileName: string;
  mimeType: string;
  fileReference: string;
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
  school: { code: "STUDY", label: "Study Leave" },
};

const LEAVE_CODE_LABELS: Record<string, string> = {
  ANNUAL: "Annual Leave",
  SICK: "Sick Leave",
  FAMILY_RESPONSIBILITY: "Family Responsibility Leave",
  STUDY: "Study Leave",
};

const FAMILY_REASON_CHOICES: Array<{
  key: string;
  code: string;
  label: string;
}> = [
  { key: "1", code: "CHILD_SICK", label: "Employee's child is sick" },
  { key: "2", code: "CHILD_BIRTH", label: "Birth of employee's child" },
  { key: "3", code: "SPOUSE_OR_LIFE_PARTNER_DEATH", label: "Death of spouse / life partner" },
  { key: "4", code: "PARENT_DEATH", label: "Death of parent / adoptive parent" },
  { key: "5", code: "CHILD_DEATH", label: "Death of child / adopted child" },
  { key: "6", code: "SIBLING_DEATH", label: "Death of sibling" },
  { key: "7", code: "GRANDPARENT_DEATH", label: "Death of grandparent / grandchild" },
];

const MONTH_INDEX: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

export function parseUserDate(input: string, referenceDate: Date = new Date()): Date | null {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, " ");
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);

  if (trimmed === "today") return today;
  if (trimmed === "tomorrow") return addDays(today, 1);

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = parseISO(trimmed);
    return isValid(parsed) ? parsed : null;
  }

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
      }
      return addDays(today, delta);
    }
  }

  return null;
}

async function getEmployeeLeaveMeta(companyId: string, employeeId: string) {
  try {
    return await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { employeeType: true, commencementDate: true },
    });
  } catch {
    return null;
  }
}

function buildLeaveConfirmResult(
  leaveTypeLabel: string,
  startDateIso: string,
  endDateIso: string,
  days: number,
  reason: string,
  fastTracked = false,
  pendingDocs: PendingLeaveDocument[] = [],
  familyReasonLabel?: string
): LeaveFlowResult {
  const startFmt = format(parseISO(startDateIso), "d MMM yyyy");
  const endFmt = format(parseISO(endDateIso), "d MMM yyyy");
  const periodLabel = days === 1 ? startFmt : `${startFmt} – ${endFmt}`;
  const header = fastTracked
    ? `✨ *AI Pre-Filled Leave Application*\nPlease review and confirm:`
    : `📋 *Please Confirm Your Leave Application*:`;

  const docLine =
    pendingDocs.length > 0
      ? `\n• Supporting Document: *Attached (${pendingDocs[0]!.fileName})*`
      : "";
  const reasonDisplay = familyReasonLabel ? `${familyReasonLabel}` : reason;

  return {
    reply:
      `${header}\n\n` +
      `• Type: *${leaveTypeLabel}*\n` +
      `• Period: *${periodLabel}* (${days} day${days === 1 ? "" : "s"})\n` +
      `• Reason: *${reasonDisplay}*` +
      `${docLine}\n\n` +
      `1️⃣ *Confirm & Submit*\n` +
      `2️⃣ *Cancel Application*\n\n` +
      `Reply *1* or *yes* to submit, or *cancel* to discard.`,
    buttons: [
      { id: "leave_confirm_yes", title: "Confirm & Submit" },
      { id: "leave_confirm_cancel", title: "Cancel" },
    ],
  };
}

function promptDocumentUpload(params: {
  leaveType: LeaveTypeCode;
  leaveTypeLabel: string;
  mandatory: boolean;
  requirementReason?: string | null;
}): LeaveFlowResult {
  if (params.leaveType === "STUDY") {
    return {
      reply:
        `📄 *Study / School Proof Required*\n\n` +
        `Please send a clear *photo or PDF* of your proof of registration, exam timetable, or official institution letter right now to continue.\n\n` +
        `_(Reply *cancel* to abort)_`,
    };
  }

  if (params.leaveType === "SICK") {
    if (params.mandatory) {
      return {
        reply:
          `🩺 *Sick Note / Medical Certificate Required (BCEA §23)*\n\n` +
          `${params.requirementReason ?? "A medical certificate is required for this sick leave request."}\n\n` +
          `Please send a clear *photo or PDF* of your doctor's sick note right now to continue.\n\n` +
          `_(Reply *cancel* to abort)_`,
      };
    }

    return {
      reply:
        `🩺 *Attach Sick Note (Optional for 1–2 Days under BCEA §23)*\n\n` +
        `Send a *photo or PDF* of your sick note now if you have one, or tap *Skip* to continue without a sick note.\n\n` +
        `_(Reply *skip* to proceed without a note, or *cancel* to abort)_`,
      buttons: [
        { id: "leave_doc_skip", title: "Skip (<=2 days BCEA)" },
        { id: "leave_doc_cancel", title: "Cancel" },
      ],
    };
  }

  return {
    reply:
      `📄 *Supporting Proof (Optional)*\n\n` +
      `You can send a *photo or PDF* of supporting proof (e.g., clinic note, birth/death notice) now, or reply *skip* to continue.`,
    buttons: [
      { id: "leave_doc_skip", title: "Skip" },
      { id: "leave_doc_cancel", title: "Cancel" },
    ],
  };
}

async function advanceToDocumentOrConfirm(params: {
  from: string;
  employeeId: string;
  companyId: string;
  leaveType: LeaveTypeCode;
  leaveTypeLabel: string;
  startDateIso: string;
  endDateIso: string;
  days: number;
  reason: string;
  familyResponsibilityReason?: string;
  familyReasonLabel?: string;
  fastTracked: boolean;
}): Promise<LeaveFlowResult> {
  const startObj = new Date(`${params.startDateIso}T00:00:00.000Z`);
  const endObj = new Date(`${params.endDateIso}T00:00:00.000Z`);

  let previewDocRequired = params.leaveType === "STUDY";
  let previewReason: string | null = null;

  try {
    const preview = await previewLeaveRequest(params.companyId, {
      employeeId: params.employeeId,
      leaveType: params.leaveType,
      startDate: startObj,
      endDate: endObj,
      unitsRequested: params.days,
      familyResponsibilityReason: params.familyResponsibilityReason,
    });
    if (preview.exceedsBalance) {
      sessionManager.clearSession(params.from);
      return {
        reply:
          `⚠️ Insufficient *${params.leaveTypeLabel}* balance.\n` +
          `Requested: *${preview.deductibleUnits}* · Available: *${preview.availableUnits ?? 0}*.\n` +
          `Reply *leave balance* to view all balances or *menu* for main commands.`,
      };
    }
    previewDocRequired = preview.documentRequired;
    previewReason = preview.documentRequirementReason;
  } catch (err) {
    if (err instanceof LeaveV3Error) {
      sessionManager.clearSession(params.from);
      return {
        reply: `⚠️ ${err.message}\nPlease contact HR if you need assistance.`,
      };
    }
    // If preview is unavailable in lightweight unit mocks, apply statutory fallback:
    previewDocRequired = params.leaveType === "STUDY" || (params.leaveType === "SICK" && params.days > 2);
  }

  const needsDocumentPrompt =
    params.leaveType === "STUDY" ||
    params.leaveType === "SICK" ||
    params.leaveType === "FAMILY_RESPONSIBILITY";

  if (needsDocumentPrompt) {
    const mandatory =
      params.leaveType === "STUDY" || (params.leaveType === "SICK" && previewDocRequired);

    sessionManager.setSessionState(params.from, "LEAVE_AWAITING_DOCUMENT", {
      employeeId: params.employeeId,
      companyId: params.companyId,
      leaveType: params.leaveType,
      leaveTypeLabel: params.leaveTypeLabel,
      startDate: params.startDateIso,
      endDate: params.endDateIso,
      days: params.days,
      reason: params.reason,
      familyResponsibilityReason: params.familyResponsibilityReason,
      familyReasonLabel: params.familyReasonLabel,
      fastTracked: params.fastTracked,
      documentMandatory: mandatory,
      pendingDocuments: [],
    });

    return promptDocumentUpload({
      leaveType: params.leaveType,
      leaveTypeLabel: params.leaveTypeLabel,
      mandatory,
      requirementReason: previewReason,
    });
  }

  sessionManager.setSessionState(params.from, "LEAVE_CONFIRM", {
    employeeId: params.employeeId,
    companyId: params.companyId,
    leaveType: params.leaveType,
    leaveTypeLabel: params.leaveTypeLabel,
    startDate: params.startDateIso,
    endDate: params.endDateIso,
    days: params.days,
    reason: params.reason,
    familyResponsibilityReason: params.familyResponsibilityReason,
    familyReasonLabel: params.familyReasonLabel,
    fastTracked: params.fastTracked,
    pendingDocuments: [],
  });

  return buildLeaveConfirmResult(
    params.leaveTypeLabel,
    params.startDateIso,
    params.endDateIso,
    params.days,
    params.reason,
    params.fastTracked,
    [],
    params.familyReasonLabel
  );
}

export async function startLeaveFlow(
  from: string,
  employeeId: string,
  companyId: string
): Promise<LeaveFlowResult> {
  const empMeta = await getEmployeeLeaveMeta(companyId, employeeId);
  const canStudy =
    empMeta?.employeeType === "general" || empMeta?.employeeType === "security_officer"
      ? isLeaveTypeAvailable("STUDY", empMeta.employeeType)
      : true;

  let balanceSummary = "";
  try {
    const balances = await getLeaveBalances(companyId, employeeId);
    if (balances.length > 0) {
      balanceSummary =
        "\n📊 *Your Available Balances*:\n" +
        balances
          .map((b) => `• ${LEAVE_CODE_LABELS[b.leaveType] ?? b.leaveType}: *${b.availableUnits}*`)
          .join("\n") +
        "\n";
    }
  } catch {
    // Ignore balance read errors in lightweight/mock contexts
  }

  sessionManager.setSessionState(from, "LEAVE_SELECT_TYPE", {
    employeeId,
    companyId,
    employeeType: empMeta?.employeeType ?? null,
    startedAt: new Date().toISOString(),
  });

  const studyOption = canStudy
    ? `\n4️⃣ *Study Leave* (Exams / Approved courses — proof required)`
    : "";

  return {
    reply:
      `🌴 *Apply for Leave* (Step 1/4)\n` +
      `${balanceSummary}\n` +
      `Select the type of leave you wish to take:\n\n` +
      `1️⃣ *Annual Leave* (21 days/yr — public holidays excluded)\n` +
      `2️⃣ *Sick Leave* (BCEA §23 — sick note required >2 days)\n` +
      `3️⃣ *Family Responsibility* (3 days/yr — after 4 months service)${studyOption}\n\n` +
      `Reply with *1–${canStudy ? "4" : "3"}* or type *cancel* to abort.`,
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
  const empMeta = await getEmployeeLeaveMeta(companyId, employeeId);

  if (
    empMeta?.employeeType &&
    (empMeta.employeeType === "general" || empMeta.employeeType === "security_officer")
  ) {
    if (!isLeaveTypeAvailable(leaveType, empMeta.employeeType)) {
      return {
        reply: `⚠️ *${leaveTypeLabel}* is only available to NBCPSS-covered security officers under current company rules. Please choose Annual, Sick, or Family Responsibility leave.`,
      };
    }

    if (
      leaveType === "FAMILY_RESPONSIBILITY" &&
      empMeta.commencementDate &&
      !isEligibleForFamilyResponsibilityLeave({
        employeeType: empMeta.employeeType,
        commencementDate: empMeta.commencementDate,
        asOf: extracted.startDateIso ? new Date(`${extracted.startDateIso}T00:00:00.000Z`) : new Date(),
      })
    ) {
      return {
        reply:
          `⚠️ Under BCEA §27, *Family Responsibility Leave* requires more than 4 months of service with the company.\n` +
          `You may apply for *Annual Leave* instead or contact HR.`,
      };
    }
  }

  const parsedStart = extracted.startDateIso ? parseUserDate(extracted.startDateIso) : null;
  if (!parsedStart) {
    if (leaveType === "FAMILY_RESPONSIBILITY" && !extracted.familyResponsibilityReason) {
      sessionManager.setSessionState(from, "LEAVE_SELECT_FAMILY_REASON", {
        employeeId,
        companyId,
        startedAt: new Date().toISOString(),
        leaveType,
        leaveTypeLabel,
        prefilledReason: extracted.reason,
      });
      return promptFamilyReasonSelection();
    }

    sessionManager.setSessionState(from, "LEAVE_ENTER_START_DATE", {
      employeeId,
      companyId,
      startedAt: new Date().toISOString(),
      leaveType,
      leaveTypeLabel,
      prefilledReason: extracted.reason,
      familyResponsibilityReason: extracted.familyResponsibilityReason,
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
  const defaultReason =
    leaveType === "SICK"
      ? "Medical illness"
      : leaveType === "STUDY"
        ? "Approved study / exam"
        : "Personal Leave";
  const reason = extracted.reason?.trim() || defaultReason;

  if (leaveType === "FAMILY_RESPONSIBILITY" && !extracted.familyResponsibilityReason) {
    sessionManager.setSessionState(from, "LEAVE_SELECT_FAMILY_REASON", {
      employeeId,
      companyId,
      startedAt: new Date().toISOString(),
      leaveType,
      leaveTypeLabel,
      startDate: startDateIso,
      endDate: endDateIso,
      days,
      prefilledReason: reason,
      fastTracked: true,
    });
    return promptFamilyReasonSelection();
  }

  const familyChoice = FAMILY_REASON_CHOICES.find(
    (c) => c.code === extracted.familyResponsibilityReason
  );

  return advanceToDocumentOrConfirm({
    from,
    employeeId,
    companyId,
    leaveType,
    leaveTypeLabel,
    startDateIso,
    endDateIso,
    days,
    reason,
    familyResponsibilityReason: extracted.familyResponsibilityReason,
    familyReasonLabel: familyChoice?.label ?? extracted.familyResponsibilityReason,
    fastTracked: true,
  });
}

function promptFamilyReasonSelection(): LeaveFlowResult {
  return {
    reply:
      `👪 *Family Responsibility Reason (BCEA §27)*\n\n` +
      `Please select the statutory reason:\n` +
      FAMILY_REASON_CHOICES.map((c) => `${c.key}️⃣ ${c.label}`).join("\n") +
      `\n\nReply with *1–7* or type *cancel* to abort.`,
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

  const empMeta = await getEmployeeLeaveMeta(session.companyId, session.employeeId);
  if (
    empMeta?.employeeType &&
    (empMeta.employeeType === "general" || empMeta.employeeType === "security_officer")
  ) {
    if (!isLeaveTypeAvailable(selected.code, empMeta.employeeType)) {
      return {
        reply: `⚠️ *${selected.label}* is not available for your employee type under company BCEA rules. Please choose *1 (Annual)*, *2 (Sick)*, or *3 (Family Responsibility)*.`,
      };
    }

    if (
      selected.code === "FAMILY_RESPONSIBILITY" &&
      empMeta.commencementDate &&
      !isEligibleForFamilyResponsibilityLeave({
        employeeType: empMeta.employeeType,
        commencementDate: empMeta.commencementDate,
        asOf: new Date(),
      })
    ) {
      sessionManager.clearSession(from);
      return {
        reply:
          `⚠️ Under BCEA §27, *Family Responsibility Leave* requires more than 4 months of service.\n` +
          `Please reply *menu* to apply for Annual Leave or contact HR.`,
      };
    }
  }

  if (selected.code === "FAMILY_RESPONSIBILITY") {
    sessionManager.setSessionState(from, "LEAVE_SELECT_FAMILY_REASON", {
      leaveType: selected.code,
      leaveTypeLabel: selected.label,
    });
    return promptFamilyReasonSelection();
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

export async function handleLeaveSelectFamilyReason(
  from: string,
  text: string,
  session: ConversationSession
): Promise<LeaveFlowResult> {
  const clean = text.trim().toLowerCase();
  const match = FAMILY_REASON_CHOICES.find(
    (c) => c.key === clean || c.code.toLowerCase() === clean
  );
  if (!match) {
    return {
      reply:
        `⚠️ Please reply with a number *1–7* to select the BCEA §27 reason:\n\n` +
        FAMILY_REASON_CHOICES.map((c) => `${c.key}️⃣ ${c.label}`).join("\n"),
    };
  }

  // If smart leave already captured dates, jump straight to document/confirm
  if (session.data.startDate && session.data.endDate && session.data.days) {
    return advanceToDocumentOrConfirm({
      from,
      employeeId: session.employeeId,
      companyId: session.companyId,
      leaveType: session.data.leaveType,
      leaveTypeLabel: session.data.leaveTypeLabel,
      startDateIso: session.data.startDate,
      endDateIso: session.data.endDate,
      days: session.data.days,
      reason: session.data.prefilledReason || match.label,
      familyResponsibilityReason: match.code,
      familyReasonLabel: match.label,
      fastTracked: Boolean(session.data.fastTracked),
    });
  }

  sessionManager.setSessionState(from, "LEAVE_ENTER_START_DATE", {
    familyResponsibilityReason: match.code,
    familyReasonLabel: match.label,
    prefilledReason: match.label,
  });

  return {
    reply:
      `📅 *Leave Start Date* (Step 2/4)\n\n` +
      `Type: *${session.data.leaveTypeLabel}* (${match.label})\n\n` +
      `When does your leave start?\n` +
      `Reply with a date (e.g. \`${format(addDays(new Date(), 1), "yyyy-MM-dd")}\`, *28 Nov*, *tomorrow*, or *today*):`,
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
    return advanceToDocumentOrConfirm({
      from,
      employeeId: session.employeeId,
      companyId: session.companyId,
      leaveType: session.data.leaveType,
      leaveTypeLabel: session.data.leaveTypeLabel,
      startDateIso: session.data.startDate,
      endDateIso,
      days,
      reason: session.data.prefilledReason.trim(),
      familyResponsibilityReason: session.data.familyResponsibilityReason,
      familyReasonLabel: session.data.familyReasonLabel,
      fastTracked: true,
    });
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

  return advanceToDocumentOrConfirm({
    from,
    employeeId: session.employeeId,
    companyId: session.companyId,
    leaveType: session.data.leaveType,
    leaveTypeLabel: session.data.leaveTypeLabel,
    startDateIso: session.data.startDate,
    endDateIso: session.data.endDate,
    days: session.data.days,
    reason,
    familyResponsibilityReason: session.data.familyResponsibilityReason,
    familyReasonLabel: session.data.familyReasonLabel,
    fastTracked: false,
  });
}

export async function handleLeaveAwaitingDocumentText(
  from: string,
  text: string,
  session: ConversationSession
): Promise<LeaveFlowResult> {
  const clean = text.trim().toLowerCase();
  if (clean === "leave_doc_cancel" || clean === "cancel") {
    sessionManager.clearSession(from);
    return { reply: "Leave application cancelled. Reply *menu* for available commands." };
  }

  const mandatory = Boolean(session.data.documentMandatory);
  if ((clean === "skip" || clean === "leave_doc_skip") && !mandatory) {
    sessionManager.setSessionState(from, "LEAVE_CONFIRM", {
      pendingDocuments: session.data.pendingDocuments ?? [],
    });
    return buildLeaveConfirmResult(
      session.data.leaveTypeLabel,
      session.data.startDate,
      session.data.endDate,
      session.data.days,
      session.data.reason,
      Boolean(session.data.fastTracked),
      session.data.pendingDocuments ?? [],
      session.data.familyReasonLabel
    );
  }

  return promptDocumentUpload({
    leaveType: session.data.leaveType,
    leaveTypeLabel: session.data.leaveTypeLabel,
    mandatory,
  });
}

export function attachDraftDocumentToLeaveSession(
  from: string,
  session: ConversationSession,
  doc: PendingLeaveDocument
): LeaveFlowResult {
  const existingDocs = Array.isArray(session.data.pendingDocuments)
    ? (session.data.pendingDocuments as PendingLeaveDocument[])
    : [];
  const nextDocs = [...existingDocs, doc];

  sessionManager.setSessionState(from, "LEAVE_CONFIRM", {
    pendingDocuments: nextDocs,
  });

  return buildLeaveConfirmResult(
    session.data.leaveTypeLabel,
    session.data.startDate,
    session.data.endDate,
    session.data.days,
    session.data.reason,
    Boolean(session.data.fastTracked),
    nextDocs,
    session.data.familyReasonLabel
  );
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
    const {
      leaveType,
      leaveTypeLabel,
      startDate,
      endDate,
      days,
      reason,
      familyResponsibilityReason,
      pendingDocuments,
    } = session.data;
    const startObj = new Date(`${startDate}T00:00:00.000Z`);
    const endObj = new Date(`${endDate}T00:00:00.000Z`);
    const docs: PendingLeaveDocument[] = Array.isArray(pendingDocuments) ? pendingDocuments : [];

    try {
      const request = await createLeaveRequest(session.companyId, session.employeeId, {
        employeeId: session.employeeId,
        leaveType,
        startDate: startObj,
        endDate: endObj,
        unitsRequested: days,
        reason,
        familyResponsibilityReason:
          leaveType === "FAMILY_RESPONSIBILITY"
            ? (familyResponsibilityReason || "CHILD_SICK")
            : undefined,
      });

      for (const doc of docs) {
        await attachLeaveSupportingDocument({
          companyId: session.companyId,
          actorUserId: session.employeeId,
          leaveRequestId: request.id,
          kind: doc.kind ?? defaultDocumentKindForLeaveType(leaveType),
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          fileReference: doc.fileReference,
        });
      }

      if (leaveType === "SICK" && docs.length === 0) {
        sessionManager.setSessionState(from, "LEAVE_AWAITING_CERTIFICATE", {
          employeeId: session.employeeId,
          companyId: session.companyId,
          leaveRequestId: request.id,
        });
      } else {
        sessionManager.clearSession(from);
      }

      const docSummary =
        docs.length > 0
          ? `\n• Supporting Document: *Attached (${docs.length})*`
          : leaveType === "SICK"
            ? `\n\n📄 *Medical Certificate*: You can send a photo/PDF of your sick note anytime with caption *leave ${request.id}*.`
            : "";

      return {
        reply:
          `✅ *Leave Application Submitted*\n\n` +
          `• Reference: *${request.id}*\n` +
          `• Type: *${leaveTypeLabel}*\n` +
          `• Duration: *${days} day(s)* (${startDate} to ${endDate})\n` +
          `• Status: *Pending HR Approval*\n` +
          `${docSummary}\n\n` +
          `HR has been notified in the Leave module. You will receive a WhatsApp message as soon as a decision is made.\n\n` +
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

  sessionManager.clearSession(from);
  return {
    reply: `Leave application cancelled. Reply *menu* for available commands.`,
  };
}
