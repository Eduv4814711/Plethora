import OpenAI from "openai";
import { prisma } from "../lib/prisma.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/tiff"];

export interface TimesheetEntry {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  hoursWorked?: number;
  isOvernight?: boolean;
  needsReview?: boolean;
}

export interface ExtractedTimesheet {
  employeeName?: string;
  employeeNumber?: string;
  siteName?: string;
  identityNumber?: string;
  periodStart?: string;
  periodEnd?: string;
  year?: string;
  entries: TimesheetEntry[];
  rawText?: string;
}

export interface MatchedEmployee {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
}

export interface MatchedSite {
  id: string;
  name: string;
  posts: { id: string; name: string }[];
}

export interface TimesheetExtractResult {
  extracted: ExtractedTimesheet;
  matchedEmployee: MatchedEmployee | null;
  matchedSite: MatchedSite | null;
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeEmployeeNumber(s: string): string {
  return s.replace(/[\s\-_]/g, "").toUpperCase();
}

async function matchEmployee(
  companyId: string,
  employeeName?: string,
  employeeNumber?: string
): Promise<MatchedEmployee | null> {
  const employees = await prisma.employee.findMany({
    where: { companyId, status: { in: ["active", "training", "suspended", "hired"] } },
    select: { id: true, firstName: true, lastName: true, employeeNumber: true },
  });

  if (employeeNumber) {
    const norm = normalizeEmployeeNumber(employeeNumber);
    const byNumber = employees.find((e) => e.employeeNumber && normalizeEmployeeNumber(e.employeeNumber) === norm);
    if (byNumber) return byNumber as MatchedEmployee;
    const partial = employees.find(
      (e) => e.employeeNumber && normalizeEmployeeNumber(e.employeeNumber).includes(norm)
    );
    if (partial) return partial as MatchedEmployee;
  }

  if (employeeName) {
    const parts = employeeName.trim().split(/\s+/);
    const first = parts[0]?.toLowerCase() ?? "";
    const last = parts.slice(1).join(" ").toLowerCase() ?? "";
    const byName = employees.find((e) => {
      const ef = e.firstName.toLowerCase();
      const el = e.lastName.toLowerCase();
      return (ef === first && el === last) || (ef.includes(first) && el.includes(last));
    });
    if (byName) return byName as MatchedEmployee;
  }

  return null;
}

async function matchSite(companyId: string, siteName?: string): Promise<MatchedSite | null> {
  if (!siteName?.trim()) return null;

  const sites = await prisma.site.findMany({
    where: { companyId },
    include: { posts: { select: { id: true, name: true } } },
  });

  const norm = normalizeForMatch(siteName);
  const exact = sites.find((s) => normalizeForMatch(s.name) === norm);
  if (exact) return { id: exact.id, name: exact.name, posts: exact.posts };

  const contains = sites.find((s) => normalizeForMatch(s.name).includes(norm) || norm.includes(normalizeForMatch(s.name)));
  if (contains) return { id: contains.id, name: contains.name, posts: contains.posts };

  return null;
}

function parseTime(s: string): { hours: number; minutes: number } | null {
  const m = s.match(/(\d{1,2})[:\/](\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { hours: h, minutes: min };
  return null;
}

function parseDate(s: string): string | null {
  const m = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function isOffOrEmpty(s: string): boolean {
  const t = s.toLowerCase().trim();
  return !t || t === "off" || t === "-" || t === "—";
}

function normalizeEntry(entry: {
  date?: string;
  startTime?: string;
  endTime?: string;
  hoursWorked?: number;
}): TimesheetEntry | null {
  const dateStr = entry.date?.trim();
  const startStr = (entry.startTime ?? "").trim();
  const finishStr = (entry.endTime ?? "").trim();

  if (isOffOrEmpty(startStr) && isOffOrEmpty(finishStr)) return null;
  if (!dateStr) return null;

  const year = new Date().getFullYear();
  const date = parseDate(dateStr) ?? parseDate(`${year}/${dateStr}`);
  if (!date) return null;

  const startTime = parseTime(startStr);
  const finishTime = parseTime(finishStr);

  if (!startTime || !finishTime) {
    return {
      date,
      startTime: startStr || "00:00",
      endTime: finishStr || "00:00",
      needsReview: true,
    };
  }

  let isOvernight = false;
  if (finishTime.hours < startTime.hours || (finishTime.hours === startTime.hours && finishTime.minutes < startTime.minutes)) {
    isOvernight = true;
  }

  const startFormatted = `${String(startTime.hours).padStart(2, "0")}:${String(startTime.minutes).padStart(2, "0")}`;
  const finishFormatted = `${String(finishTime.hours).padStart(2, "0")}:${String(finishTime.minutes).padStart(2, "0")}`;

  return {
    date,
    startTime: startFormatted,
    endTime: finishFormatted,
    hoursWorked: entry.hoursWorked,
    isOvernight,
  };
}

const EXTRACT_PROMPT = `You are extracting data from an attendance register or timesheet image. The image may contain handwritten or printed text.

Extract the following and return ONLY valid JSON (no markdown, no code blocks):

{
  "employeeName": "Full name from NAME AND SURNAME OF EMPLOYEE",
  "employeeNumber": "Employee number e.g. QBS 0088",
  "siteName": "Site name from SITE NAME",
  "identityNumber": "Identity number if visible",
  "year": "Year from the period e.g. 2026",
  "entries": [
    {
      "date": "YYYY-MM-DD",
      "startTime": "HH:mm",
      "endTime": "HH:mm",
      "hoursWorked": number or null
    }
  ]
}

Rules:
- For each row in the main attendance table, extract: Date, Starting Time, Finishing Time, and Total hours worked (each day).
- Date format: YYYY-MM-DD (e.g. 2026-01-26). If the image shows YYYY/MM/DD, convert it.
- Time format: HH:mm (e.g. 06:00, 18:00). Ignore "off", "077", or invalid entries.
- Skip rows where both start and finish are empty, "off", or invalid.
- For overnight shifts (e.g. start 18:00, finish 06:00), keep the times as-is; the system will handle the next-day logic.
- If handwriting is unclear, use your best guess and include the entry.
- Return an empty entries array [] if no valid rows are found.
- Do not include any text before or after the JSON.`;

export async function extractTimesheetFromImage(
  imageBuffer: Buffer,
  companyId: string
): Promise<TimesheetExtractResult> {
  if (imageBuffer.length > MAX_FILE_SIZE) {
    throw new Error("File too large. Maximum size is 5MB.");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OpenAI API is not configured. Set OPENAI_API_KEY in your environment."
    );
  }

  const client = new OpenAI({ apiKey });
  const base64 = imageBuffer.toString("base64");
  const mimeType = "image/jpeg";
  const dataUrl = `data:${mimeType};base64,${base64}`;

  let response;
  try {
    response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACT_PROMPT },
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "high" as const },
            },
          ],
        },
      ],
      max_tokens: 4096,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("api_key") || msg.includes("invalid_api_key") || msg.includes("Incorrect API key")) {
      throw new Error(
        "OpenAI API is not configured. Set OPENAI_API_KEY in your environment."
      );
    }
    throw new Error(`OCR failed: ${msg}. Try a clearer image with good lighting.`);
  }

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("No response from OCR. Try a clearer image.");
  }

  let parsed: {
    employeeName?: string;
    employeeNumber?: string;
    siteName?: string;
    identityNumber?: string;
    year?: string;
    entries?: Array<{ date?: string; startTime?: string; endTime?: string; hoursWorked?: number }>;
  };

  try {
    const jsonStr = content.replace(/^```json\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Could not parse extracted data. Try a clearer image.");
  }

  const extracted: ExtractedTimesheet = {
    employeeName: parsed.employeeName || undefined,
    employeeNumber: parsed.employeeNumber || undefined,
    siteName: parsed.siteName || undefined,
    identityNumber: parsed.identityNumber || undefined,
    year: parsed.year || undefined,
    entries: [],
  };

  const rawEntries = parsed.entries ?? [];
  for (const e of rawEntries) {
    const normalized = normalizeEntry({
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime,
      hoursWorked: e.hoursWorked,
    });
    if (normalized) extracted.entries.push(normalized);
  }

  const dates = extracted.entries.map((e) => e.date).filter(Boolean);
  if (dates.length > 0) {
    extracted.periodStart = dates[0];
    extracted.periodEnd = dates[dates.length - 1];
  }

  const matchedEmployee = await matchEmployee(
    companyId,
    extracted.employeeName,
    extracted.employeeNumber
  );
  const matchedSite = await matchSite(companyId, extracted.siteName);

  return {
    extracted,
    matchedEmployee,
    matchedSite,
  };
}

export function validateTimesheetImage(
  mimetype: string,
  size: number
): { ok: boolean; error?: string } {
  if (!ALLOWED_TYPES.includes(mimetype)) {
    return { ok: false, error: "Invalid file type. Use PNG, JPEG, or TIFF." };
  }
  if (size > MAX_FILE_SIZE) {
    return { ok: false, error: "File too large. Maximum size is 5MB." };
  }
  return { ok: true };
}
