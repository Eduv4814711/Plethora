import { z } from "zod";
import { chatWithLlm } from "./llm-client.js";

export const WHATSAPP_AI_INTENTS = [
  "CLOCK_IN",
  "CLOCK_OUT",
  "ROSTER",
  "PAYSLIP",
  "LEAVE_APPLY",
  "LEAVE_BALANCE",
  "LEAVE_HISTORY",
  "INCIDENT_REPORT",
  "STATUS",
  "COMPLIANCE_STATUS",
  "OPERATIONAL_QUESTION",
  "SUPERVISOR",
  "FAQ_HELP",
  "UNKNOWN",
] as const;

export type WhatsAppAiIntent = (typeof WHATSAPP_AI_INTENTS)[number];

const emptyOrNullToUndefined = (val: unknown): unknown => {
  if (val === null || val === undefined) return undefined;
  if (typeof val === "string" && val.trim() === "") return undefined;
  return val;
};

const optionalIsoDateSchema = z.preprocess(
  emptyOrNullToUndefined,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
);

export const extractedLeaveParamsSchema = z.object({
  leaveType: z.preprocess(
    emptyOrNullToUndefined,
    z.enum(["ANNUAL", "SICK", "FAMILY_RESPONSIBILITY", "STUDY"]).optional()
  ),
  startDateIso: optionalIsoDateSchema,
  endDateIso: optionalIsoDateSchema,
  reason: z.preprocess(emptyOrNullToUndefined, z.string().max(240).optional()),
  familyResponsibilityReason: z.preprocess(
    emptyOrNullToUndefined,
    z
      .enum([
        "CHILD_BIRTH",
        "CHILD_SICK",
        "SPOUSE_OR_LIFE_PARTNER_DEATH",
        "PARENT_DEATH",
        "ADOPTIVE_PARENT_DEATH",
        "GRANDPARENT_DEATH",
        "CHILD_DEATH",
        "ADOPTED_CHILD_DEATH",
        "GRANDCHILD_DEATH",
        "SIBLING_DEATH",
      ])
      .optional()
  ),
});

export const extractedIncidentParamsSchema = z.object({
  categoryKey: z.preprocess(
    emptyOrNullToUndefined,
    z.enum(["1", "2", "3", "4", "5"]).optional()
  ),
  siteHint: z.preprocess(emptyOrNullToUndefined, z.string().max(120).optional()),
  details: z.preprocess(emptyOrNullToUndefined, z.string().max(1500).optional()),
});

export type ExtractedLeaveParams = z.infer<typeof extractedLeaveParamsSchema>;
export type ExtractedIncidentParams = z.infer<typeof extractedIncidentParamsSchema>;

const intentResponseSchema = z.object({
  intent: z.enum(WHATSAPP_AI_INTENTS),
  confidence: z.number().min(0).max(1),
  reply: z.preprocess(emptyOrNullToUndefined, z.string().max(400).optional()),
  leaveParams: z.preprocess(emptyOrNullToUndefined, extractedLeaveParamsSchema.optional()),
  incidentParams: z.preprocess(emptyOrNullToUndefined, extractedIncidentParamsSchema.optional()),
});

export type WhatsAppIntentClassification = z.infer<typeof intentResponseSchema>;

export const INTENT_CONFIDENCE_THRESHOLD = 0.75;

function buildSystemPrompt(todayIso: string): string {
  return [
    "You are the multilingual operational intent & entity extractor for Plethora ERP, a South African private security workforce system.",
    `Today's date in the company timezone is ${todayIso}.`,
    "Understand messages in English, isiZulu, isiXhosa, Sesotho, Setswana, Afrikaans, or code-switched South African English.",
    "Always write any `reply`, `reason`, or `details` summary in clear, plain English.",
    "Classify the employee's WhatsApp message into exactly ONE intent:",
    "- CLOCK_IN: starting shift, arrived at site/gate/office, booking on duty (e.g. 'ek wil inklok', 'ngifikile esangweni')",
    "- CLOCK_OUT: ending shift, leaving site/office, booking off duty ('shayela off', 'knocking off')",
    "- ROSTER: asking for full duty roster PDF or upcoming month schedule",
    "- PAYSLIP: asking about payslip, salary, wages, or net pay (managed externally via Sage Payroll)",
    "- LEAVE_APPLY: requesting time off, sick leave, annual leave, family responsibility, or study leave",
    "- LEAVE_BALANCE: asking how many leave/vacation/sick days they have left",
    "- LEAVE_HISTORY: checking whether a submitted leave application was approved/pending",
    "- INCIDENT_REPORT: reporting an incident, break-in, theft, fence cut, alarm, hazard, emergency, misconduct, equipment failure, or client complaint",
    "- STATUS: asking current clock-in status or simple next shift check",
    "- COMPLIANCE_STATUS: asking about PSIRA grade/registration/expiry, firearm competency expiry, or compliance documents",
    "- OPERATIONAL_QUESTION: specific question about their own shifts (e.g. 'where am I working Friday?'), attendance, or operational rules not covered by a single static command",
    "- SUPERVISOR: asking to speak to a human controller, supervisor, manager, or HR",
    "- FAQ_HELP: greeting ('hi', 'sawubona', 'dumela', 'hallo') or asking what this assistant can do",
    "- UNKNOWN: unrelated or unintelligible message",
    "When intent is LEAVE_APPLY, extract `leaveParams` if mentioned:",
    "  - leaveType: ANNUAL | SICK | FAMILY_RESPONSIBILITY | STUDY",
    `  - startDateIso / endDateIso: YYYY-MM-DD resolved relative to ${todayIso} (if single day, set endDateIso = startDateIso)`,
    "  - reason: concise English reason if stated",
    "  - familyResponsibilityReason: if FAMILY_RESPONSIBILITY, map to CHILD_BIRTH | CHILD_SICK | SPOUSE_OR_LIFE_PARTNER_DEATH | PARENT_DEATH | ADOPTIVE_PARENT_DEATH | GRANDPARENT_DEATH | CHILD_DEATH | ADOPTED_CHILD_DEATH | GRANDCHILD_DEATH | SIBLING_DEATH when clear",
    "When intent is INCIDENT_REPORT, extract `incidentParams` if mentioned:",
    "  - categoryKey: '1' (Site Emergency/Safety), '2' (Break-in/Theft/Trespass), '3' (Guard Misconduct/Absence), '4' (Equipment/Fence/Gate/Power Damage), '5' (Client Complaint/Other)",
    "  - siteHint: site or post name if mentioned",
    "  - details: factual English summary of what happened if the user already described the event",
    "Respond ONLY with valid JSON matching:",
    '{"intent":"...","confidence":0.0-1.0,"reply":"optional short reply","leaveParams":{...},"incidentParams":{...}}',
    "Never invent numbers, payslip amounts, shift times, or leave balances.",
  ].join("\n");
}

export async function classifyWhatsAppIntent(
  text: string,
  employeeContext: { firstName: string; employeeType?: string | null; todayIso?: string },
  chatFn: typeof chatWithLlm = chatWithLlm
): Promise<WhatsAppIntentClassification | null> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 800) return null;

  const todayIso = employeeContext.todayIso ?? new Date().toISOString().slice(0, 10);

  const result = await chatFn({
    jsonMode: true,
    temperature: 0.05,
    maxTokens: 320,
    messages: [
      { role: "system", content: buildSystemPrompt(todayIso) },
      {
        role: "user",
        content: `Employee: ${employeeContext.firstName} (${employeeContext.employeeType ?? "security_officer"})\nMessage: ${trimmed}`,
      },
    ],
  });

  if (!result) return null;

  try {
    const parsedJson = JSON.parse(result.content);
    const validated = intentResponseSchema.safeParse(parsedJson);
    if (!validated.success) return null;
    return validated.data;
  } catch {
    return null;
  }
}

export async function polishIncidentSummary(
  rawNotes: string,
  chatFn: typeof chatWithLlm = chatWithLlm
): Promise<string | null> {
  const trimmed = rawNotes.trim();
  if (!trimmed) return null;

  const result = await chatFn({
    temperature: 0.2,
    maxTokens: 280,
    messages: [
      {
        role: "system",
        content:
          "Rewrite the security officer's raw incident notes (which may be in English or a South African language) into a concise, factual, professional Occurrence Book (OB) summary in plain English. Do not invent facts, times, or names not present in the input.",
      },
      { role: "user", content: trimmed },
    ],
  });

  return result?.content ?? null;
}
