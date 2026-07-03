export type PayPeriodOption = {
  periodKey: string;
  label: string;
  rosterLabel: string;
  periodStart: string;
  periodEnd: string;
  calendarId?: string;
  calendarName?: string;
  isCurrent?: boolean;
};

export function payPeriodRangeLabel(period: Pick<PayPeriodOption, "periodStart" | "periodEnd">): string {
  return `${period.periodStart} – ${period.periodEnd}`;
}

export function pickPeriodLabel(period: PayPeriodOption, variant: "pay" | "roster"): string {
  return variant === "roster" ? period.rosterLabel : period.label;
}
