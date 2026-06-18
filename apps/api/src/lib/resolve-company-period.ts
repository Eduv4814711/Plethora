import { prisma } from "../lib/prisma.js";
import { parsePayrollCalendarSettings } from "./payroll-calendar-settings.js";
import {
  getCurrentPayPeriod,
  resolvePayPeriodByKey,
  startOfUtcDay,
  endOfUtcDay,
} from "../services/payroll-period.service.js";

export type ResolvedPeriodRange = {
  periodStart: Date;
  periodEnd: Date;
  periodKey?: string;
};

export async function resolveCompanyPeriodRange(
  companyId: string,
  query: { periodStart?: string; periodEnd?: string; periodKey?: string }
): Promise<ResolvedPeriodRange | { error: string }> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  const calendar = parsePayrollCalendarSettings(company?.settings);

  if (query.periodKey) {
    const resolved = resolvePayPeriodByKey(calendar, query.periodKey);
    if (!resolved) return { error: "Invalid or unknown periodKey" };
    return {
      periodStart: resolved.periodStart,
      periodEnd: resolved.periodEnd,
      periodKey: resolved.periodKey,
    };
  }

  if (query.periodStart && query.periodEnd) {
    const periodStart = startOfUtcDay(new Date(query.periodStart));
    const periodEnd = endOfUtcDay(new Date(query.periodEnd));
    if (periodStart >= periodEnd) {
      return { error: "periodEnd must be after periodStart" };
    }
    return { periodStart, periodEnd };
  }

  const current = getCurrentPayPeriod(calendar);
  return {
    periodStart: current.periodStart,
    periodEnd: current.periodEnd,
    periodKey: current.periodKey,
  };
}
