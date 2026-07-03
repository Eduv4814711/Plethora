import { describe, expect, it } from "vitest";
import {
  formatDateKey,
  formatPayPeriodLabel,
  getCurrentPayPeriod,
  getNextPayPeriod,
  getRosterWindow,
  getUpcomingPayPeriods,
  listPayPeriods,
  resolvePayPeriodByKey,
  startOfUtcDay,
} from "../payroll-period.service.js";
import type { PayrollCalendarSettings } from "../../lib/payroll-calendar-settings.js";
import { parsePayrollCalendarSettings } from "../../lib/payroll-calendar-settings.js";

const settings2625: PayrollCalendarSettings = {
  payrollPeriod: "monthly",
  payPeriodStartDay: 26,
  payPeriodEndDay: 25,
  autoRosterHorizonPeriods: 2,
  rosterPeriodCalendars: [{ id: "pay-aligned", name: "Pay period aligned", startDay: 26, endDay: 25 }],
  defaultRosterPeriodCalendarId: "pay-aligned",
};

describe("payroll-period.service", () => {
  it("returns June-labelled period for 18 Jun 2026 (26 May – 25 Jun)", () => {
    const asOf = startOfUtcDay(new Date("2026-06-18T12:00:00.000Z"));
    const period = getCurrentPayPeriod(settings2625, asOf);
    expect(formatDateKey(period.periodStart)).toBe("2026-05-26");
    expect(formatDateKey(period.periodEnd)).toBe("2026-06-25");
    expect(period.periodKey).toBe("2026-06");
    expect(period.label).toBe("June 2026 Pay Period");
    expect(period.rosterLabel).toBe("June 2026 Roster Period");
  });

  it("returns July-labelled period for 26 Jun – 25 Jul span", () => {
    const asOf = startOfUtcDay(new Date("2026-06-28T12:00:00.000Z"));
    const period = getCurrentPayPeriod(settings2625, asOf);
    expect(formatDateKey(period.periodStart)).toBe("2026-06-26");
    expect(formatDateKey(period.periodEnd)).toBe("2026-07-25");
    expect(period.periodKey).toBe("2026-07");
    expect(period.label).toBe("July 2026 Pay Period");
  });

  it("advances to August period from July period", () => {
    const july = getCurrentPayPeriod(settings2625, startOfUtcDay(new Date("2026-07-10T00:00:00.000Z")));
    const august = getNextPayPeriod(settings2625, july);
    expect(formatDateKey(august.periodStart)).toBe("2026-07-26");
    expect(formatDateKey(august.periodEnd)).toBe("2026-08-25");
    expect(august.label).toBe("August 2026 Pay Period");
  });

  it("returns consecutive periods via getUpcomingPayPeriods", () => {
    const asOf = startOfUtcDay(new Date("2026-06-18T12:00:00.000Z"));
    const periods = getUpcomingPayPeriods(settings2625, asOf, 2);
    expect(periods).toHaveLength(2);
    expect(periods[0].periodKey).toBe("2026-06");
    expect(periods[1].periodKey).toBe("2026-07");
  });

  it("clips roster window start to today within current period", () => {
    const asOf = startOfUtcDay(new Date("2026-06-18T12:00:00.000Z"));
    const window = getRosterWindow(settings2625, asOf, 2);
    expect(formatDateKey(window.startDate)).toBe("2026-06-18");
    expect(formatDateKey(window.endDate)).toBe("2026-07-25");
    expect(window.periods).toHaveLength(2);
  });

  it("lists periods before and after current", () => {
    const asOf = startOfUtcDay(new Date("2026-06-18T12:00:00.000Z"));
    const periods = listPayPeriods(settings2625, { aroundDate: asOf, before: 1, after: 1 });
    expect(periods).toHaveLength(3);
    expect(periods[0].periodKey).toBe("2026-05");
    expect(periods[1].periodKey).toBe("2026-06");
    expect(periods[2].periodKey).toBe("2026-07");
  });

  it("resolves period by key", () => {
    const resolved = resolvePayPeriodByKey(settings2625, "2026-07");
    expect(resolved).not.toBeNull();
    expect(resolved!.periodKey).toBe("2026-07");
    expect(formatDateKey(resolved!.periodEnd)).toBe("2026-07-25");
  });

  it("formats pay and roster labels from period end", () => {
    const end = startOfUtcDay(new Date("2026-07-25T00:00:00.000Z"));
    expect(formatPayPeriodLabel(end, "pay")).toBe("July 2026 Pay Period");
    expect(formatPayPeriodLabel(end, "roster")).toBe("July 2026 Roster Period");
  });
});

describe("parsePayrollCalendarSettings", () => {
  it("defaults to 26/25 start/end days", () => {
    const parsed = parsePayrollCalendarSettings({});
    expect(parsed.payPeriodStartDay).toBe(26);
    expect(parsed.payPeriodEndDay).toBe(25);
    expect(parsed.autoRosterHorizonPeriods).toBe(2);
  });

  it("maps legacy payrollRunDay 25 to 26/25", () => {
    const parsed = parsePayrollCalendarSettings({ payrollRunDay: 25 });
    expect(parsed.payPeriodStartDay).toBe(26);
    expect(parsed.payPeriodEndDay).toBe(25);
  });
});
