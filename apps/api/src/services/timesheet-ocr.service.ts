import { createWorker } from "tesseract.js";
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
  return !t || t === "off" || t === "-" || t === "—" || t === "077";
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

function parseTesseractOutput(text: string): ExtractedTimesheet {
  const extracted: ExtractedTimesheet = { entries: [] };
  extracted.rawText = text;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const isLabel = (s: string) => /(name|employee|site|identity|year|number|address|period)\s*:/i.test(s);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    const nextLine = lines[i + 1]?.trim() ?? "";
    if (lower.includes("name") && lower.includes("surname") && lower.includes("employee")) {
      const m = line.match(/:\s*(.+)$/);
      if (m && m[1].trim().length > 1) extracted.employeeName = m[1].trim();
      else if (nextLine && !isLabel(nextLine) && nextLine.length > 2 && nextLine.length < 50) extracted.employeeName = nextLine;
    } else if (lower.includes("employee") && lower.includes("number") && !lower.includes("identity")) {
      const m = line.match(/:\s*(.+)$/);
      if (m && m[1].trim()) extracted.employeeNumber = m[1].trim();
      else if (nextLine && /^[A-Z0-9\s\-]+$/i.test(nextLine) && nextLine.length <= 20 && !isLabel(nextLine)) extracted.employeeNumber = nextLine;
    } else if (lower.includes("site") && lower.includes("name")) {
      const m = line.match(/:\s*(.+)$/);
      if (m && m[1].trim()) extracted.siteName = m[1].trim();
      else if (nextLine && !isLabel(nextLine) && nextLine.length > 2) extracted.siteName = nextLine;
    } else if (lower.includes("identity") && lower.includes("number")) {
      const m = line.match(/:\s*(\d+)$/);
      if (m) extracted.identityNumber = m[1].trim();
      else if (nextLine && /^\d{13}$/.test(nextLine.replace(/\s/g, ""))) extracted.identityNumber = nextLine.replace(/\s/g, "");
    } else if (lower.includes("year") && /\d{4}/.test(line)) {
      const m = line.match(/(\d{4})/);
      if (m) extracted.year = m[1];
    }
  }

  const seen = new Set<string>();

  const tryAddEntry = (dateStr: string, startStr: string, finishStr: string, hoursWorked?: number) => {
    if (isOffOrEmpty(startStr) || isOffOrEmpty(finishStr)) return;
    const normalized = normalizeEntry({ date: dateStr, startTime: startStr, endTime: finishStr, hoursWorked });
    if (normalized) {
      const key = `${normalized.date}-${normalized.startTime}`;
      if (!seen.has(key)) {
        seen.add(key);
        extracted.entries.push(normalized);
      }
    }
  };

  for (const line of lines) {
    const rowRegex = /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\s+\w{2,3}\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})/g;
    const matches = [...line.matchAll(rowRegex)];
    for (const m of matches) {
      const hoursMatch = line.match(/(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+(\d+(?:\.\d+)?)/);
      const hours = hoursMatch ? parseFloat(hoursMatch[3]) : undefined;
      tryAddEntry(m[1], m[2], m[3], hours);
    }
  }

  if (extracted.entries.length === 0) {
    const flexRegex = /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})[^\d]*(\d{1,2}:\d{2})[^\d]*(\d{1,2}:\d{2})/g;
    for (const line of lines) {
      const matches = [...line.matchAll(flexRegex)];
      for (const m of matches) {
        const hoursMatch = line.match(/(\d{1,2}:\d{2})[^\d]*(\d{1,2}:\d{2})[^\d]*(\d+(?:\.\d+)?)/);
        const hours = hoursMatch ? parseFloat(hoursMatch[3]) : undefined;
        tryAddEntry(m[1], m[2], m[3], hours);
      }
    }
  }

  extracted.entries.sort((a, b) => a.date.localeCompare(b.date));
  const dates = extracted.entries.map((e) => e.date).filter(Boolean);
  if (dates.length > 0) {
    extracted.periodStart = dates[0];
    extracted.periodEnd = dates[dates.length - 1];
  }

  return extracted;
}

async function extractWithTesseract(imageBuffer: Buffer): Promise<ExtractedTimesheet> {
  const worker = await createWorker("eng", 1, { logger: () => {} });
  try {
    const { data } = await worker.recognize(imageBuffer);
    return parseTesseractOutput(data.text || "");
  } finally {
    await worker.terminate();
  }
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

async function extractWithOpenAI(imageBuffer: Buffer): Promise<ExtractedTimesheet> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API is not configured. Set OPENAI_API_KEY in your environment.");
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
    if (msg.includes("429") || msg.includes("quota") || msg.includes("exceeded")) {
      throw new Error(
        "OpenAI quota exceeded. Add billing credits at platform.openai.com or set TIMESHEET_OCR_PROVIDER=tesseract in .env to use free OCR."
      );
    }
    if (msg.includes("api_key") || msg.includes("invalid_api_key") || msg.includes("Incorrect API key")) {
      throw new Error("OpenAI API is not configured. Set OPENAI_API_KEY in your environment.");
    }
    throw new Error(`OCR failed: ${msg}. Try a clearer image with good lighting.`);
  }

  const rawContent = response.choices[0]?.message?.content;
  let content = "";
  if (typeof rawContent === "string") {
    content = rawContent.trim();
  } else if (Array.isArray(rawContent)) {
    const parts = rawContent as Array<{ type?: string; text?: string }>;
    content = parts
      .filter((p) => p?.type === "text" && p.text)
      .map((p) => p.text!)
      .join("")
      .trim();
  }
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

  return extracted;
}

function getOcrProvider(): "tesseract" | "openai" {
  const provider = process.env.TIMESHEET_OCR_PROVIDER?.toLowerCase();
  if (provider === "openai" && process.env.OPENAI_API_KEY) return "openai";
  return "tesseract";
}

export async function extractTimesheetFromImage(
  imageBuffer: Buffer,
  companyId: string
): Promise<TimesheetExtractResult> {
  if (imageBuffer.length > MAX_FILE_SIZE) {
    throw new Error("File too large. Maximum size is 5MB.");
  }

  const provider = getOcrProvider();
  let extracted: ExtractedTimesheet;

  if (provider === "openai") {
    extracted = await extractWithOpenAI(imageBuffer);
  } else {
    try {
      extracted = await extractWithTesseract(imageBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`OCR failed: ${msg}. Try a clearer image or set TIMESHEET_OCR_PROVIDER=openai with OPENAI_API_KEY for better accuracy.`);
    }
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
