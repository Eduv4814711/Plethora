export type ObBookMode = "REQUIRED" | "OPTIONAL_WHEN_DIGITAL" | "OPTIONAL";
export type PsiraEnforcementMode = "BLOCK" | "WARN" | "OFF";
export type OvernightBoundaryMode = "shift_start_day" | "midnight_split";
export type BceaEmployeeCategory = "security_officer" | "general" | "security_averaging";
export type PsiraGrade = "E" | "D" | "C" | "B" | "A";

export interface LabourComplianceSettings {
  obBookMode: ObBookMode;
  psiraEnforcementMode: PsiraEnforcementMode;
  averagingEnabled: boolean;
  averagingWeeks: number;
  overnightBoundaryMode: OvernightBoundaryMode;
  sundayDoubleRateSplit: boolean;
  fortnightlyRestEnabled: boolean;
}

export const DEFAULT_LABOUR_COMPLIANCE_SETTINGS: LabourComplianceSettings = {
  obBookMode: "REQUIRED",
  psiraEnforcementMode: "WARN",
  averagingEnabled: false,
  averagingWeeks: 4,
  overnightBoundaryMode: "shift_start_day",
  sundayDoubleRateSplit: false,
  fortnightlyRestEnabled: false,
};

/**
 * Versioned statutory constants for South Africa Private Security Sector
 * (NBCPSS Main Collective Agreement + BCEA Act 75 of 1997 + Public Holidays Act 36 of 1994).
 */
export const SA_NBCPSS_RULES = {
  version: "2025-2026-MCA-v1",
  securityOfficerMaxWeeklyOrdinaryHours: 48,
  generalStaffMaxWeeklyOrdinaryHours: 45,
  securityOfficerMaxDailyHours: 12,
  generalStaffMaxDailyHours: 9,
  maxWeeklyOvertimeHours: 10,
  overtimeMultiplier: 1.5,
  sundayOrdinaryMultiplier: 1.5,
  sundayDoubleMultiplier: 2.0,
  publicHolidayMultiplier: 2.0,
  nightWindowStartHour: 18, // 18:00 SAST
  nightWindowEndHour: 6, // 06:00 SAST
  nightShiftQualifyingThresholdRatio: 0.5, // >= 50% of shift in 18:00-06:00
  nightAllowanceEffectiveMar2026Date: "2026-03-01",
  nightAllowanceEffectiveMar2026Rand: 8.0,
  nightAllowancePriorRand: 6.0,
  minDailyRestHours: 12,
  minWeeklyRestHours: 36,
  minFortnightlyRestHours: 60,
  defaultMealIntervalMinutes: 60,
  mealThresholdMinutes: 300, // 5 hours continuous work under BCEA s14
} as const;

export const PSIRA_GRADE_RANK: Record<PsiraGrade, number> = {
  E: 1,
  D: 2,
  C: 3,
  B: 4,
  A: 5,
};

const VALID_OB_MODES = new Set<ObBookMode>(["REQUIRED", "OPTIONAL_WHEN_DIGITAL", "OPTIONAL"]);
const VALID_PSIRA_MODES = new Set<PsiraEnforcementMode>(["BLOCK", "WARN", "OFF"]);

export function normalizePsiraGrade(grade: string | null | undefined): PsiraGrade | null {
  if (!grade) return null;
  const upper = grade.trim().toUpperCase().replace(/^GRADE\s+/i, "");
  if (upper === "A" || upper === "B" || upper === "C" || upper === "D" || upper === "E") {
    return upper;
  }
  return null;
}

export function hasMinimumPsiraGrade(
  employeeGrade: string | null | undefined,
  requiredGrade: string | null | undefined,
): boolean {
  const req = normalizePsiraGrade(requiredGrade);
  if (!req) return true;
  const emp = normalizePsiraGrade(employeeGrade);
  if (!emp) return false;
  return PSIRA_GRADE_RANK[emp] >= PSIRA_GRADE_RANK[req];
}

export function parseLabourComplianceSettings(rawSettings: unknown): LabourComplianceSettings {
  const obj =
    rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? (rawSettings as Record<string, unknown>)
      : {};

  const obRaw = typeof obj.obBookMode === "string" ? obj.obBookMode.trim().toUpperCase() : "";
  const psiraRaw =
    typeof obj.psiraEnforcementMode === "string" ? obj.psiraEnforcementMode.trim().toUpperCase() : "";
  const boundaryRaw = typeof obj.overnightBoundaryMode === "string" ? obj.overnightBoundaryMode : "";
  const rawAvgWeeks =
    typeof obj.averagingWeeks === "number" && Number.isFinite(obj.averagingWeeks)
      ? Math.round(obj.averagingWeeks)
      : DEFAULT_LABOUR_COMPLIANCE_SETTINGS.averagingWeeks;

  return {
    obBookMode: VALID_OB_MODES.has(obRaw as ObBookMode)
      ? (obRaw as ObBookMode)
      : DEFAULT_LABOUR_COMPLIANCE_SETTINGS.obBookMode,
    psiraEnforcementMode: VALID_PSIRA_MODES.has(psiraRaw as PsiraEnforcementMode)
      ? (psiraRaw as PsiraEnforcementMode)
      : DEFAULT_LABOUR_COMPLIANCE_SETTINGS.psiraEnforcementMode,
    averagingEnabled: Boolean(obj.averagingEnabled),
    averagingWeeks: Math.max(2, Math.min(16, rawAvgWeeks)),
    overnightBoundaryMode:
      boundaryRaw === "midnight_split" ? "midnight_split" : "shift_start_day",
    sundayDoubleRateSplit: Boolean(obj.sundayDoubleRateSplit),
    fortnightlyRestEnabled: Boolean(obj.fortnightlyRestEnabled),
  };
}

export function resolveSiteObBookMode(
  companySettings: unknown,
  siteObBookMode?: string | null,
): ObBookMode {
  const siteRaw = typeof siteObBookMode === "string" ? siteObBookMode.trim().toUpperCase() : "";
  if (VALID_OB_MODES.has(siteRaw as ObBookMode)) {
    return siteRaw as ObBookMode;
  }
  return parseLabourComplianceSettings(companySettings).obBookMode;
}

export function resolveSitePsiraMode(
  companySettings: unknown,
  sitePsiraMode?: string | null,
): PsiraEnforcementMode {
  const siteRaw = typeof sitePsiraMode === "string" ? sitePsiraMode.trim().toUpperCase() : "";
  if (VALID_PSIRA_MODES.has(siteRaw as PsiraEnforcementMode)) {
    return siteRaw as PsiraEnforcementMode;
  }
  return parseLabourComplianceSettings(companySettings).psiraEnforcementMode;
}

export function resolveEmployeeBceaCategory(
  employeeType: string | null | undefined,
  bceaSectorOverride?: string | null,
  companySettings?: unknown,
): BceaEmployeeCategory {
  if (bceaSectorOverride === "BCEA_GENERAL") return "general";
  if (bceaSectorOverride === "NBCPSS_AVERAGING") return "security_averaging";
  if (bceaSectorOverride === "NBCPSS_SECURITY") {
    return parseLabourComplianceSettings(companySettings).averagingEnabled
      ? "security_averaging"
      : "security_officer";
  }
  if ((employeeType ?? "security_officer").trim().toLowerCase() === "general") {
    return "general";
  }
  return parseLabourComplianceSettings(companySettings).averagingEnabled
    ? "security_averaging"
    : "security_officer";
}

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000; // Africa/Johannesburg UTC+2 (no DST)

/** Shift UTC timestamp into SAST calendar coordinates so UTC getters reflect local SA date/time. */
export function toSastDate(date: Date): Date {
  return new Date(date.getTime() + SAST_OFFSET_MS);
}

export function toSastDateKey(date: Date): string {
  const d = toSastDate(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getSastDayOfWeek(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** ISO Monday-Sunday payroll week anchor key (`YYYY-MM-DD` of the Monday in SAST). */
export function getIsoWeekStartKey(dateKey: string): string {
  const dow = getSastDayOfWeek(dateKey); // 0=Sun..6=Sat
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  return addDaysToDateKey(dateKey, offsetToMonday);
}

export function getNightAllowanceRateForDate(date: Date | string): number {
  const dateKey = typeof date === "string" ? date.slice(0, 10) : toSastDateKey(date);
  return dateKey >= SA_NBCPSS_RULES.nightAllowanceEffectiveMar2026Date
    ? SA_NBCPSS_RULES.nightAllowanceEffectiveMar2026Rand
    : SA_NBCPSS_RULES.nightAllowancePriorRand;
}

/**
 * Gregorian Computus for Easter Sunday in UTC date coordinates.
 */
function computeEasterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

export interface EffectiveHolidayEntry {
  dateKey: string;
  name: string;
  isObservedMonday: boolean;
}

const FIXED_SA_PUBLIC_HOLIDAYS: Array<{ month: number; day: number; name: string }> = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 3, day: 21, name: "Human Rights Day" },
  { month: 4, day: 27, name: "Freedom Day" },
  { month: 5, day: 1, name: "Workers' Day" },
  { month: 6, day: 16, name: "Youth Day" },
  { month: 8, day: 9, name: "National Women's Day" },
  { month: 9, day: 24, name: "Heritage Day" },
  { month: 12, day: 16, name: "Day of Reconciliation" },
  { month: 12, day: 25, name: "Christmas Day" },
  { month: 12, day: 26, name: "Day of Goodwill" },
];

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Generates South Africa statutory public holidays for a given calendar year
 * per Public Holidays Act 36 of 1994, including Good Friday, Family Day,
 * and automatic Monday observation whenever a statutory holiday falls on Sunday.
 */
export function getStatutorySaPublicHolidays(year: number): EffectiveHolidayEntry[] {
  const entries: EffectiveHolidayEntry[] = [];
  const addWithSundayRollover = (month: number, day: number, name: string) => {
    const dt = new Date(Date.UTC(year, month - 1, day));
    const dateKey = formatYmd(year, month, day);
    entries.push({ dateKey, name, isObservedMonday: false });
    if (dt.getUTCDay() === 0) {
      const mondayKey = addDaysToDateKey(dateKey, 1);
      entries.push({
        dateKey: mondayKey,
        name: `${name} (Observed)`,
        isObservedMonday: true,
      });
    }
  };

  for (const h of FIXED_SA_PUBLIC_HOLIDAYS) {
    addWithSundayRollover(h.month, h.day, h.name);
  }

  const easter = computeEasterSunday(year);
  const easterDate = new Date(Date.UTC(year, easter.month - 1, easter.day));
  const goodFriday = new Date(easterDate.getTime() - 2 * 86_400_000);
  const familyDay = new Date(easterDate.getTime() + 1 * 86_400_000);

  entries.push({
    dateKey: formatYmd(
      goodFriday.getUTCFullYear(),
      goodFriday.getUTCMonth() + 1,
      goodFriday.getUTCDate(),
    ),
    name: "Good Friday",
    isObservedMonday: false,
  });
  entries.push({
    dateKey: formatYmd(
      familyDay.getUTCFullYear(),
      familyDay.getUTCMonth() + 1,
      familyDay.getUTCDate(),
    ),
    name: "Family Day",
    isObservedMonday: false,
  });

  return entries;
}

export interface CustomPublicHolidayInput {
  date: Date | string;
  name?: string;
  isRecurring?: boolean;
}

/**
 * Merges statutory South African holidays for the spanned years together with
 * company-configured `PublicHoliday` records (applying Sunday -> Monday rollover).
 */
export function buildEffectiveHolidaySet(
  years: Iterable<number>,
  customHolidays: CustomPublicHolidayInput[] = [],
  includeStatutory = true,
): Map<string, EffectiveHolidayEntry> {
  const yearSet = new Set<number>();
  for (const y of years) {
    yearSet.add(y);
  }

  const map = new Map<string, EffectiveHolidayEntry>();
  if (includeStatutory) {
    for (const y of yearSet) {
      for (const h of getStatutorySaPublicHolidays(y)) {
        if (!map.has(h.dateKey)) {
          map.set(h.dateKey, h);
        }
      }
    }
  }

  for (const ch of customHolidays) {
    const dt = typeof ch.date === "string" ? new Date(ch.date) : ch.date;
    if (Number.isNaN(dt.getTime())) continue;
    const baseName = ch.name?.trim() || "Public Holiday";
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    if (ch.isRecurring && yearSet.size > 0) {
      for (const y of yearSet) {
        const key = formatYmd(y, m, d);
        map.set(key, { dateKey: key, name: baseName, isObservedMonday: false });
        if (getSastDayOfWeek(key) === 0) {
          const mon = addDaysToDateKey(key, 1);
          if (!map.has(mon)) {
            map.set(mon, { dateKey: mon, name: `${baseName} (Observed)`, isObservedMonday: true });
          }
        }
      }
    } else {
      const key = formatYmd(dt.getUTCFullYear(), m, d);
      map.set(key, { dateKey: key, name: baseName, isObservedMonday: false });
      if (getSastDayOfWeek(key) === 0) {
        const mon = addDaysToDateKey(key, 1);
        if (!map.has(mon)) {
          map.set(mon, { dateKey: mon, name: `${baseName} (Observed)`, isObservedMonday: true });
        }
      }
    }
  }

  return map;
}
