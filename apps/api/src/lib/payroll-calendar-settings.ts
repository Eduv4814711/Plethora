import type { PayPeriod } from "../services/tax.service.js";

export type RosterPeriodCalendarConfig = {
  id: string;
  name: string;
  startDay: number;
  endDay: number;
};

export type PayrollCalendarSettings = {
  /** PAYE tax calculation frequency only — not pay-period date bounds */
  payrollPeriod: PayPeriod;
  payPeriodStartDay: number;
  payPeriodEndDay: number;
  autoRosterHorizonPeriods: number;
  rosterPeriodCalendars: RosterPeriodCalendarConfig[];
  defaultRosterPeriodCalendarId: string;
};

const DEFAULT_START_DAY = 26;
const DEFAULT_END_DAY = 25;
const PAY_ALIGNED_CALENDAR_ID = "pay-aligned";

function clampDay(day: number): number {
  return Math.min(31, Math.max(1, Math.floor(day)));
}

/** Legacy: payrollRunDay 25 implied end on 25th → start 26th */
function legacyStartEndFromRunDay(runDay: number): { start: number; end: number } {
  const end = clampDay(runDay);
  const start = end >= 31 ? 1 : end + 1;
  return { start, end };
}

function defaultPayAlignedCalendar(startDay: number, endDay: number): RosterPeriodCalendarConfig {
  return {
    id: PAY_ALIGNED_CALENDAR_ID,
    name: "Pay period aligned",
    startDay,
    endDay,
  };
}

function parseRosterPeriodCalendars(
  raw: Record<string, unknown>,
  payPeriodStartDay: number,
  payPeriodEndDay: number
): RosterPeriodCalendarConfig[] {
  const entries = raw.rosterPeriodCalendars;
  if (!Array.isArray(entries)) {
    return [defaultPayAlignedCalendar(payPeriodStartDay, payPeriodEndDay)];
  }

  const parsed: RosterPeriodCalendarConfig[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!id || !name) continue;
    parsed.push({
      id,
      name,
      startDay: typeof row.startDay === "number" ? clampDay(row.startDay) : payPeriodStartDay,
      endDay: typeof row.endDay === "number" ? clampDay(row.endDay) : payPeriodEndDay,
    });
  }

  if (parsed.length === 0) {
    return [defaultPayAlignedCalendar(payPeriodStartDay, payPeriodEndDay)];
  }
  return parsed;
}

export function parsePayrollCalendarSettings(settings: unknown): PayrollCalendarSettings {
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const payrollPeriod = raw.payrollPeriod;
  const period: PayPeriod =
    payrollPeriod === "weekly" || payrollPeriod === "biweekly" || payrollPeriod === "monthly"
      ? payrollPeriod
      : "monthly";

  let payPeriodStartDay =
    typeof raw.payPeriodStartDay === "number" ? clampDay(raw.payPeriodStartDay) : undefined;
  let payPeriodEndDay =
    typeof raw.payPeriodEndDay === "number" ? clampDay(raw.payPeriodEndDay) : undefined;

  if (payPeriodStartDay === undefined || payPeriodEndDay === undefined) {
    const legacyRunDay = typeof raw.payrollRunDay === "number" ? raw.payrollRunDay : undefined;
    if (legacyRunDay !== undefined) {
      const mapped = legacyStartEndFromRunDay(legacyRunDay);
      payPeriodStartDay ??= mapped.start;
      payPeriodEndDay ??= mapped.end;
    }
  }

  payPeriodStartDay ??= DEFAULT_START_DAY;
  payPeriodEndDay ??= DEFAULT_END_DAY;

  const horizonRaw = raw.autoRosterHorizonPeriods;
  const autoRosterHorizonPeriods =
    typeof horizonRaw === "number" && Number.isFinite(horizonRaw)
      ? Math.min(6, Math.max(1, Math.floor(horizonRaw)))
      : 2;

  const rosterPeriodCalendars = parseRosterPeriodCalendars(raw, payPeriodStartDay, payPeriodEndDay);
  const defaultRaw = raw.defaultRosterPeriodCalendarId;
  const defaultRosterPeriodCalendarId =
    typeof defaultRaw === "string" &&
    rosterPeriodCalendars.some((calendar) => calendar.id === defaultRaw)
      ? defaultRaw
      : rosterPeriodCalendars[0]!.id;

  return {
    payrollPeriod: period,
    payPeriodStartDay,
    payPeriodEndDay,
    autoRosterHorizonPeriods,
    rosterPeriodCalendars,
    defaultRosterPeriodCalendarId,
  };
}

export function getRosterPeriodCalendar(
  settings: PayrollCalendarSettings,
  calendarId?: string | null
): RosterPeriodCalendarConfig {
  if (calendarId) {
    const match = settings.rosterPeriodCalendars.find((calendar) => calendar.id === calendarId);
    if (match) return match;
  }
  const preferred = settings.rosterPeriodCalendars.find(
    (calendar) => calendar.id === settings.defaultRosterPeriodCalendarId
  );
  return preferred ?? settings.rosterPeriodCalendars[0]!;
}

export function rosterCalendarBounds(calendar: RosterPeriodCalendarConfig) {
  return { startDay: calendar.startDay, endDay: calendar.endDay };
}
