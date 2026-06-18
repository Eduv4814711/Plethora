import { addDays, addMonths } from "date-fns";
import {
  parsePayrollCalendarSettings,
  type PayrollCalendarSettings,
} from "../lib/payroll-calendar-settings.js";

export type PayPeriodBounds = {
  periodStart: Date;
  periodEnd: Date;
  label: string;
  rosterLabel: string;
  periodKey: string;
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

export function formatPayPeriodLabel(periodEnd: Date, kind: "pay" | "roster"): string {
  const month = MONTH_NAMES[periodEnd.getUTCMonth()];
  const year = periodEnd.getUTCFullYear();
  const suffix = kind === "roster" ? "Roster Period" : "Pay Period";
  return `${month} ${year} ${suffix}`;
}

function enrichPeriod(periodStart: Date, periodEnd: Date): PayPeriodBounds {
  return {
    periodStart,
    periodEnd,
    label: formatPayPeriodLabel(periodEnd, "pay"),
    rosterLabel: formatPayPeriodLabel(periodEnd, "roster"),
    periodKey: formatDateKey(periodEnd).slice(0, 7),
  };
}

function getSpanningPeriodContaining(
  asOf: Date,
  startDay: number,
  endDay: number
): PayPeriodBounds {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth();
  const d = asOf.getUTCDate();

  if (d >= startDay) {
    const periodStart = utcDateClamped(y, m, startDay);
    const endMonth = addMonths(new Date(Date.UTC(y, m, 1)), 1);
    const periodEnd = utcEndOfMonthDay(endMonth.getUTCFullYear(), endMonth.getUTCMonth(), endDay);
    return enrichPeriod(periodStart, periodEnd);
  }

  const prevMonth = addMonths(new Date(Date.UTC(y, m, 1)), -1);
  const periodStart = utcDateClamped(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth(), startDay);
  const periodEnd = utcEndOfMonthDay(y, m, endDay);
  return enrichPeriod(periodStart, periodEnd);
}

export function getPayPeriodContaining(
  settings: PayrollCalendarSettings,
  asOfDate: Date = new Date()
): PayPeriodBounds {
  return getSpanningPeriodContaining(
    startOfUtcDay(asOfDate),
    settings.payPeriodStartDay,
    settings.payPeriodEndDay
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
  const around = startOfUtcDay(options.aroundDate ?? new Date());
  const before = Math.max(0, Math.min(options.before ?? 6, 24));
  const after = Math.max(0, Math.min(options.after ?? 6, 24));

  const current = getCurrentPayPeriod(settings, around);
  const periods: PayPeriodBounds[] = [current];

  let prev = current;
  for (let i = 0; i < before; i++) {
    prev = getPreviousPayPeriod(settings, prev);
    periods.unshift(prev);
  }

  let next = current;
  for (let i = 0; i < after; i++) {
    next = getNextPayPeriod(settings, next);
    periods.push(next);
  }

  return periods;
}

export function resolvePayPeriodByKey(
  settings: PayrollCalendarSettings,
  periodKey: string
): PayPeriodBounds | null {
  if (!/^\d{4}-\d{2}$/.test(periodKey)) return null;
  const [yStr, mStr] = periodKey.split("-");
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) return null;

  const probe = utcEndOfMonthDay(year, month, settings.payPeriodEndDay);
  const period = getPayPeriodContaining(settings, probe);
  return period.periodKey === periodKey ? period : null;
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
    isCurrent,
  };
}
