export type PayrollExportProviderType =
  | "SAGE_BUSINESS_CLOUD_ZA"
  | "SAGE_VIP"
  | "SAGE_300_PEOPLE"
  | "GENERIC_CSV"
  | "JSON_WEBHOOK";

export interface PayCodeMapping {
  regularHours: string;
  overtimeHours: string;
  sundayHours: string;
  publicHolidayHours: string;
  nightShiftHours: string;
  annualLeaveHours: string;
  sickLeaveHours: string;
  familyLeaveHours: string;
  studyLeaveHours: string;
  unpaidLeaveHours: string;
}

export const DEFAULT_PAY_CODE_MAPPING: PayCodeMapping = {
  regularHours: "1000",
  overtimeHours: "1010",
  sundayHours: "1020",
  publicHolidayHours: "1030",
  nightShiftHours: "1040",
  annualLeaveHours: "2000",
  sickLeaveHours: "2010",
  familyLeaveHours: "2020",
  studyLeaveHours: "2030",
  unpaidLeaveHours: "2090",
};

export interface CustomColumnConfig {
  header: string;
  fixedValue?: string;
  field?: string;
}

export interface ExportBatchContext {
  batchId?: string;
  periodKey: string;
  periodStart: string; // yyyy-MM-dd
  periodEnd: string;   // yyyy-MM-dd
  companyName: string;
  companyPayeReference?: string | null;
  profileName: string;
  provider: PayrollExportProviderType;
  delimiter: string;
  dateFormat: string;
  codeMapping: PayCodeMapping;
  customColumns?: CustomColumnConfig[];
  generatedAt: string;
}

export interface NormalizedExportLine {
  employeeId: string;
  employeeNumber: string;
  externalPayrollCode: string;
  employeeFullName: string;
  siteId: string | null;
  siteName: string | null;
  costCenterCode: string | null;
  basicHours: number;
  overtimeHours: number;
  sundayHours: number;
  publicHolidayHours: number;
  nightShiftHours: number;
  annualLeaveHours: number;
  sickLeaveHours: number;
  familyLeaveHours: number;
  studyLeaveHours: number;
  unpaidLeaveHours: number;
  workedShiftsCount: number;
}

export interface AdapterRenderResult {
  content: string;
  mimeType: string;
  fileExtension: string;
  filename: string;
}

export function resolvePayCodeMapping(raw: unknown): PayCodeMapping {
  const input =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const pick = (key: keyof PayCodeMapping, fallback: string): string => {
    const val = input[key];
    return typeof val === "string" && val.trim() ? val.trim() : fallback;
  };

  return {
    regularHours: pick("regularHours", DEFAULT_PAY_CODE_MAPPING.regularHours),
    overtimeHours: pick("overtimeHours", DEFAULT_PAY_CODE_MAPPING.overtimeHours),
    sundayHours: pick("sundayHours", DEFAULT_PAY_CODE_MAPPING.sundayHours),
    publicHolidayHours: pick("publicHolidayHours", DEFAULT_PAY_CODE_MAPPING.publicHolidayHours),
    nightShiftHours: pick("nightShiftHours", DEFAULT_PAY_CODE_MAPPING.nightShiftHours),
    annualLeaveHours: pick("annualLeaveHours", DEFAULT_PAY_CODE_MAPPING.annualLeaveHours),
    sickLeaveHours: pick("sickLeaveHours", DEFAULT_PAY_CODE_MAPPING.sickLeaveHours),
    familyLeaveHours: pick("familyLeaveHours", DEFAULT_PAY_CODE_MAPPING.familyLeaveHours),
    studyLeaveHours: pick("studyLeaveHours", DEFAULT_PAY_CODE_MAPPING.studyLeaveHours),
    unpaidLeaveHours: pick("unpaidLeaveHours", DEFAULT_PAY_CODE_MAPPING.unpaidLeaveHours),
  };
}

export function resolveCustomColumns(raw: unknown): CustomColumnConfig[] {
  if (!Array.isArray(raw)) return [];
  const cols: CustomColumnConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const header = typeof row.header === "string" ? row.header.trim() : "";
    if (!header) continue;
    cols.push({
      header,
      fixedValue: typeof row.fixedValue === "string" ? row.fixedValue : undefined,
      field: typeof row.field === "string" ? row.field : undefined,
    });
  }
  return cols;
}

export function formatExportDate(isoYyyyMmDd: string, dateFormat: string): string {
  const match = isoYyyyMmDd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoYyyyMmDd;
  const [, yyyy, mm, dd] = match;
  switch (dateFormat) {
    case "dd/MM/yyyy":
      return `${dd}/${mm}/${yyyy}`;
    case "dd-MM-yyyy":
      return `${dd}-${mm}-${yyyy}`;
    case "yyyyMMdd":
      return `${yyyy}${mm}${dd}`;
    case "yyyy-MM-dd":
    default:
      return `${yyyy}-${mm}-${dd}`;
  }
}

export function formatHours(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function escapeDelimitedCell(value: unknown, delimiter: string): string {
  const text = value == null ? "" : String(value);
  if (
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r") ||
    (delimiter && text.includes(delimiter))
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toDelimitedTable(
  headers: string[],
  rows: unknown[][],
  delimiter = ","
): string {
  const sep = delimiter || ",";
  const lines = [headers.map((h) => escapeDelimitedCell(h, sep)).join(sep)];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeDelimitedCell(cell, sep)).join(sep));
  }
  return lines.join("\r\n");
}

export function resolveCustomColumnValue(
  col: CustomColumnConfig,
  context: ExportBatchContext,
  line: NormalizedExportLine
): string {
  if (col.fixedValue !== undefined) return col.fixedValue;
  switch (col.field) {
    case "periodKey":
      return context.periodKey;
    case "companyName":
      return context.companyName;
    case "employeeNumber":
      return line.employeeNumber;
    case "externalPayrollCode":
      return line.externalPayrollCode;
    case "siteName":
      return line.siteName ?? "";
    case "costCenterCode":
      return line.costCenterCode ?? "";
    default:
      return "";
  }
}
