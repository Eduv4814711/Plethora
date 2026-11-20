export type SaSecurityFrameworkId =
  | "4on4off_12h"
  | "5on2off_day"
  | "4on2off_swing"
  | "6on3off_mixed"
  | "continental_223"
  | "24x7_reliever_pool"
  | "event_ad_hoc";

export interface SaSecurityFrameworkDefinition {
  id: SaSecurityFrameworkId;
  name: string;
  shortLabel: string;
  tagline: string;
  bestFor: string;
  defaultDayStart: string;
  defaultDayEnd: string;
  defaultNightStart: string;
  defaultNightEnd: string;
  shiftDurationHours: number;
  workDaysOn: number;
  restDaysOff: number;
  guardsPerPost24x7: number;
  guardsPerPostSingleShift: number;
  avgWeeklyHoursPerGuard: number;
  requiresAveragingAgreement: boolean;
  /** Rotating pattern hint where D=Day, N=Night, O=Off */
  dayCyclePattern: Array<"D" | "O">;
  nightCyclePattern: Array<"N" | "O">;
  notes: string;
}

export const SA_SECURITY_FRAMEWORKS: SaSecurityFrameworkDefinition[] = [
  {
    id: "4on4off_12h",
    name: "4-On / 4-Off · 12h Day & Night",
    shortLabel: "4-On / 4-Off",
    tagline: "Most popular SA 24/7 estate, warehouse & corporate guarding rotation",
    bestFor: "24/7 Estates, Warehouses, Commercial Office Parks",
    defaultDayStart: "06:00",
    defaultDayEnd: "18:00",
    defaultNightStart: "18:00",
    defaultNightEnd: "06:00",
    shiftDurationHours: 12,
    workDaysOn: 4,
    restDaysOff: 4,
    guardsPerPost24x7: 4,
    guardsPerPostSingleShift: 2,
    avgWeeklyHoursPerGuard: 42,
    requiresAveragingAgreement: false,
    dayCyclePattern: ["D", "D", "D", "D", "O", "O", "O", "O"],
    nightCyclePattern: ["N", "N", "N", "N", "O", "O", "O", "O"],
    notes: "Stays within 48h/week ordinary NBCPSS cap with 96h rest between blocks and zero overtime.",
  },
  {
    id: "5on2off_day",
    name: "5-On / 2-Off · Daytime Access Control",
    shortLabel: "Mon–Fri Day",
    tagline: "Standard weekday office, school, or daytime retail guard schedule",
    bestFor: "Office Receptions, Schools, Daytime Retail & Medical Suites",
    defaultDayStart: "07:00",
    defaultDayEnd: "16:30",
    defaultNightStart: "18:00",
    defaultNightEnd: "06:00",
    shiftDurationHours: 9.5,
    workDaysOn: 5,
    restDaysOff: 2,
    guardsPerPost24x7: 3,
    guardsPerPostSingleShift: 1,
    avgWeeklyHoursPerGuard: 47.5,
    requiresAveragingAgreement: false,
    dayCyclePattern: ["D", "D", "D", "D", "D", "O", "O"],
    nightCyclePattern: ["O", "O", "O", "O", "O", "O", "O"],
    notes: "Fits 1 guard per daytime post at <= 48h/week NBCPSS ordinary hours with full weekends off.",
  },
  {
    id: "4on2off_swing",
    name: "4-On / 2-Off · High-Coverage Rotation",
    shortLabel: "4-On / 2-Off",
    tagline: "Tighter 3-guard 24/7 cycle (solver balances <= 48h/wk using relievers)",
    bestFor: "Retail Centres, Hospitality & Busy Commercial Access Gates",
    defaultDayStart: "06:00",
    defaultDayEnd: "18:00",
    defaultNightStart: "18:00",
    defaultNightEnd: "06:00",
    shiftDurationHours: 12,
    workDaysOn: 4,
    restDaysOff: 2,
    guardsPerPost24x7: 3,
    guardsPerPostSingleShift: 2,
    avgWeeklyHoursPerGuard: 56,
    requiresAveragingAgreement: false,
    dayCyclePattern: ["D", "D", "D", "D", "O", "O"],
    nightCyclePattern: ["N", "N", "N", "N", "O", "O"],
    notes: "A pure 4-on/2-off 12h cycle averages ~56h/wk (~8h OT/wk); add 1 pool reliever per 3 posts to keep overtime near zero.",
  },
  {
    id: "6on3off_mixed",
    name: "6-On / 3-Off · Remote & Mining Cycle",
    shortLabel: "6-On / 3-Off",
    tagline: "Extended 6-shift block with 72h recovery for remote/mining sites",
    bestFor: "Mines, Solar/Wind Farms, Remote Agricultural & Infrastructure Sites",
    defaultDayStart: "06:00",
    defaultDayEnd: "18:00",
    defaultNightStart: "18:00",
    defaultNightEnd: "06:00",
    shiftDurationHours: 12,
    workDaysOn: 6,
    restDaysOff: 3,
    guardsPerPost24x7: 3,
    guardsPerPostSingleShift: 2,
    avgWeeklyHoursPerGuard: 56,
    requiresAveragingAgreement: true,
    dayCyclePattern: ["D", "D", "D", "D", "D", "D", "O", "O", "O"],
    nightCyclePattern: ["N", "N", "N", "N", "N", "N", "O", "O", "O"],
    notes: "Requires BCEA s12 averaging or 60h fortnightly rest agreement for 6 consecutive days; 72h off per block.",
  },
  {
    id: "continental_223",
    name: "2-2-3 Continental · 12h Fast Recovery",
    shortLabel: "2-2-3 Continental",
    tagline: "Short runs (never >3 shifts straight) with every second weekend off",
    bestFor: "High-Alert Armed Response Bases, Control Rooms & Data Centres",
    defaultDayStart: "06:00",
    defaultDayEnd: "18:00",
    defaultNightStart: "18:00",
    defaultNightEnd: "06:00",
    shiftDurationHours: 12,
    workDaysOn: 3,
    restDaysOff: 3,
    guardsPerPost24x7: 4,
    guardsPerPostSingleShift: 2,
    avgWeeklyHoursPerGuard: 42,
    requiresAveragingAgreement: false,
    dayCyclePattern: ["D", "D", "O", "O", "D", "D", "D", "O", "O", "D", "D", "O", "O", "O"],
    nightCyclePattern: ["N", "N", "O", "O", "N", "N", "N", "O", "O", "N", "N", "O", "O", "O"],
    notes: "Reduces guard fatigue (max 3 consecutive 12h shifts), gives alternate Fri-Sat-Sun weekends off, avg 42h/wk.",
  },
  {
    id: "24x7_reliever_pool",
    name: "Dedicated 48h Static + Weekend Relievers",
    shortLabel: "Static + Relievers",
    tagline: "Core guards work Mon–Thu (48h) while weekend relievers cover Fri–Sun",
    bestFor: "Zero-Overtime Contracts Using Shared Weekend Reliever Teams",
    defaultDayStart: "06:00",
    defaultDayEnd: "18:00",
    defaultNightStart: "18:00",
    defaultNightEnd: "06:00",
    shiftDurationHours: 12,
    workDaysOn: 4,
    restDaysOff: 3,
    guardsPerPost24x7: 4,
    guardsPerPostSingleShift: 2,
    avgWeeklyHoursPerGuard: 42,
    requiresAveragingAgreement: false,
    dayCyclePattern: ["D", "D", "D", "D", "O", "O", "O"],
    nightCyclePattern: ["N", "N", "N", "N", "O", "O", "O"],
    notes: "Zero overtime across the month because no guard exceeds 4 shifts per Mon–Sun week.",
  },
  {
    id: "event_ad_hoc",
    name: "Ad-Hoc / Event / Flexible Coverage",
    shortLabel: "Event / Custom",
    tagline: "Flexible solver for sports events, VIP escort & variable daily headcounts",
    bestFor: "Events, Temporary Construction Protection & Patrol Relief",
    defaultDayStart: "06:00",
    defaultDayEnd: "18:00",
    defaultNightStart: "18:00",
    defaultNightEnd: "06:00",
    shiftDurationHours: 12,
    workDaysOn: 4,
    restDaysOff: 3,
    guardsPerPost24x7: 4,
    guardsPerPostSingleShift: 2,
    avgWeeklyHoursPerGuard: 42,
    requiresAveragingAgreement: false,
    dayCyclePattern: ["D", "D", "D", "D", "O", "O", "O"],
    nightCyclePattern: ["N", "N", "N", "N", "O", "O", "O"],
    notes: "Assigns available guards up to 48h/week first before drawing overtime.",
  },
];

export function getSaSecurityFramework(id: string | null | undefined): SaSecurityFrameworkDefinition {
  return SA_SECURITY_FRAMEWORKS.find((f) => f.id === id) ?? SA_SECURITY_FRAMEWORKS[0]!;
}

export interface FrameworkStaffingEstimate {
  framework: SaSecurityFrameworkDefinition;
  recommendedTotalGuards: number;
  minimumGuardsWithoutOvertime: number;
  estimatedWeeklyHoursPerGuard: number;
  estimatedMonthlyOvertimeHours: number;
  complianceNotes: string[];
}

/**
 * Computes plain-English staffing math for a site configuration using South African Sector 6 limits.
 */
export function calculateFrameworkStaffing(params: {
  frameworkId: string | null | undefined;
  dayGuardsRequired: number;
  nightGuardsRequired: number;
  dayDaysPerWeek?: number;
  nightDaysPerWeek?: number;
  shiftDurationHours?: number;
}): FrameworkStaffingEstimate {
  const framework = getSaSecurityFramework(params.frameworkId);
  const shiftHours = params.shiftDurationHours ?? framework.shiftDurationHours;
  const dayDays = Math.max(0, Math.min(7, params.dayDaysPerWeek ?? (framework.id === "5on2off_day" ? 5 : 7)));
  const nightDays = Math.max(0, Math.min(7, params.nightDaysPerWeek ?? (framework.id === "5on2off_day" ? 0 : 7)));

  const weeklyRequiredHours =
    params.dayGuardsRequired * dayDays * shiftHours +
    params.nightGuardsRequired * nightDays * shiftHours;

  const minimumGuardsWithoutOvertime = Math.max(1, Math.ceil(weeklyRequiredHours / 48));

  const dayTeamsNeeded =
    params.dayGuardsRequired === 0
      ? 0
      : dayDays >= 6
        ? params.dayGuardsRequired * (framework.id === "4on2off_swing" || framework.id === "6on3off_mixed" ? 1.5 : 2)
        : params.dayGuardsRequired;
  const nightTeamsNeeded =
    params.nightGuardsRequired === 0
      ? 0
      : nightDays >= 6
        ? params.nightGuardsRequired * (framework.id === "4on2off_swing" || framework.id === "6on3off_mixed" ? 1.5 : 2)
        : params.nightGuardsRequired;

  const frameworkRecommended = Math.max(1, Math.ceil(dayTeamsNeeded + nightTeamsNeeded));
  const recommendedTotalGuards = Math.max(frameworkRecommended, minimumGuardsWithoutOvertime);

  const estimatedWeeklyHoursPerGuard =
    recommendedTotalGuards > 0
      ? Math.round((weeklyRequiredHours / recommendedTotalGuards) * 10) / 10
      : 0;

  const weeklyOvertimePerGuard = Math.max(0, estimatedWeeklyHoursPerGuard - 48);
  const estimatedMonthlyOvertimeHours = Math.round(weeklyOvertimePerGuard * recommendedTotalGuards * 4.33 * 10) / 10;

  const complianceNotes: string[] = [];
  if (weeklyRequiredHours > 0 && estimatedWeeklyHoursPerGuard <= 48) {
    complianceNotes.push(
      `Zero planned weekly overtime (~${estimatedWeeklyHoursPerGuard}h/guard per week <= 48h SA NBCPSS limit).`,
    );
  } else if (estimatedWeeklyHoursPerGuard > 48) {
    complianceNotes.push(
      `With ${recommendedTotalGuards} guards, average is ${estimatedWeeklyHoursPerGuard}h/wk — add relievers up to ${minimumGuardsWithoutOvertime} guards to stay <= 48h/wk.`,
    );
  }
  if (framework.requiresAveragingAgreement) {
    complianceNotes.push(
      "Uses 6-day blocks; enable BCEA s12 averaging or 60h fortnightly rest in Company Settings.",
    );
  }

  return {
    framework,
    recommendedTotalGuards,
    minimumGuardsWithoutOvertime,
    estimatedWeeklyHoursPerGuard,
    estimatedMonthlyOvertimeHours,
    complianceNotes,
  };
}
