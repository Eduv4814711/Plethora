import { addDays, addMonths } from "date-fns";
import {
  getRosterPeriodCalendar,
  parsePayrollCalendarSettings,
  rosterCalendarBounds,
  type PayrollCalendarSettings,
} from "../lib/payroll-calendar-settings.js";

export type SpanningPeriodDayBounds = {
  startDay: number;
  endDay: number;
};

export type PayPeriodBounds = {
  periodStart: Date;
  periodEnd: Date;
  label: string;
  rosterLabel: string;
  periodKey: string;
  calendarId?: string;
  calendarName?: string;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

export function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

export function formatDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function utcDateClamped(year: number, month: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return startOfUtcDay(new Date(Date.UTC(year, month, clamped)));
}

function utcEndOfMonthDay(year: number, month: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return endOfUtcDay(new Date(Date.UTC(year, month, clamped)));
}

function lastDayOfUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** When endDay >= startDay the period stays inside one calendar month (e.g. 1–31). */
function isWithinMonthPeriod(startDay: number, endDay: number): boolean {
  return endDay >= startDay;
}

function getWithinMonthPeriodContaining(
  asOf: Date,
  startDay: number,
  endDay: number,
  opts?: { calendarName?: string; calendarId?: string }
): PayPeriodBounds {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth();
  const d = asOf.getUTCDate();

  if (d < startDay) {
    const prevMonth = addMonths(new Date(Date.UTC(y, m, 1)), -1);
    const py = prevMonth.getUTCFullYear();
    const pm = prevMonth.getUTCMonth();
    const periodStart = utcDateClamped(py, pm, startDay);
    const periodEnd = utcEndOfMonthDay(py, pm, Math.min(endDay, lastDayOfUtcMonth(py, pm)));
    return enrichPeriod(periodStart, periodEnd, opts);
  }

  const periodStart = utcDateClamped(y, m, startDay);
  const periodEnd = utcEndOfMonthDay(y, m, Math.min(endDay, lastDayOfUtcMonth(y, m)));
  return enrichPeriod(periodStart, periodEnd, opts);
}

export function formatPayPeriodLabel(periodEnd: Date, kind: "pay" | "roster"): string {
  const month = MONTH_NAMES[periodEnd.getUTCMonth()];
  const year = periodEnd.getUTCFullYear();
  const suffix = kind === "roster" ? "Roster Period" : "Pay Period";
  return `${month} ${year} ${suffix}`;
}

function enrichPeriod(
  periodStart: Date,
  periodEnd: Date,
  opts?: { calendarName?: string; calendarId?: string }
): PayPeriodBounds {
  const basePay = formatPayPeriodLabel(periodEnd, "pay");
  const baseRoster = formatPayPeriodLabel(periodEnd, "roster");
  const rosterLabel = opts?.calendarName ? `${opts.calendarName} — ${baseRoster}` : baseRoster;
  return {
    periodStart,
    periodEnd,
    label: basePay,
    rosterLabel,
    periodKey: formatDateKey(periodEnd).slice(0, 7),
    calendarId: opts?.calendarId,
    calendarName: opts?.calendarName,
  };
}

function getSpanningPeriodContaining(
  asOf: Date,
  startDay: number,
  endDay: number,
  opts?: { calendarName?: string; calendarId?: string }
): PayPeriodBounds {
  if (isWithinMonthPeriod(startDay, endDay)) {
    return getWithinMonthPeriodContaining(asOf, startDay, endDay, opts);
  }

  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth();
  const d = asOf.getUTCDate();

  if (d >= startDay) {
    const periodStart = utcDateClamped(y, m, startDay);
    const endMonth = addMonths(new Date(Date.UTC(y, m, 1)), 1);
    const periodEnd = utcEndOfMonthDay(endMonth.getUTCFullYear(), endMonth.getUTCMonth(), endDay);
    return enrichPeriod(periodStart, periodEnd, opts);
  }

  const prevMonth = addMonths(new Date(Date.UTC(y, m, 1)), -1);
  const periodStart = utcDateClamped(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth(), startDay);
  const periodEnd = utcEndOfMonthDay(y, m, endDay);
  return enrichPeriod(periodStart, periodEnd, opts);
}

export function getSpanningPeriodContainingBounds(
  bounds: SpanningPeriodDayBounds,
  asOfDate: Date = new Date(),
  opts?: { calendarName?: string; calendarId?: string }
): PayPeriodBounds {
  return getSpanningPeriodContaining(startOfUtcDay(asOfDate), bounds.startDay, bounds.endDay, opts);
}

export function getNextSpanningPeriod(
  bounds: SpanningPeriodDayBounds,
  current: PayPeriodBounds,
  opts?: { calendarName?: string; calendarId?: string }
): PayPeriodBounds {
  return getSpanningPeriodContainingBounds(bounds, addDays(current.periodEnd, 1), opts);
}

export function getPreviousSpanningPeriod(
  bounds: SpanningPeriodDayBounds,
  current: PayPeriodBounds,
  opts?: { calendarName?: string; calendarId?: string }
): PayPeriodBounds {
  return getSpanningPeriodContainingBounds(bounds, addDays(current.periodStart, -1), opts);
}

export function listSpanningPeriods(
  bounds: SpanningPeriodDayBounds,
  options: ListPayPeriodsOptions = {},
  meta?: { calendarName?: string; calendarId?: string }
): PayPeriodBounds[] {
  const around = startOfUtcDay(options.aroundDate ?? new Date());
  const before = Math.max(0, Math.min(options.before ?? 6, 24));
  const after = Math.max(0, Math.min(options.after ?? 6, 24));

  const current = getSpanningPeriodContainingBounds(bounds, around, meta);
  const periods: PayPeriodBounds[] = [current];

  let prev = current;
  for (let i = 0; i < before; i++) {
    prev = getPreviousSpanningPeriod(bounds, prev, meta);
    periods.unshift(prev);
  }

  let next = current;
  for (let i = 0; i < after; i++) {
    next = getNextSpanningPeriod(bounds, next, meta);
    periods.push(next);
  }

  return periods;
}

export function resolveSpanningPeriodByKey(
  bounds: SpanningPeriodDayBounds,
  periodKey: string,
  meta?: { calendarName?: string; calendarId?: string }
): PayPeriodBounds | null {
  if (!/^\d{4}-\d{2}$/.test(periodKey)) return null;
  const [yStr, mStr] = periodKey.split("-");
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) return null;

  if (isWithinMonthPeriod(bounds.startDay, bounds.endDay)) {
    const periodStart = utcDateClamped(year, month, bounds.startDay);
    const periodEnd = utcEndOfMonthDay(
      year,
      month,
      Math.min(bounds.endDay, lastDayOfUtcMonth(year, month))
    );
    const period = enrichPeriod(periodStart, periodEnd, meta);
    return period.periodKey === periodKey ? period : null;
  }

  const probe = utcEndOfMonthDay(year, month, bounds.endDay);
  const period = getSpanningPeriodContainingBounds(bounds, probe, meta);
  return period.periodKey === periodKey ? period : null;
}

export function listRosterPeriods(
  settings: PayrollCalendarSettings,
  calendarId: string | undefined,
  options: ListPayPeriodsOptions = {}
): PayPeriodBounds[] {
  const calendar = getRosterPeriodCalendar(settings, calendarId);
  return listSpanningPeriods(rosterCalendarBounds(calendar), options, {
    calendarId: calendar.id,
    calendarName: calendar.name,
  });
}

export function getCurrentRosterPeriod(
  settings: PayrollCalendarSettings,
  calendarId: string | undefined,
  asOfDate: Date = new Date()
): PayPeriodBounds {
  const calendar = getRosterPeriodCalendar(settings, calendarId);
  return getSpanningPeriodContainingBounds(rosterCalendarBounds(calendar), asOfDate, {
    calendarId: calendar.id,
    calendarName: calendar.name,
  });
}

export function resolveRosterPeriodByKey(
  settings: PayrollCalendarSettings,
  calendarId: string | undefined,
  periodKey: string
): PayPeriodBounds | null {
  const calendar = getRosterPeriodCalendar(settings, calendarId);
  return resolveSpanningPeriodByKey(rosterCalendarBounds(calendar), periodKey, {
    calendarId: calendar.id,
    calendarName: calendar.name,
  });
}

export function serializeRosterCalendars(settings: PayrollCalendarSettings) {
  return {
    defaultCalendarId: settings.defaultRosterPeriodCalendarId,
    calendars: settings.rosterPeriodCalendars,
  };
}

export function getPayPeriodContaining(
  settings: PayrollCalendarSettings,
  asOfDate: Date = new Date()
): PayPeriodBounds {
  return getSpanningPeriodContainingBounds(
    { startDay: settings.payPeriodStartDay, endDay: settings.payPeriodEndDay },
    asOfDate
  );
}

export function getCurrentPayPeriod(
  settings: PayrollCalendarSettings,
  asOfDate: Date = new Date()
): PayPeriodBounds {
  return getPayPeriodContaining(settings, asOfDate);
}

export function getNextPayPeriod(
  settings: PayrollCalendarSettings,
  current: PayPeriodBounds
): PayPeriodBounds {
  return getPayPeriodContaining(settings, addDays(current.periodEnd, 1));
}

export function getPreviousPayPeriod(
  settings: PayrollCalendarSettings,
  current: PayPeriodBounds
): PayPeriodBounds {
  return getPayPeriodContaining(settings, addDays(current.periodStart, -1));
}

export function getUpcomingPayPeriods(
  settings: PayrollCalendarSettings,
  asOfDate: Date = new Date(),
  count: number
): PayPeriodBounds[] {
  const n = Math.max(1, Math.min(count, 12));
  const periods: PayPeriodBounds[] = [];
  let current = getCurrentPayPeriod(settings, asOfDate);
  periods.push(current);
  for (let i = 1; i < n; i++) {
    current = getNextPayPeriod(settings, current);
    periods.push(current);
  }
  return periods;
}

export type ListPayPeriodsOptions = {
  aroundDate?: Date;
  before?: number;
  after?: number;
};

export function listPayPeriods(
  settings: PayrollCalendarSettings,
  options: ListPayPeriodsOptions = {}
): PayPeriodBounds[] {
  return listSpanningPeriods(
    { startDay: settings.payPeriodStartDay, endDay: settings.payPeriodEndDay },
    options
  );
}

export function resolvePayPeriodByKey(
  settings: PayrollCalendarSettings,
  periodKey: string
): PayPeriodBounds | null {
  return resolveSpanningPeriodByKey(
    { startDay: settings.payPeriodStartDay, endDay: settings.payPeriodEndDay },
    periodKey
  );
}

export function getRosterWindow(
  settings: PayrollCalendarSettings,
  asOfDate: Date = new Date(),
  horizonPeriods?: number
): { startDate: Date; endDate: Date; periods: PayPeriodBounds[] } {
  const horizon = horizonPeriods ?? settings.autoRosterHorizonPeriods;
  const periods = getUpcomingPayPeriods(settings, asOfDate, horizon);
  const today = startOfUtcDay(asOfDate);
  const startDate = periods[0].periodStart > today ? periods[0].periodStart : today;
  const endDate = periods[periods.length - 1].periodEnd;
  return { startDate, endDate, periods };
}

export function getPayrollCalendarFromCompanySettings(settings: unknown): PayrollCalendarSettings {
  return parsePayrollCalendarSettings(settings);
}

export function serializePayPeriod(period: PayPeriodBounds, isCurrent = false) {
  return {
    periodKey: period.periodKey,
    label: period.label,
    rosterLabel: period.rosterLabel,
    periodStart: formatDateKey(period.periodStart),
    periodEnd: formatDateKey(period.periodEnd),
    calendarId: period.calendarId,
    calendarName: period.calendarName,
    isCurrent,
  };
}
