import {
  addDaysToDateKey,
  BceaEmployeeCategory,
  EffectiveHolidayEntry,
  getIsoWeekStartKey,
  getNightAllowanceRateForDate,
  getSastDayOfWeek,
  LabourComplianceSettings,
  SA_NBCPSS_RULES,
  toSastDate,
  toSastDateKey,
} from "../lib/sa-labour-rules.config.js";

export type ComplianceFlagCode =
  | "WEEKLY_OT_CAP_EXCEEDED"
  | "DAILY_HOURS_OVER_12"
  | "DAILY_REST_UNDER_12H"
  | "WEEKLY_REST_UNDER_36H"
  | "PSIRA_EXPIRED"
  | "FIREARM_EXPIRED"
  | "SUNDAY_UNSCHEDULED_2X";

export interface ComplianceFlag {
  code: ComplianceFlagCode;
  severity: "info" | "warning" | "error";
  message: string;
  dateKey: string;
  hoursDelta?: number;
}

export interface ShiftClassificationInput {
  id: string;
  employeeId: string;
  siteId?: string | null;
  startTime: Date;
  endTime: Date;
  scheduledStartTime?: Date | null;
  scheduledEndTime?: Date | null;
  /** True when the shift was planned on a roster / pattern vs ad-hoc unscheduled call-in */
  isScheduledOnRoster?: boolean;
  /** Meal interval settings (default: paid 60m per NBCPSS continuous post duty) */
  mealIntervalPaid?: boolean;
  mealIntervalMinutes?: number;
  employeeCategory?: BceaEmployeeCategory;
  /** True for pre-period carryover shifts strictly used to accumulate weekly ordinary caps */
  isCarryoverContextOnly?: boolean;
}

export interface ClassifiedShiftBreakdown {
  id: string;
  dateKey: string;
  totalHours: number;
  basicHours: number;
  overtimeHours: number;
  sundayHours: number;
  sundayDoubleHours: number;
  publicHolidayHours: number;
  nightShiftHours: number;
  nightShiftCount: number;
  nightAllowanceRand: number;
  mealDeductionHours: number;
  flags: ComplianceFlag[];
}

export interface WeeklyComplianceBucket {
  weekStartKey: string;
  ordinaryHoursWorked: number;
  ordinaryCapHours: number;
  overtimeHoursWorked: number;
  overtimeCapHours: number;
  maxConsecutiveRestHours: number;
  restCapMet: boolean;
}

export interface GuardPeriodSummary {
  employeeId: string;
  totalWorkedHours: number;
  basicHours: number;
  overtimeHours: number;
  sundayHours: number;
  sundayDoubleHours: number;
  publicHolidayHours: number;
  nightShiftHours: number;
  nightShiftCount: number;
  nightAllowanceTotalRand: number;
  weeklyBuckets: WeeklyComplianceBucket[];
  flags: ComplianceFlag[];
  byShiftId: Map<string, ClassifiedShiftBreakdown>;
}

export interface EmployeeCredentialCheckInput {
  psiraRegistrationExpiry?: Date | null;
  firearmCompetency?: boolean;
  firearmCompetencyExpiry?: Date | null;
}

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Computes exact minutes overlapping the SA statutory night window `[18:00, 06:00]` SAST.
 */
export function computeNightWindowMinutes(startUtc: Date, endUtc: Date): number {
  if (endUtc.getTime() <= startUtc.getTime()) return 0;

  const startSast = toSastDate(startUtc);
  const startDayFloorUtcMs = Date.UTC(
    startSast.getUTCFullYear(),
    startSast.getUTCMonth(),
    startSast.getUTCDate(),
  );
  const endSastMs = startSast.getTime() + (endUtc.getTime() - startUtc.getTime());
  const startSastMs = startSast.getTime();

  // Check each overlapping SAST calendar day starting 1 day before startSast through endSast
  const daySpan = Math.ceil((endSastMs - startDayFloorUtcMs) / 86_400_000) + 1;
  let nightMs = 0;

  for (let offset = -1; offset <= daySpan; offset++) {
    const dayStart = startDayFloorUtcMs + offset * 86_400_000;
    const windowStart = dayStart + SA_NBCPSS_RULES.nightWindowStartHour * MS_PER_HOUR; // 18:00
    const windowEnd = dayStart + (24 + SA_NBCPSS_RULES.nightWindowEndHour) * MS_PER_HOUR; // next day 06:00
    const overlapStart = Math.max(startSastMs, windowStart);
    const overlapEnd = Math.min(endSastMs, windowEnd);
    if (overlapEnd > overlapStart) {
      nightMs += overlapEnd - overlapStart;
    }
  }

  return Math.round(nightMs / MS_PER_MIN);
}

interface DaySegment {
  dateKey: string;
  grossMinutes: number;
  nightMinutes: number;
}

/**
 * Splits a UTC interval into SAST date segments according to `overnightBoundaryMode`.
 */
function buildShiftSegments(
  startUtc: Date,
  endUtc: Date,
  mode: LabourComplianceSettings["overnightBoundaryMode"],
): DaySegment[] {
  const totalGrossMin = Math.max(0, Math.round((endUtc.getTime() - startUtc.getTime()) / MS_PER_MIN));
  if (totalGrossMin <= 0) return [];

  if (mode === "shift_start_day") {
    return [
      {
        dateKey: toSastDateKey(startUtc),
        grossMinutes: totalGrossMin,
        nightMinutes: computeNightWindowMinutes(startUtc, endUtc),
      },
    ];
  }

  // midnight_split: slice cleanly at every SAST 00:00 boundary
  const segments: DaySegment[] = [];
  let cursorUtc = new Date(startUtc.getTime());
  while (cursorUtc.getTime() < endUtc.getTime()) {
    const cursorSast = toSastDate(cursorUtc);
    const nextMidnightSastMs = Date.UTC(
      cursorSast.getUTCFullYear(),
      cursorSast.getUTCMonth(),
      cursorSast.getUTCDate() + 1,
    );
    const msUntilMidnight = nextMidnightSastMs - cursorSast.getTime();
    const sliceEndUtc = new Date(Math.min(endUtc.getTime(), cursorUtc.getTime() + msUntilMidnight));
    const sliceGrossMin = Math.max(
      0,
      Math.round((sliceEndUtc.getTime() - cursorUtc.getTime()) / MS_PER_MIN),
    );
    if (sliceGrossMin > 0) {
      segments.push({
        dateKey: toSastDateKey(cursorUtc),
        grossMinutes: sliceGrossMin,
        nightMinutes: computeNightWindowMinutes(cursorUtc, sliceEndUtc),
      });
    }
    cursorUtc = sliceEndUtc;
  }

  return segments;
}

function getCategoryCaps(category: BceaEmployeeCategory) {
  if (category === "general") {
    return {
      weeklyOrdinaryHours: SA_NBCPSS_RULES.generalStaffMaxWeeklyOrdinaryHours,
      dailyMaxHours: SA_NBCPSS_RULES.securityOfficerMaxDailyHours, // allow up to 12h shift ceiling before flagging
      weeklyOvertimeCapHours: SA_NBCPSS_RULES.maxWeeklyOvertimeHours,
    };
  }
  return {
    weeklyOrdinaryHours: SA_NBCPSS_RULES.securityOfficerMaxWeeklyOrdinaryHours,
    dailyMaxHours: SA_NBCPSS_RULES.securityOfficerMaxDailyHours,
    weeklyOvertimeCapHours: SA_NBCPSS_RULES.maxWeeklyOvertimeHours,
  };
}

/**
 * Classifies all shifts for a single employee across all sites for a pay period using
 * South African NBCPSS Main Collective Agreement + BCEA rules:
 * - Multi-site weekly ordinary bucket (48h security / 45h general) with optional carryover week
 * - Optional BCEA s12 multi-week averaging
 * - Daily excess past scheduled end / >12h -> 1.5x overtime
 * - Sunday ordinary (1.5x scheduled) vs double time (2.0x unscheduled)
 * - Public Holiday (2.0x, including statutory Sunday->Monday observed holidays)
 * - Night shift (>=50% in 18:00-06:00 SAST) count & R8/R6 per-shift allowance
 * - Daily rest (<12h) and weekly consecutive rest (<36h/week or <60h/fortnight) flags
 */
export function classifyEmployeePeriodShifts(params: {
  employeeId: string;
  shifts: ShiftClassificationInput[];
  holidays: Map<string, EffectiveHolidayEntry>;
  settings: LabourComplianceSettings;
  employeeCredentials?: EmployeeCredentialCheckInput;
  defaultCategory?: BceaEmployeeCategory;
}): GuardPeriodSummary {
  const sorted = [...params.shifts].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const byShiftId = new Map<string, ClassifiedShiftBreakdown>();
  const allFlags: ComplianceFlag[] = [];

  // Track ordinary hours consumed per ISO week (Monday-Sunday) across all sites
  const weeklyOrdinaryMinUsed = new Map<string, number>();
  const weeklyOvertimeMinUsed = new Map<string, number>();
  const weeklyCategory = new Map<string, BceaEmployeeCategory>();

  // Track averaging cycle totals when averagingEnabled is true (period shifts only)
  const defaultCat = params.defaultCategory ?? "security_officer";
  const periodRealShifts = sorted.filter((s) => !s.isCarryoverContextOnly);
  const periodWeekSet = new Set<string>();
  for (const s of periodRealShifts) {
    periodWeekSet.add(getIsoWeekStartKey(toSastDateKey(s.startTime)));
  }

  let averagingOrdinaryUsedMin = 0;
  const averagingWeekCount = params.settings.averagingEnabled
    ? Math.max(1, Math.min(params.settings.averagingWeeks, Math.max(1, periodWeekSet.size)))
    : 1;
  const averagingTotalOrdinaryCapMin =
    getCategoryCaps(defaultCat).weeklyOrdinaryHours * 60 * averagingWeekCount;

  // Credential checks against latest worked shift date
  if (periodRealShifts.length > 0 && params.employeeCredentials) {
    const latestShift = periodRealShifts[periodRealShifts.length - 1];
    const latestDateKey = toSastDateKey(latestShift.startTime);
    if (
      params.employeeCredentials.psiraRegistrationExpiry &&
      params.employeeCredentials.psiraRegistrationExpiry.getTime() < latestShift.startTime.getTime()
    ) {
      allFlags.push({
        code: "PSIRA_EXPIRED",
        severity: "error",
        dateKey: latestDateKey,
        message: `PSIRA registration expired on ${toSastDateKey(
          params.employeeCredentials.psiraRegistrationExpiry,
        )}`,
      });
    }
    if (
      params.employeeCredentials.firearmCompetency &&
      params.employeeCredentials.firearmCompetencyExpiry &&
      params.employeeCredentials.firearmCompetencyExpiry.getTime() < latestShift.startTime.getTime()
    ) {
      allFlags.push({
        code: "FIREARM_EXPIRED",
        severity: "warning",
        dateKey: latestDateKey,
        message: `Firearm competency expired on ${toSastDateKey(
          params.employeeCredentials.firearmCompetencyExpiry,
        )}`,
      });
    }
  }

  let sumWorkedMin = 0;
  let sumBasicMin = 0;
  let sumOvertimeMin = 0;
  let sumSundayOrdMin = 0;
  let sumSundayDblMin = 0;
  let sumHolidayMin = 0;
  let sumNightMin = 0;
  let sumNightCount = 0;
  let sumNightAllowanceRand = 0;

  for (let idx = 0; idx < sorted.length; idx++) {
    const shift = sorted[idx];
    const grossMin = Math.max(
      0,
      Math.round((shift.endTime.getTime() - shift.startTime.getTime()) / MS_PER_MIN),
    );
    const shiftFlags: ComplianceFlag[] = [];
    const shiftDateKey = toSastDateKey(shift.startTime);

    // Deduct unpaid meal interval if configured by site and shift exceeds 5 hours
    const mealPaid = shift.mealIntervalPaid ?? true;
    const mealConfiguredMin = shift.mealIntervalMinutes ?? SA_NBCPSS_RULES.defaultMealIntervalMinutes;
    const mealDeductionMin =
      !mealPaid && grossMin > SA_NBCPSS_RULES.mealThresholdMinutes
        ? Math.min(mealConfiguredMin, Math.max(0, grossMin - 60))
        : 0;
    const netWorkedMin = Math.max(0, grossMin - mealDeductionMin);

    // Scheduled duration ceiling (explicit extra beyond scheduled end time)
    const scheduledGrossMin =
      shift.scheduledStartTime && shift.scheduledEndTime
        ? Math.max(
            0,
            Math.round(
              (shift.scheduledEndTime.getTime() - shift.scheduledStartTime.getTime()) / MS_PER_MIN,
            ),
          )
        : null;
    const scheduledNetCapMin =
      scheduledGrossMin !== null
        ? Math.max(
            0,
            scheduledGrossMin -
              (!mealPaid && scheduledGrossMin > SA_NBCPSS_RULES.mealThresholdMinutes
                ? Math.min(mealConfiguredMin, Math.max(0, scheduledGrossMin - 60))
                : 0),
          )
        : null;

    // Rest check: gap since previous worked shift (only warn on period shifts)
    if (idx > 0 && !shift.isCarryoverContextOnly) {
      const prev = sorted[idx - 1];
      const gapHours = (shift.startTime.getTime() - prev.endTime.getTime()) / MS_PER_HOUR;
      if (gapHours >= 0 && gapHours < SA_NBCPSS_RULES.minDailyRestHours) {
        const flag: ComplianceFlag = {
          code: "DAILY_REST_UNDER_12H",
          severity: gapHours < 8 ? "error" : "warning",
          dateKey: shiftDateKey,
          hoursDelta: round2(SA_NBCPSS_RULES.minDailyRestHours - gapHours),
          message: `Only ${round2(gapHours)}h rest after previous shift (minimum 12h required)`,
        };
        shiftFlags.push(flag);
        allFlags.push(flag);
      }
    }

    // Daily >12h check
    const netHours = netWorkedMin / 60;
    if (!shift.isCarryoverContextOnly && netHours > SA_NBCPSS_RULES.securityOfficerMaxDailyHours + 0.01) {
      const flag: ComplianceFlag = {
        code: "DAILY_HOURS_OVER_12",
        severity: "warning",
        dateKey: shiftDateKey,
        hoursDelta: round2(netHours - SA_NBCPSS_RULES.securityOfficerMaxDailyHours),
        message: `Shift duration ${round2(netHours)}h exceeds 12h SA daily maximum`,
      };
      shiftFlags.push(flag);
      allFlags.push(flag);
    }

    // Night shift qualification based on full shift span
    const totalShiftNightMin = computeNightWindowMinutes(shift.startTime, shift.endTime);
    const nightRatio = grossMin > 0 ? totalShiftNightMin / grossMin : 0;
    const isNightQualifying =
      netWorkedMin > 0 && nightRatio >= SA_NBCPSS_RULES.nightShiftQualifyingThresholdRatio;
    const nightAllowance = isNightQualifying ? getNightAllowanceRateForDate(shift.startTime) : 0;

    // Split into SAST calendar segments according to company boundary mode
    const segments = buildShiftSegments(
      shift.startTime,
      shift.endTime,
      params.settings.overnightBoundaryMode,
    );
    const segGrossTotal = segments.reduce((acc, s) => acc + s.grossMinutes, 0) || 1;

    const category = shift.employeeCategory ?? defaultCat;
    const caps = getCategoryCaps(category);
    const weeklyOrdCapMin = caps.weeklyOrdinaryHours * 60;

    let shiftBasicMin = 0;
    let shiftOtMin = 0;
    let shiftSunOrdMin = 0;
    let shiftSunDblMin = 0;
    let shiftHolidayMin = 0;
    let remainingScheduledMin = scheduledNetCapMin ?? netWorkedMin;

    let allocatedNetSoFar = 0;
    for (let sIdx = 0; sIdx < segments.length; sIdx++) {
      const seg = segments[sIdx];
      // Prorate net worked minutes proportionally across segments, absorbing rounding on last segment
      const segNetMin =
        sIdx === segments.length - 1
          ? Math.max(0, netWorkedMin - allocatedNetSoFar)
          : Math.round((netWorkedMin * seg.grossMinutes) / segGrossTotal);
      allocatedNetSoFar += segNetMin;
      if (segNetMin <= 0) continue;

      const weekKey = getIsoWeekStartKey(seg.dateKey);
      if (!weeklyCategory.has(weekKey)) weeklyCategory.set(weekKey, category);

      const isPublicHoliday = params.holidays.has(seg.dateKey);
      const isSunday = !isPublicHoliday && getSastDayOfWeek(seg.dateKey) === 0;

      if (isPublicHoliday) {
        shiftHolidayMin += segNetMin;
        remainingScheduledMin = Math.max(0, remainingScheduledMin - segNetMin);
        continue;
      }

      if (isSunday) {
        const isScheduledSunday = shift.isScheduledOnRoster !== false;
        if (isScheduledSunday) {
          shiftSunOrdMin += segNetMin;
        } else {
          shiftSunDblMin += segNetMin;
          if (!shift.isCarryoverContextOnly) {
            const flag: ComplianceFlag = {
              code: "SUNDAY_UNSCHEDULED_2X",
              severity: "info",
              dateKey: seg.dateKey,
              hoursDelta: round2(segNetMin / 60),
              message: `Unscheduled Sunday shift (${round2(segNetMin / 60)}h) qualifies for 2.0x Sunday rate`,
            };
            shiftFlags.push(flag);
            allFlags.push(flag);
          }
        }
        remainingScheduledMin = Math.max(0, remainingScheduledMin - segNetMin);
        continue;
      }

      // Ordinary day (Mon-Sat, non-holiday):
      // Step A: anything worked past scheduled shift length -> immediate overtime
      const withinScheduledMin = Math.min(segNetMin, remainingScheduledMin);
      const pastScheduledMin = segNetMin - withinScheduledMin;
      remainingScheduledMin = Math.max(0, remainingScheduledMin - withinScheduledMin);

      let ordMin = 0;
      let overflowOtMin = 0;

      if (params.settings.averagingEnabled && !shift.isCarryoverContextOnly) {
        const availAvgMin = Math.max(0, averagingTotalOrdinaryCapMin - averagingOrdinaryUsedMin);
        const dailyCapLeft = Math.min(availAvgMin, caps.dailyMaxHours * 60);
        ordMin = Math.min(withinScheduledMin, dailyCapLeft);
        overflowOtMin = withinScheduledMin - ordMin;
        averagingOrdinaryUsedMin += ordMin;
      } else {
        const usedWeekMin = weeklyOrdinaryMinUsed.get(weekKey) ?? 0;
        const remainingWeekCap = Math.max(0, weeklyOrdCapMin - usedWeekMin);
        ordMin = Math.min(withinScheduledMin, remainingWeekCap);
        overflowOtMin = withinScheduledMin - ordMin;
        weeklyOrdinaryMinUsed.set(weekKey, usedWeekMin + ordMin);
      }

      const totalSegOtMin = pastScheduledMin + overflowOtMin;
      shiftBasicMin += ordMin;
      shiftOtMin += totalSegOtMin;

      weeklyOvertimeMinUsed.set(
        weekKey,
        (weeklyOvertimeMinUsed.get(weekKey) ?? 0) + totalSegOtMin,
      );
    }

    if (!shift.isCarryoverContextOnly) {
      const scaledNightMin =
        grossMin > 0 ? Math.min(netWorkedMin, Math.round((totalShiftNightMin * netWorkedMin) / grossMin)) : 0;

      byShiftId.set(shift.id, {
        id: shift.id,
        dateKey: shiftDateKey,
        totalHours: round2(netWorkedMin / 60),
        basicHours: round2(shiftBasicMin / 60),
        overtimeHours: round2(shiftOtMin / 60),
        sundayHours: round2(shiftSunOrdMin / 60),
        sundayDoubleHours: round2(shiftSunDblMin / 60),
        publicHolidayHours: round2(shiftHolidayMin / 60),
        nightShiftHours: round2(scaledNightMin / 60),
        nightShiftCount: isNightQualifying ? 1 : 0,
        nightAllowanceRand: nightAllowance,
        mealDeductionHours: round2(mealDeductionMin / 60),
        flags: shiftFlags,
      });

      sumWorkedMin += netWorkedMin;
      sumBasicMin += shiftBasicMin;
      sumOtTotals();
      function sumOtTotals() {
        sumOvertimeMin += shiftOtMin;
        sumSundayOrdMin += shiftSunOrdMin;
        sumSundayDblMin += shiftSunDblMin;
        sumHolidayMin += shiftHolidayMin;
        sumNightMin += scaledNightMin;
        if (isNightQualifying) {
          sumNightCount += 1;
          sumNightAllowanceRand += nightAllowance;
        }
      }
    }
  }

  // Evaluate weekly OT cap + 36h consecutive weekly rest for each period ISO week
  const weeklyBuckets: WeeklyComplianceBucket[] = [];
  const sortedWeeks = [...periodWeekSet].sort();

  for (const weekStartKey of sortedWeeks) {
    const weekStartMs = new Date(`${weekStartKey}T00:00:00.000Z`).getTime() - 2 * MS_PER_HOUR;
    const weekEndMs = weekStartMs + 7 * 86_400_000;

    // Collect shifts intersecting this SAST week
    const weekIntervals: Array<{ startMs: number; endMs: number }> = [];
    for (const s of sorted) {
      const sMs = Math.max(weekStartMs, s.startTime.getTime());
      const eMs = Math.min(weekEndMs, s.endTime.getTime());
      if (eMs > sMs) {
        weekIntervals.push({ startMs: sMs, endMs: eMs });
      }
    }
    weekIntervals.sort((a, b) => a.startMs - b.startMs);

    let maxGapHours = 168;
    if (weekIntervals.length > 0) {
      maxGapHours = (weekIntervals[0].startMs - weekStartMs) / MS_PER_HOUR;
      let prevEnd = weekIntervals[0].endMs;
      for (let i = 1; i < weekIntervals.length; i++) {
        maxGapHours = Math.max(maxGapHours, (weekIntervals[i].startMs - prevEnd) / MS_PER_HOUR);
        prevEnd = Math.max(prevEnd, weekIntervals[i].endMs);
      }
      maxGapHours = Math.max(maxGapHours, (weekEndMs - prevEnd) / MS_PER_HOUR);
    }

    const cat = weeklyCategory.get(weekStartKey) ?? defaultCat;
    const caps = getCategoryCaps(cat);
    const ordWorkedHours = round2((weeklyOrdinaryMinUsed.get(weekStartKey) ?? 0) / 60);
    const otWorkedHours = round2((weeklyOvertimeMinUsed.get(weekStartKey) ?? 0) / 60);

    if (otWorkedHours > caps.weeklyOvertimeCapHours + 0.01) {
      allFlags.push({
        code: "WEEKLY_OT_CAP_EXCEEDED",
        severity: "warning",
        dateKey: weekStartKey,
        hoursDelta: round2(otWorkedHours - caps.weeklyOvertimeCapHours),
        message: `Week of ${weekStartKey}: ${otWorkedHours}h overtime exceeds 10h statutory weekly OT cap`,
      });
    }

    const restCapRequired = params.settings.fortnightlyRestEnabled
      ? SA_NBCPSS_RULES.minFortnightlyRestHours
      : SA_NBCPSS_RULES.minWeeklyRestHours;

    // Only enforce 36h check on weeks where guard actually worked >= 4 shifts (avoid flagging 1-shift partial boundary weeks)
    const restCapMet =
      params.settings.fortnightlyRestEnabled || weekIntervals.length < 4
        ? true
        : maxGapHours >= SA_NBCPSS_RULES.minWeeklyRestHours - 0.01;

    if (!restCapMet) {
      allFlags.push({
        code: "WEEKLY_REST_UNDER_36H",
        severity: "warning",
        dateKey: addDaysToDateKey(weekStartKey, 6),
        hoursDelta: round2(SA_NBCPSS_RULES.minWeeklyRestHours - maxGapHours),
        message: `Week of ${weekStartKey}: max continuous rest ${round2(maxGapHours)}h (below 36h weekly minimum)`,
      });
    }

    // Also suppress unused warning on restCapRequired
    void restCapRequired;

    weeklyBuckets.push({
      weekStartKey,
      ordinaryHoursWorked: ordWorkedHours,
      ordinaryCapHours: caps.weeklyOrdinaryHours,
      overtimeHoursWorked: otWorkedHours,
      overtimeCapHours: caps.weeklyOvertimeCapHours,
      maxConsecutiveRestHours: round2(maxGapHours),
      restCapMet,
    });
  }

  return {
    employeeId: params.employeeId,
    totalWorkedHours: round2(sumWorkedMin / 60),
    basicHours: round2(sumBasicMin / 60),
    overtimeHours: round2(sumOvertimeMin / 60),
    sundayHours: round2(sumSundayOrdMin / 60),
    sundayDoubleHours: round2(sumSundayDblMin / 60),
    publicHolidayHours: round2(sumHolidayMin / 60),
    nightShiftHours: round2(sumNightMin / 60),
    nightShiftCount: sumNightCount,
    nightAllowanceTotalRand: round2(sumNightAllowanceRand),
    weeklyBuckets,
    flags: allFlags,
    byShiftId,
  };
}
