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
  "SUPERVISOR",
  "FAQ_HELP",
  "UNKNOWN",
] as const;

export type WhatsAppAiIntent = (typeof WHATSAPP_AI_INTENTS)[number];

const intentResponseSchema = z.object({
  intent: z.enum(WHATSAPP_AI_INTENTS),
  confidence: z.number().min(0).max(1),
  reply: z.string().max(400).optional(),
});

export type WhatsAppIntentClassification = z.infer<typeof intentResponseSchema>;

export const INTENT_CONFIDENCE_THRESHOLD = 0.75;

const SYSTEM_PROMPT = [
  "You are the intent classifier for Plethora ERP, a South African private security workforce system.",
  "Classify the employee's free-text WhatsApp message into exactly one intent:",
  "- CLOCK_IN: starting shift, arrived at site/gate/office, booking on duty",
  "- CLOCK_OUT: ending shift, leaving site/office, booking off duty",
  "- ROSTER: asking when they work, upcoming shifts, schedule, duty roster",
  "- PAYSLIP: asking for payslip, salary slip, pay stub, earnings PDF",
  "- LEAVE_APPLY: requesting time off, sick leave, annual leave, family responsibility leave",
  "- LEAVE_BALANCE: asking how many leave/vacation/sick days they have left",
  "- LEAVE_HISTORY: checking status of a submitted leave application",
  "- INCIDENT_REPORT: reporting theft, break-in, alarm, hazard, emergency, trespassing, damage",
  "- STATUS: asking current duty status or next scheduled shift",
  "- SUPERVISOR: asking to speak to a controller, manager, supervisor, or HR",
  "- FAQ_HELP: greeting or asking what this WhatsApp bot can do",
  "- UNKNOWN: unrelated or ambiguous message",
  "Respond ONLY with valid JSON: {\"intent\":\"...\",\"confidence\":0.0-1.0,\"reply\":\"short optional helpful reply\"}.",
  "Never invent numbers, payslip amounts, shift times, or leave balances.",
].join("\n");

export async function classifyWhatsAppIntent(
  text: string,
  employeeContext: { firstName: string; employeeType?: string | null },
  chatFn: typeof chatWithLlm = chatWithLlm
): Promise<WhatsAppIntentClassification | null> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 500) return null;

  const result = await chatFn({
    jsonMode: true,
    temperature: 0.05,
    maxTokens: 160,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
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
    maxTokens: 250,
    messages: [
      {
        role: "system",
        content:
          "Rewrite the security officer's raw incident notes into a concise, factual, professional Occurrence Book (OB) summary in plain English. Do not invent facts, times, or names not present in the input.",
      },
      { role: "user", content: trimmed },
    ],
  });

  return result?.content ?? null;
}
