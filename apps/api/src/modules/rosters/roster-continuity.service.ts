import type {
  Prisma,
  SiteRosterShiftCode,
  SiteRosterGeneratedSource,
} from "@prisma/client";
import { hasCapability } from "../../lib/capabilities.js";
import type { AuthenticatedUser } from "../../lib/types.js";
import { prisma } from "../../lib/prisma.js";
import {
  getRosterPeriodCalendar,
  parsePayrollCalendarSettings,
} from "../../lib/payroll-calendar-settings.js";
import {
  getCurrentRosterPeriod,
  getNextSpanningPeriod,
  startOfUtcDay,
} from "../../services/payroll-period.service.js";
import { getCompanyTimezone, getShiftTimes } from "../../lib/timezone.js";
import { meetsSiteShiftGenderRule } from "../../services/rostering.service.js";
import { shiftCodeToType } from "./lib/pattern-parser.js";
import {
  inferRepeatingRosterPattern,
  inferRosterCalendarId,
  type InferredPatternCell,
  type RosterObservation,
} from "./roster-pattern-inference.js";

const ROSTERABLE_STATUSES = new Set(["active", "training", "hired", "reliever"]);
const WORKING_CODES = new Set<SiteRosterShiftCode>(["D", "N"]);
const DAY_MS = 86_400_000;
const FREEZE_HOURS = 24;

type ContinuityIssue = {
  code: string;
  message: string;
  dateKey?: string;
  shiftType?: "day" | "night";
  guardId?: string;
};

export type RosterActionPermissions = {
  canManageBaseline: boolean;
  canManageExceptions: boolean;
  canUseAdvancedEditor: boolean;
};

export function rosterActionPermissions(user: AuthenticatedUser): RosterActionPermissions {
  const canManageBaseline = hasCapability(user, "/rostering", "edit");
  return {
    canManageBaseline,
    canManageExceptions: hasCapability(user, "/rostering", "approve"),
    canUseAdvancedEditor: canManageBaseline,
  };
}

export type ReconcileContinuityResult = {
  siteId: string;
  state: "running" | "needs_attention" | "paused" | "not_setup";
  maintainedThrough: string | null;
  generated: number;
  published: number;
  updated: number;
  removed: number;
  issues: ContinuityIssue[];
};

function dateKey(value: Date | string): string {
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : value;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dateOnly(value: Date | string): Date {
  return new Date(`${dateKey(value)}T00:00:00.000Z`);
}

function addDays(value: Date | string, days: number): Date {
  const result = dateOnly(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function patternDayForDate(anchor: Date, cycleLength: number, target: Date): number {
  const difference = Math.floor((dateOnly(target).getTime() - dateOnly(anchor).getTime()) / DAY_MS);
  return ((difference % cycleLength) + cycleLength) % cycleLength;
}

function latestDate(values: Date[]): Date | null {
  return values.length === 0
    ? null
    : new Date(Math.max(...values.map((value) => value.getTime())));
}

function sourceForOverride(reason: string | null | undefined): SiteRosterGeneratedSource {
  return reason?.startsWith("[replacement:") ? "replacement" : "manual_override";
}

function leaveCode(type: string): SiteRosterShiftCode {
  return type.toLowerCase().includes("sick") ? "SL" : "L";
}

function isEffectiveAssignment(
  assignment: { isActive: boolean; effectiveFrom: Date | null; effectiveTo: Date | null },
  onDate: Date
): boolean {
  return (
    assignment.isActive &&
    (!assignment.effectiveFrom || dateOnly(assignment.effectiveFrom) <= onDate) &&
    (!assignment.effectiveTo || dateOnly(assignment.effectiveTo) >= onDate)
  );
}

function buildFallbackShiftObservations(input: {
  guardIds: string[];
  shifts: { employeeId: string; startTime: Date; shiftType: string | null }[];
}): RosterObservation[] {
  const dates = input.shifts.map((shift) => dateOnly(shift.startTime));
  const end = latestDate(dates);
  if (!end) return [];
  const start = addDays(end, -61);
  const shiftByGuardDate = new Map<string, SiteRosterShiftCode>();
  for (const shift of input.shifts) {
    const key = `${shift.employeeId}:${dateKey(shift.startTime)}`;
    shiftByGuardDate.set(key, shift.shiftType?.toLowerCase() === "night" ? "N" : "D");
  }

  const observations: RosterObservation[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const key = dateKey(day);
    for (const guardId of input.guardIds) {
      observations.push({
        guardId,
        dateKey: key,
        shiftCode: shiftByGuardDate.get(`${guardId}:${key}`) ?? "O",
      });
    }
  }
  return observations;
}

export async function getContinuitySetupSuggestion(companyId: string, siteId: string) {
  const site = await prisma.site.findFirst({
    where: { id: siteId, companyId },
    include: {
      company: { select: { settings: true } },
      assignedGuards: {
        where: { isActive: true },
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, status: true, employeeType: true },
          },
        },
      },
    },
  });
  if (!site) return null;

  const guardIds = site.assignedGuards
    .filter(
      ({ employee }) =>
        (employee.employeeType ?? "security") === "security" &&
        ROSTERABLE_STATUSES.has(employee.status)
    )
    .map(({ employee }) => employee.id);
  const guardIdSet = new Set(guardIds);

  const [generatedRows, publishedRows] = await Promise.all([
    prisma.siteRosterGeneratedShift.findMany({
      where: { companyId, siteId, guardId: { in: guardIds } },
      select: { guardId: true, rosterDate: true, shiftCode: true },
      orderBy: { rosterDate: "asc" },
      take: 10_000,
    }),
    prisma.shift.findMany({
      where: { companyId, siteId, employeeId: { in: guardIds } },
      select: { employeeId: true, startTime: true, shiftType: true },
      orderBy: { startTime: "asc" },
      take: 10_000,
    }),
  ]);

  const gridObservations: RosterObservation[] = generatedRows
    .filter((row) => guardIdSet.has(row.guardId))
    .map((row) => ({
      guardId: row.guardId,
      dateKey: dateKey(row.rosterDate),
      shiftCode: row.shiftCode,
    }));
  const observations =
    gridObservations.length > 0
      ? gridObservations
      : buildFallbackShiftObservations({ guardIds, shifts: publishedRows });
  const inference = inferRepeatingRosterPattern(observations);
  const calendarSettings = parsePayrollCalendarSettings(site.company.settings);

  if (!inference) {
    return {
      siteId,
      siteName: site.name,
      canActivate: false,
      confidencePercent: 0,
      source: gridObservations.length > 0 ? "roster_grid" : "published_shifts",
      message: "Not enough consistent roster history was found. Choose a simple pattern manually.",
      assignedGuards: site.assignedGuards.map(({ employee }) => ({
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
      })),
      calendars: calendarSettings.rosterPeriodCalendars,
      recommendedCalendarId: calendarSettings.defaultRosterPeriodCalendarId,
      recommendedEffectiveFrom: dateKey(startOfUtcDay(new Date())),
      pattern: null,
      issues: ["At least two complete cycles are required for a reliable suggestion."],
    };
  }

  const inferredCalendar = inferRosterCalendarId(
    inference.sourceStart,
    inference.sourceEnd,
    calendarSettings.rosterPeriodCalendars,
    calendarSettings.defaultRosterPeriodCalendarId
  );
  const lastExisting = latestDate([
    ...generatedRows.map((row) => row.rosterDate),
    ...publishedRows.map((row) => row.startTime),
  ]);
  const nextExistingDate = lastExisting ? addDays(lastExisting, 1) : startOfUtcDay(new Date());
  const recommendedEffectiveFrom = dateKey(
    nextExistingDate > startOfUtcDay(new Date()) ? nextExistingDate : startOfUtcDay(new Date())
  );

  const coverageIssues: string[] = [];
  for (let index = 0; index < inference.cycleLengthDays; index += 1) {
    const cells = inference.cells.filter((cell) => cell.patternDayIndex === index);
    const dayCount = cells.filter((cell) => cell.shiftCode === "D").length;
    const nightCount = cells.filter((cell) => cell.shiftCode === "N").length;
    if (dayCount < site.rosterDayShiftGuardsRequired) {
      coverageIssues.push(`Cycle day ${index + 1} is short ${site.rosterDayShiftGuardsRequired - dayCount} day guard(s).`);
    }
    if (nightCount < site.rosterNightShiftGuardsRequired) {
      coverageIssues.push(`Cycle day ${index + 1} is short ${site.rosterNightShiftGuardsRequired - nightCount} night guard(s).`);
    }
  }

  return {
    siteId,
    siteName: site.name,
    canActivate: inference.confidencePercent >= 85 && coverageIssues.length === 0,
    confidencePercent: inference.confidencePercent,
    source: gridObservations.length > 0 ? "roster_grid" : "published_shifts",
    sourcePeriod: { startDate: inference.sourceStart, endDate: inference.sourceEnd },
    calendars: calendarSettings.rosterPeriodCalendars,
    recommendedCalendarId: inferredCalendar.calendarId,
    calendarConfidence: inferredCalendar.confidence,
    recommendedEffectiveFrom,
    assignedGuards: site.assignedGuards.map(({ employee }) => ({
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
    })),
    pattern: {
      name: `Ongoing roster from ${inference.sourceStart}`,
      anchorDate: inference.anchorDate,
      cycleLengthDays: inference.cycleLengthDays,
      cells: inference.cells,
    },
    issues: coverageIssues,
  };
}

export async function activateRosterContinuity(
  companyId: string,
  userId: string,
  siteId: string,
  input: {
    calendarId?: string;
    effectiveFrom?: string;
    name?: string;
    anchorDate?: string;
    cycleLengthDays?: number;
    cells?: InferredPatternCell[];
  }
) {
  const suggestion = await getContinuitySetupSuggestion(companyId, siteId);
  if (!suggestion) return null;
  const suggestedPattern = suggestion.pattern;
  const cells = input.cells ?? suggestedPattern?.cells;
  const cycleLengthDays = input.cycleLengthDays ?? suggestedPattern?.cycleLengthDays;
  const anchorDate = input.anchorDate ?? suggestedPattern?.anchorDate;
  const effectiveFrom = input.effectiveFrom ?? suggestion.recommendedEffectiveFrom;
  const calendarId = input.calendarId ?? suggestion.recommendedCalendarId;
  if (!cells?.length || !cycleLengthDays || !anchorDate || !effectiveFrom) {
    return { error: "A confirmed pattern is required before continuity can be activated." } as const;
  }
  if (cells.some((cell) => cell.patternDayIndex < 0 || cell.patternDayIndex >= cycleLengthDays)) {
    return { error: "Pattern cells must fall inside the selected cycle length." } as const;
  }

  const pattern = await prisma.$transaction(async (tx) => {
    const site = await tx.site.findFirst({
      where: { id: siteId, companyId },
      include: { company: { select: { settings: true } } },
    });
    if (!site) return null;
    const settings = parsePayrollCalendarSettings(site.company.settings);
    if (!settings.rosterPeriodCalendars.some((calendar) => calendar.id === calendarId)) {
      throw new Error("ROSTER_CALENDAR_NOT_FOUND");
    }
    const assignedGuards = await tx.siteAssignment.findMany({
      where: { siteId, isActive: true, employee: { companyId } },
      select: { employeeId: true },
    });
    const assignedGuardIds = new Set(assignedGuards.map((assignment) => assignment.employeeId));
    if (cells.some((cell) => !assignedGuardIds.has(cell.guardId))) {
      throw new Error("PATTERN_GUARD_NOT_ASSIGNED");
    }
    const uniqueCellKeys = new Set(cells.map((cell) => `${cell.guardId}:${cell.patternDayIndex}`));
    if (uniqueCellKeys.size !== cells.length) throw new Error("DUPLICATE_PATTERN_CELL");

    const effectiveDate = dateOnly(effectiveFrom);
    await tx.siteRosterPattern.updateMany({
      where: { siteId, companyId, status: "active" },
      data: { status: "archived", effectiveTo: addDays(effectiveDate, -1) },
    });
    const created = await tx.siteRosterPattern.create({
      data: {
        companyId,
        siteId,
        name: input.name?.trim() || suggestedPattern?.name || "Ongoing roster",
        anchorDate: dateOnly(anchorDate),
        cycleLengthDays,
        effectiveFrom: effectiveDate,
        status: "active",
        createdBy: userId,
        cells: {
          create: cells.map((cell) => ({
            guardId: cell.guardId,
            patternDayIndex: cell.patternDayIndex,
            shiftCode: cell.shiftCode,
            shiftType: shiftCodeToType(cell.shiftCode),
          })),
        },
      },
    });
    await tx.site.update({
      where: { id: siteId },
      data: {
        rosterPeriodCalendarId: calendarId,
        rosterContinuityState: "running",
        rosterContinuityPauseReason: null,
        autoRosterEnabled: false,
      },
    });
    return created;
  });
  if (!pattern) return null;
  const reconciliation = await reconcileRosterContinuityForSite(companyId, siteId, {
    userId,
    trigger: "activation",
  });
  return { patternId: pattern.id, reconciliation };
}

function rosterWindow(settingsValue: unknown, calendarId: string | null, now: Date) {
  const settings = parsePayrollCalendarSettings(settingsValue);
  const calendar = getRosterPeriodCalendar(settings, calendarId);
  const bounds = { startDay: calendar.startDay, endDay: calendar.endDay };
  let period = getCurrentRosterPeriod(settings, calendar.id, now);
  const periods = [period];
  for (let index = 1; index < settings.autoRosterHorizonPeriods; index += 1) {
    period = getNextSpanningPeriod(bounds, period, {
      calendarId: calendar.id,
      calendarName: calendar.name,
    });
    periods.push(period);
  }
  return {
    settings,
    calendar,
    start: startOfUtcDay(now),
    end: dateOnly(periods[periods.length - 1]!.periodEnd),
  };
}

function desiredCoverage(
  rows: { date: Date; code: SiteRosterShiftCode }[],
  requiredDay: number,
  requiredNight: number
) {
  const result = new Map<string, { day: number; night: number }>();
  for (const row of rows) {
    const key = dateKey(row.date);
    const current = result.get(key) ?? { day: 0, night: 0 };
    if (row.code === "D") current.day += 1;
    if (row.code === "N") current.night += 1;
    result.set(key, current);
  }
  return { result, requiredDay, requiredNight };
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Seeds the rest-rule/consecutive-day-streak maps with real history from the days just
 * before the reconciliation window. Without this, the window always starts at "today" and
 * both maps would start empty every run — meaning the night-shift-into-day-shift rest rule
 * and the 6-consecutive-day cap could never fire on the first day of any reconciliation.
 * Only looks back 7 days: beyond the 6-day cap, the exact streak length no longer changes
 * whether CONSECUTIVE_WORK_LIMIT should fire on the next working day.
 */
export async function seedGuardWorkHistory(
  tx: Prisma.TransactionClient,
  companyId: string,
  siteId: string,
  guardIds: string[],
  start: Date
): Promise<{
  previousWorkingTypeByGuard: Map<string, "day" | "night">;
  consecutiveWorkingDaysByGuard: Map<string, number>;
}> {
  const previousWorkingTypeByGuard = new Map<string, "day" | "night">();
  const consecutiveWorkingDaysByGuard = new Map<string, number>();
  if (guardIds.length === 0) {
    return { previousWorkingTypeByGuard, consecutiveWorkingDaysByGuard };
  }

  const LOOKBACK_DAYS = 7;
  const priorShifts = await tx.siteRosterGeneratedShift.findMany({
    where: {
      companyId,
      siteId,
      guardId: { in: guardIds },
      rosterDate: { gte: addDays(start, -LOOKBACK_DAYS), lte: addDays(start, -1) },
    },
    select: { guardId: true, rosterDate: true, shiftCode: true },
  });
  const shiftByGuardDay = new Map<string, SiteRosterShiftCode>();
  for (const row of priorShifts) {
    shiftByGuardDay.set(`${row.guardId}:${dateKey(row.rosterDate)}`, row.shiftCode);
  }

  for (const guardId of guardIds) {
    let streak = 0;
    let previousType: "day" | "night" | undefined;
    for (let offset = 1; offset <= LOOKBACK_DAYS; offset += 1) {
      const code = shiftByGuardDay.get(`${guardId}:${dateKey(addDays(start, -offset))}`);
      const isWorking = code != null && WORKING_CODES.has(code);
      if (offset === 1) previousType = isWorking ? (code === "N" ? "night" : "day") : undefined;
      if (!isWorking) break;
      streak += 1;
    }
    if (previousType) previousWorkingTypeByGuard.set(guardId, previousType);
    if (streak > 0) consecutiveWorkingDaysByGuard.set(guardId, streak);
  }

  return { previousWorkingTypeByGuard, consecutiveWorkingDaysByGuard };
}

export async function reconcileRosterContinuityForSite(
  companyId: string,
  siteId: string,
  options: { now?: Date; userId?: string; trigger?: string } = {}
): Promise<ReconcileContinuityResult> {
  const now = options.now ?? new Date();
  const timeZone = await getCompanyTimezone(companyId);

  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`roster-continuity:${siteId}`})) IS NULL AS acquired
      `;
      const site = await tx.site.findFirst({
        where: { id: siteId, companyId },
        include: {
          company: { select: { settings: true } },
          siteRosterPatterns: {
            where: { status: "active" },
            include: { cells: true },
            orderBy: { effectiveFrom: "desc" },
            take: 1,
          },
          assignedGuards: {
            include: {
              employee: { select: { id: true, status: true, employeeType: true, gender: true } },
            },
          },
        },
      });
      if (!site) throw new Error("SITE_NOT_FOUND");
      if (site.rosterContinuityState === "paused") {
        return {
          siteId,
          state: "paused",
          maintainedThrough: site.rosterMaintainedThrough ? dateKey(site.rosterMaintainedThrough) : null,
          generated: 0,
          published: 0,
          updated: 0,
          removed: 0,
          issues: [],
        };
      }
      if (site.rosterContinuityState !== "running" && site.rosterContinuityState !== "needs_attention") {
        return {
          siteId,
          state: "not_setup",
          maintainedThrough: null,
          generated: 0,
          published: 0,
          updated: 0,
          removed: 0,
          issues: [],
        };
      }

      const pattern = site.siteRosterPatterns[0];
      if (!pattern) {
        await tx.site.update({
          where: { id: siteId },
          data: {
            rosterContinuityState: "needs_attention",
            rosterLastReconciledAt: now,
            rosterLastReconciliationStatus: "missing_pattern",
          },
        });
        return {
          siteId,
          state: "needs_attention",
          maintainedThrough: null,
          generated: 0,
          published: 0,
          updated: 0,
          removed: 0,
          issues: [{ code: "MISSING_PATTERN", message: "No active ongoing roster pattern was found." }],
        };
      }

      const window = rosterWindow(site.company.settings, site.rosterPeriodCalendarId, now);
      const start = window.start > pattern.effectiveFrom ? window.start : dateOnly(pattern.effectiveFrom);
      const end = pattern.effectiveTo && pattern.effectiveTo < window.end ? dateOnly(pattern.effectiveTo) : window.end;
      const freezeBoundary = new Date(now.getTime() + FREEZE_HOURS * 60 * 60 * 1000);
      const guardIds = [
        ...new Set([
          ...pattern.cells.map((cell) => cell.guardId),
          ...site.assignedGuards.map((assignment) => assignment.employeeId),
        ]),
      ];
      const [overrides, leaves, leaveApplications, generatedRows, shifts] = await Promise.all([
        tx.siteRosterManualOverride.findMany({
          where: { companyId, siteId, rosterDate: { gte: start, lte: end } },
        }),
        tx.leaveRecord.findMany({
          where: { employeeId: { in: guardIds }, date: { gte: start, lte: end } },
        }),
        tx.leaveApplication.findMany({
          where: {
            companyId,
            employeeId: { in: guardIds },
            startDate: { lte: end },
            endDate: { gte: start },
            status: { in: ["APPROVED", "CANCELLATION_REQUESTED", "PAYROLL_PROCESSED", "ADJUSTMENT_REQUIRED", "IMPORTED_APPROVED"] },
          },
          select: { employeeId: true, startDate: true, endDate: true, leaveType: { select: { code: true } } },
        }),
        tx.siteRosterGeneratedShift.findMany({
          where: { companyId, siteId, rosterDate: { gte: start, lte: end } },
          include: { publishedShift: true },
        }),
        tx.shift.findMany({
          where: {
            companyId,
            employeeId: { in: guardIds },
            startTime: { lt: addDays(end, 2) },
            endTime: { gt: start },
          },
        }),
      ]);

      const assignmentByGuard = new Map(site.assignedGuards.map((assignment) => [assignment.employeeId, assignment]));
      const overrideByKey = new Map(overrides.map((row) => [`${row.guardId}:${dateKey(row.rosterDate)}`, row]));
      const leaveByKey = new Map<string, { type: string }>(
        leaves.map((row) => [`${row.employeeId}:${dateKey(row.date)}`, { type: row.type }])
      );
      for (const application of leaveApplications) {
        const applicationStart = application.startDate > start ? dateOnly(application.startDate) : start;
        const applicationEnd = application.endDate < end ? dateOnly(application.endDate) : end;
        for (let day = applicationStart; day <= applicationEnd; day = addDays(day, 1)) {
          leaveByKey.set(`${application.employeeId}:${dateKey(day)}`, { type: application.leaveType.code });
        }
      }
      const generatedByKey = new Map(generatedRows.map((row) => [`${row.guardId}:${dateKey(row.rosterDate)}`, row]));
      const cellsByGuardDay = new Map(
        pattern.cells.map((cell) => [`${cell.guardId}:${cell.patternDayIndex}`, cell])
      );

      const desired: {
        guardId: string;
        date: Date;
        code: SiteRosterShiftCode;
        source: SiteRosterGeneratedSource;
      }[] = [];
      const issues: ContinuityIssue[] = [];
      const { previousWorkingTypeByGuard, consecutiveWorkingDaysByGuard } = await seedGuardWorkHistory(
        tx,
        companyId,
        siteId,
        guardIds,
        start
      );
      for (let day = start; day <= end; day = addDays(day, 1)) {
        const dayKey = dateKey(day);
        const patternDay = patternDayForDate(pattern.anchorDate, pattern.cycleLengthDays, day);
        for (const guardId of guardIds) {
          const key = `${guardId}:${dayKey}`;
          const patternCell = cellsByGuardDay.get(`${guardId}:${patternDay}`);
          const override = overrideByKey.get(key);
          if (!patternCell && !override) continue;
          const assignment = assignmentByGuard.get(guardId);
          if (
            !assignment ||
            !isEffectiveAssignment(assignment, day) ||
            !ROSTERABLE_STATUSES.has(assignment.employee.status) ||
            (assignment.employee.employeeType ?? "security") !== "security"
          ) {
            const unavailableCode = override?.overrideShiftCode ?? patternCell?.shiftCode ?? "blank";
            if (WORKING_CODES.has(unavailableCode)) {
              issues.push({
                code: "GUARD_UNAVAILABLE",
                guardId,
                dateKey: dayKey,
                shiftType: unavailableCode === "N" ? "night" : "day",
                message: `A patterned guard is unavailable on ${dayKey}.`,
              });
            }
            consecutiveWorkingDaysByGuard.set(guardId, 0);
            previousWorkingTypeByGuard.delete(guardId);
            continue;
          }

          const leave = leaveByKey.get(key);
          let nextItem: (typeof desired)[number];
          if (leave) {
            nextItem = { guardId, date: day, code: leaveCode(leave.type), source: "leave" };
          } else if (override) {
            nextItem = {
              guardId,
              date: day,
              code: override.overrideShiftCode,
              source: sourceForOverride(override.reason),
            };
          } else {
            nextItem = { guardId, date: day, code: patternCell!.shiftCode, source: "pattern" };
          }

          if (WORKING_CODES.has(nextItem.code)) {
            const nextType = nextItem.code === "N" ? "night" : "day";
            if (!meetsSiteShiftGenderRule(assignment.employee.gender, site, nextType)) {
              issues.push({
                code: "GENDER_RULE_MISMATCH",
                guardId,
                dateKey: dayKey,
                shiftType: nextType,
                message: `A patterned guard does not meet the ${nextType}-shift staffing rule on ${dayKey}.`,
              });
              consecutiveWorkingDaysByGuard.set(guardId, 0);
              previousWorkingTypeByGuard.delete(guardId);
              continue;
            }
            if (nextType === "day" && previousWorkingTypeByGuard.get(guardId) === "night") {
              issues.push({
                code: "REST_RULE_VIOLATION",
                guardId,
                dateKey: dayKey,
                shiftType: nextType,
                message: `A day shift follows a night shift without a rest day on ${dayKey}.`,
              });
              continue;
            }
            const streak = (consecutiveWorkingDaysByGuard.get(guardId) ?? 0) + 1;
            if (streak > 6) {
              issues.push({
                code: "CONSECUTIVE_WORK_LIMIT",
                guardId,
                dateKey: dayKey,
                shiftType: nextType,
                message: `A patterned guard would exceed six consecutive working days on ${dayKey}.`,
              });
              continue;
            }
            consecutiveWorkingDaysByGuard.set(guardId, streak);
            previousWorkingTypeByGuard.set(guardId, nextType);
          } else {
            consecutiveWorkingDaysByGuard.set(guardId, 0);
            previousWorkingTypeByGuard.delete(guardId);
          }
          desired.push(nextItem);
        }
      }

      let generated = 0;
      let published = 0;
      let updated = 0;
      let removed = 0;

      // A confirmed replacement guard must take over the absent guard's still-live shift
      // rather than get a brand-new one created alongside it — otherwise both shifts stay
      // "assigned" for the same site/date/shift-type, which can trigger false attendance
      // exceptions on the absent guard's stale shift and double-counts payroll cost.
      //
      // Resolved entirely up front (not interleaved with the persistence loop below)
      // because `desired` interleaves leave and replacement items in guard-array order,
      // not role order, so a "leave" item and the "replacement" item that should claim its
      // shift can appear in either order.
      const leaveCoveredShiftPool = new Map<string, { generatedKey: string; shift: (typeof shifts)[number] }[]>();
      for (const item of desired) {
        if (item.source !== "leave") continue;
        const key = `${item.guardId}:${dateKey(item.date)}`;
        const linkedShift = generatedByKey.get(key)?.publishedShift;
        if (!linkedShift) continue;
        const slot = `${dateKey(item.date)}:${linkedShift.shiftType}`;
        const bucket = leaveCoveredShiftPool.get(slot) ?? [];
        bucket.push({ generatedKey: key, shift: linkedShift });
        leaveCoveredShiftPool.set(slot, bucket);
      }
      const consumedLeaveGeneratedKeys = new Set<string>();
      const reassignmentByReplacementKey = new Map<string, { generatedKey: string; shift: (typeof shifts)[number] }>();
      for (const item of desired) {
        if (item.source !== "replacement" || !WORKING_CODES.has(item.code)) continue;
        const key = `${item.guardId}:${dateKey(item.date)}`;
        if (generatedByKey.get(key)?.publishedShift) continue; // already has its own shift
        const shiftType = item.code === "N" ? "night" : "day";
        const slot = `${dateKey(item.date)}:${shiftType}`;
        const bucket = leaveCoveredShiftPool.get(slot);
        const candidate = bucket?.find((entry) => !consumedLeaveGeneratedKeys.has(entry.generatedKey));
        if (!candidate) continue;
        consumedLeaveGeneratedKeys.add(candidate.generatedKey);
        reassignmentByReplacementKey.set(key, candidate);
      }

      for (const item of desired) {
        const key = `${item.guardId}:${dateKey(item.date)}`;
        const existingGenerated = generatedByKey.get(key);
        const shiftType = item.code === "N" ? "night" : "day";
        const isWorking = WORKING_CODES.has(item.code);
        const { shiftStart, shiftEnd } = getShiftTimes(item.date, shiftType, timeZone);
        const linkedShift = existingGenerated?.publishedShift ?? null;

        let generatedRow = existingGenerated;
        if (!generatedRow) {
          generatedRow = await tx.siteRosterGeneratedShift.create({
            data: {
              companyId,
              siteId,
              guardId: item.guardId,
              rosterDate: item.date,
              shiftCode: item.code,
              shiftType: shiftCodeToType(item.code),
              source: item.source,
              rosterPatternId: pattern.id,
            },
            include: { publishedShift: true },
          });
          generatedByKey.set(key, generatedRow);
          generated += 1;
        } else if (
          generatedRow.shiftCode !== item.code ||
          generatedRow.source !== item.source ||
          generatedRow.rosterPatternId !== pattern.id
        ) {
          generatedRow = await tx.siteRosterGeneratedShift.update({
            where: { id: generatedRow.id },
            data: {
              shiftCode: item.code,
              shiftType: shiftCodeToType(item.code),
              source: item.source,
              rosterPatternId: pattern.id,
            },
            include: { publishedShift: true },
          });
          generatedByKey.set(key, generatedRow);
          updated += 1;
        }

        if (!isWorking) {
          if (item.source === "leave" && linkedShift && consumedLeaveGeneratedKeys.has(key)) {
            // A confirmed replacement already took over this shift below — detach it from
            // the absent guard's own roster row so future runs don't treat it as still
            // theirs (and don't re-raise LEAVE_COVERAGE_REQUIRED for an already-covered day).
            await tx.siteRosterGeneratedShift.update({
              where: { id: generatedRow.id },
              data: { publishedShiftId: null },
            });
          } else if (item.source === "leave" && linkedShift) {
            // Keep the original duty as the coverage requirement. The approved
            // leave occurrence marks the guard unavailable; vacancy detection
            // and reliever assignment can now reference the unchanged shift.
            issues.push({
              code: "LEAVE_COVERAGE_REQUIRED",
              guardId: item.guardId,
              dateKey: dateKey(item.date),
              shiftType: linkedShift.shiftType === "night" ? "night" : "day",
              message: `Approved leave requires cover for the preserved shift on ${dateKey(item.date)}.`,
            });
          } else if (linkedShift && ["created", "assigned"].includes(linkedShift.status) && linkedShift.startTime > freezeBoundary) {
            await tx.shift.delete({ where: { id: linkedShift.id } });
            removed += 1;
          } else if (linkedShift && !["created", "assigned"].includes(linkedShift.status)) {
            issues.push({
              code: "PROTECTED_SHIFT",
              guardId: item.guardId,
              dateKey: dateKey(item.date),
              message: `A protected shift could not be changed on ${dateKey(item.date)}.`,
            });
          } else if (linkedShift && linkedShift.startTime <= freezeBoundary) {
            issues.push({
              code: "CHANGE_FROZEN",
              guardId: item.guardId,
              dateKey: dateKey(item.date),
              message: `A shift within the ${FREEZE_HOURS}-hour safety window needs authorized review.`,
            });
          }
          continue;
        }

        if (linkedShift) {
          if (["created", "assigned"].includes(linkedShift.status) && linkedShift.startTime > freezeBoundary) {
            await tx.shift.update({
              where: { id: linkedShift.id },
              data: {
                employeeId: item.guardId,
                shiftType,
                startTime: shiftStart,
                endTime: shiftEnd,
                legacyPostName: "Continuous roster",
              },
            });
            updated += 1;
          }
          continue;
        }

        const reassignment = reassignmentByReplacementKey.get(key);
        if (reassignment) {
          await tx.shift.update({
            where: { id: reassignment.shift.id },
            data: {
              employeeId: item.guardId,
              shiftType,
              startTime: shiftStart,
              endTime: shiftEnd,
              legacyPostName: "Continuous roster",
            },
          });
          await tx.siteRosterGeneratedShift.update({
            where: { id: generatedRow.id },
            data: { publishedShiftId: reassignment.shift.id },
          });
          updated += 1;
          continue;
        }

        const conflict = shifts.some(
          (shift) =>
            shift.employeeId === item.guardId &&
            overlaps(shiftStart, shiftEnd, shift.startTime, shift.endTime)
        );
        if (conflict) {
          issues.push({
            code: "SHIFT_CONFLICT",
            guardId: item.guardId,
            dateKey: dateKey(item.date),
            shiftType,
            message: `The patterned guard already has an overlapping shift on ${dateKey(item.date)}.`,
          });
          continue;
        }

        const createdShift = await tx.shift.create({
          data: {
            companyId,
            siteId,
            employeeId: item.guardId,
            shiftType,
            legacyPostName: "Continuous roster",
            startTime: shiftStart,
            endTime: shiftEnd,
            status: "assigned",
          },
        });
        await tx.siteRosterGeneratedShift.update({
          where: { id: generatedRow.id },
          data: { publishedShiftId: createdShift.id },
        });
        shifts.push(createdShift);
        published += 1;
      }

      const desiredKeys = new Set(desired.map((item) => `${item.guardId}:${dateKey(item.date)}`));
      for (const stale of generatedRows) {
        const key = `${stale.guardId}:${dateKey(stale.rosterDate)}`;
        if (desiredKeys.has(key) || !["pattern", "leave"].includes(stale.source)) continue;
        const linked = stale.publishedShift;
        if (linked && ["created", "assigned"].includes(linked.status) && linked.startTime > freezeBoundary) {
          await tx.shift.delete({ where: { id: linked.id } });
          await tx.siteRosterGeneratedShift.delete({ where: { id: stale.id } });
          removed += 1;
        } else if (!linked) {
          await tx.siteRosterGeneratedShift.delete({ where: { id: stale.id } });
          removed += 1;
        } else {
          issues.push({
            code: linked.startTime <= freezeBoundary ? "CHANGE_FROZEN" : "PROTECTED_SHIFT",
            guardId: stale.guardId,
            dateKey: dateKey(stale.rosterDate),
            message: `An existing shift on ${dateKey(stale.rosterDate)} needs authorized review before it can be changed.`,
          });
        }
      }

      const coverage = desiredCoverage(
        desired.map((item) => ({ date: item.date, code: item.code })),
        site.rosterDayShiftGuardsRequired,
        site.rosterNightShiftGuardsRequired
      );
      const openCoverageKeys = new Set<string>();
      for (let day = start; day <= end; day = addDays(day, 1)) {
        const dayKey = dateKey(day);
        const counts = coverage.result.get(dayKey) ?? { day: 0, night: 0 };
        for (const shiftType of ["day", "night"] as const) {
          const required = shiftType === "day" ? coverage.requiredDay : coverage.requiredNight;
          const have = counts[shiftType];
          if (have >= required) continue;
          const dedupeKey = `roster_coverage:${siteId}:${dayKey}:${shiftType}`;
          openCoverageKeys.add(dedupeKey);
          issues.push({
            code: "COVERAGE_GAP",
            dateKey: dayKey,
            shiftType,
            message: `${dayKey}: ${shiftType} shift has ${have} of ${required} required guards.`,
          });
          await tx.operationalAlert.upsert({
            where: { companyId_dedupeKey: { companyId, dedupeKey } },
            create: {
              companyId,
              siteId,
              sourceModule: "ROSTERING",
              priority: addDays(day, 0).getTime() <= freezeBoundary.getTime() ? "CRITICAL" : "MEDIUM",
              status: "OPEN",
              title: "Roster coverage needs attention",
              message: `${site.name}: ${shiftType} shift on ${dayKey} has ${have} of ${required} required guards.`,
              dedupeKey,
              sourceId: pattern.id,
              metadata: { dateKey: dayKey, shiftType, have, required, patternId: pattern.id },
            },
            update: {
              status: "OPEN",
              resolvedAt: null,
              resolvedById: null,
              message: `${site.name}: ${shiftType} shift on ${dayKey} has ${have} of ${required} required guards.`,
              metadata: { dateKey: dayKey, shiftType, have, required, patternId: pattern.id },
            },
          });
        }
      }

      const existingCoverageAlerts = await tx.operationalAlert.findMany({
        where: {
          companyId,
          siteId,
          sourceModule: "ROSTERING",
          dedupeKey: { startsWith: `roster_coverage:${siteId}:` },
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
        },
        select: { id: true, dedupeKey: true },
      });
      const resolvedIds = existingCoverageAlerts
        .filter((alert) => alert.dedupeKey && !openCoverageKeys.has(alert.dedupeKey))
        .map((alert) => alert.id);
      if (resolvedIds.length > 0) {
        await tx.operationalAlert.updateMany({
          where: { id: { in: resolvedIds } },
          data: { status: "RESOLVED", resolvedAt: now, resolvedById: options.userId },
        });
      }

      const openIssueKeys = new Set<string>();
      for (const issue of issues) {
        if (issue.code === "COVERAGE_GAP") continue;
        const dedupeKey = [
          "roster_issue",
          siteId,
          issue.code,
          issue.dateKey ?? "general",
          issue.guardId ?? "none",
          issue.shiftType ?? "none",
        ].join(":");
        openIssueKeys.add(dedupeKey);
        const isInsideFreeze = issue.dateKey
          ? addDays(issue.dateKey, 0).getTime() <= freezeBoundary.getTime()
          : false;
        await tx.operationalAlert.upsert({
          where: { companyId_dedupeKey: { companyId, dedupeKey } },
          create: {
            companyId,
            siteId,
            employeeId: issue.guardId,
            sourceModule: "ROSTERING",
            priority: isInsideFreeze ? "CRITICAL" : "MEDIUM",
            status: "OPEN",
            title: "Roster interruption needs attention",
            message: issue.message,
            dedupeKey,
            sourceId: pattern.id,
            metadata: {
              code: issue.code,
              dateKey: issue.dateKey,
              shiftType: issue.shiftType,
              guardId: issue.guardId,
              patternId: pattern.id,
            },
          },
          update: {
            employeeId: issue.guardId,
            priority: isInsideFreeze ? "CRITICAL" : "MEDIUM",
            status: "OPEN",
            resolvedAt: null,
            resolvedById: null,
            message: issue.message,
            metadata: {
              code: issue.code,
              dateKey: issue.dateKey,
              shiftType: issue.shiftType,
              guardId: issue.guardId,
              patternId: pattern.id,
            },
          },
        });
      }

      const existingIssueAlerts = await tx.operationalAlert.findMany({
        where: {
          companyId,
          siteId,
          sourceModule: "ROSTERING",
          dedupeKey: { startsWith: `roster_issue:${siteId}:` },
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
        },
        select: { id: true, dedupeKey: true },
      });
      const resolvedIssueIds = existingIssueAlerts
        .filter((alert) => alert.dedupeKey && !openIssueKeys.has(alert.dedupeKey))
        .map((alert) => alert.id);
      if (resolvedIssueIds.length > 0) {
        await tx.operationalAlert.updateMany({
          where: { id: { in: resolvedIssueIds } },
          data: { status: "RESOLVED", resolvedAt: now, resolvedById: options.userId },
        });
      }

      const historicalOverrides = await tx.siteRosterManualOverride.findMany({
        where: {
          companyId,
          siteId,
          rosterDate: { gte: pattern.effectiveFrom, lte: startOfUtcDay(now) },
          doesChangeBasePattern: false,
        },
      });
      const deviationPeriods = new Map<
        string,
        { guardId: string; patternDayIndex: number; shiftCode: SiteRosterShiftCode; periods: Set<string> }
      >();
      for (const override of historicalOverrides) {
        if (override.reason?.startsWith("[replacement:")) continue;
        const patternDayIndex = patternDayForDate(
          pattern.anchorDate,
          pattern.cycleLengthDays,
          override.rosterDate
        );
        const baseCode = cellsByGuardDay.get(`${override.guardId}:${patternDayIndex}`)?.shiftCode;
        if (!baseCode || baseCode === override.overrideShiftCode) continue;
        const key = `${override.guardId}:${patternDayIndex}:${override.overrideShiftCode}`;
        const group = deviationPeriods.get(key) ?? {
          guardId: override.guardId,
          patternDayIndex,
          shiftCode: override.overrideShiftCode,
          periods: new Set<string>(),
        };
        group.periods.add(
          getCurrentRosterPeriod(window.settings, window.calendar.id, override.rosterDate).periodKey
        );
        deviationPeriods.set(key, group);
      }
      for (const deviation of deviationPeriods.values()) {
        if (deviation.periods.size < 2) continue;
        const dedupeKey = `roster_pattern_change:${siteId}:${deviation.guardId}:${deviation.patternDayIndex}:${deviation.shiftCode}`;
        await tx.operationalAlert.upsert({
          where: { companyId_dedupeKey: { companyId, dedupeKey } },
          create: {
            companyId,
            siteId,
            employeeId: deviation.guardId,
            sourceModule: "ROSTERING",
            priority: "LOW",
            status: "OPEN",
            title: "The normal roster may have changed",
            message: `The same one-day change was made in ${deviation.periods.size} roster periods. Review whether it should become part of the ongoing schedule.`,
            dedupeKey,
            sourceId: pattern.id,
            metadata: {
              guardId: deviation.guardId,
              patternDayIndex: deviation.patternDayIndex,
              shiftCode: deviation.shiftCode,
              periods: [...deviation.periods],
            },
          },
          update: {
            status: "OPEN",
            resolvedAt: null,
            message: `The same one-day change was made in ${deviation.periods.size} roster periods. Review whether it should become part of the ongoing schedule.`,
          },
        });
      }

      const state = issues.length > 0 ? "needs_attention" : "running";
      await tx.site.update({
        where: { id: siteId },
        data: {
          rosterContinuityState: state,
          rosterMaintainedThrough: end,
          rosterLastReconciledAt: now,
          rosterLastReconciliationStatus: issues.length > 0 ? "completed_with_issues" : "completed",
        },
      });
      await tx.rosterAutomationRun.create({
        data: {
          companyId,
          siteId,
          periodStart: start,
          periodEnd: end,
          status: issues.length > 0 ? "pending_review" : "applied",
          warnings: issues as unknown as Prisma.InputJsonValue,
          appliedAt: new Date(),
        },
      });

      return {
        siteId,
        state,
        maintainedThrough: dateKey(end),
        generated,
        published,
        updated,
        removed,
        issues,
      };
    },
    { maxWait: 15_000, timeout: 120_000 }
  );
}

export async function reconcileContinuousRosters(): Promise<ReconcileContinuityResult[]> {
  const sites = await prisma.site.findMany({
    where: { rosterContinuityState: { in: ["running", "needs_attention"] } },
    select: { id: true, companyId: true },
  });
  const results: ReconcileContinuityResult[] = [];
  for (const site of sites) {
    try {
      results.push(
        await reconcileRosterContinuityForSite(site.companyId, site.id, { trigger: "cron" })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Continuity reconciliation failed";
      await prisma.site.update({
        where: { id: site.id },
        data: {
          rosterContinuityState: "needs_attention",
          rosterLastReconciledAt: new Date(),
          rosterLastReconciliationStatus: "failed",
        },
      });
      await prisma.operationalAlert.upsert({
        where: {
          companyId_dedupeKey: {
            companyId: site.companyId,
            dedupeKey: `roster_reconcile_failed:${site.id}`,
          },
        },
        create: {
          companyId: site.companyId,
          siteId: site.id,
          sourceModule: "ROSTERING",
          priority: "CRITICAL",
          status: "OPEN",
          title: "Automatic roster update failed",
          message,
          dedupeKey: `roster_reconcile_failed:${site.id}`,
        },
        update: { status: "OPEN", resolvedAt: null, message },
      });
      results.push({
        siteId: site.id,
        state: "needs_attention",
        maintainedThrough: null,
        generated: 0,
        published: 0,
        updated: 0,
        removed: 0,
        issues: [{ code: "RECONCILIATION_FAILED", message }],
      });
    }
  }
  return results;
}

export async function reconcileContinuityForEmployee(
  employeeId: string,
  companyId?: string,
  trigger = "employee_availability_changed"
): Promise<void> {
  const assignments = await prisma.siteAssignment.findMany({
    where: {
      employeeId,
      site: {
        ...(companyId ? { companyId } : {}),
        rosterContinuityState: { in: ["running", "needs_attention"] },
      },
    },
    select: { siteId: true, site: { select: { companyId: true } } },
  });
  for (const assignment of assignments) {
    await reconcileRosterContinuityForSite(assignment.site.companyId, assignment.siteId, { trigger });
  }
}

function issueMetadata(value: unknown): { dateKey?: string; shiftType?: "day" | "night" } {
  if (!value || typeof value !== "object") return {};
  const metadata = value as Record<string, unknown>;
  return {
    dateKey: typeof metadata.dateKey === "string" ? metadata.dateKey : undefined,
    shiftType:
      metadata.shiftType === "day" || metadata.shiftType === "night"
        ? metadata.shiftType
        : undefined,
  };
}

const ALERT_PRIORITY_RANK = { CRITICAL: 0, MEDIUM: 1, LOW: 2 } as const;
const CONTINUITY_STATE_RANK = {
  needs_attention: 0,
  paused: 1,
  not_setup: 2,
  running: 3,
} as const;

export async function getContinuityOverview(companyId: string, user: AuthenticatedUser) {
  const [company, sites] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } }),
    prisma.site.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        rosterPeriodCalendarId: true,
        rosterContinuityState: true,
        rosterMaintainedThrough: true,
        rosterLastReconciledAt: true,
        rosterLastReconciliationStatus: true,
        _count: { select: { assignedGuards: { where: { isActive: true } } } },
        siteRosterPatterns: {
          where: { status: "active" },
          select: { name: true },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
        },
        operationalAlerts: {
          where: { sourceModule: "ROSTERING", status: { in: ["OPEN", "ACKNOWLEDGED"] } },
          select: {
            id: true,
            title: true,
            message: true,
            priority: true,
            metadata: true,
            createdAt: true,
          },
          take: 50,
        },
      },
    }),
  ]);
  const settings = parsePayrollCalendarSettings(company?.settings);
  const rows = sites.map((site) => {
    const alerts = [...site.operationalAlerts].sort((a, b) => {
      const priority = ALERT_PRIORITY_RANK[a.priority] - ALERT_PRIORITY_RANK[b.priority];
      if (priority !== 0) return priority;
      const aDate = issueMetadata(a.metadata).dateKey ?? "9999-12-31";
      const bDate = issueMetadata(b.metadata).dateKey ?? "9999-12-31";
      return aDate.localeCompare(bDate) || b.createdAt.getTime() - a.createdAt.getTime();
    });
    const next = alerts[0];
    const metadata = next ? issueMetadata(next.metadata) : {};
    const calendar = getRosterPeriodCalendar(settings, site.rosterPeriodCalendarId);
    return {
      siteId: site.id,
      siteName: site.name,
      state: site.rosterContinuityState,
      maintainedThrough: site.rosterMaintainedThrough ? dateKey(site.rosterMaintainedThrough) : null,
      lastReconciledAt: site.rosterLastReconciledAt?.toISOString() ?? null,
      lastStatus: site.rosterLastReconciliationStatus,
      guardCount: site._count.assignedGuards,
      issueCount: alerts.length,
      criticalIssueCount: alerts.filter((alert) => alert.priority === "CRITICAL").length,
      activePatternName: site.siteRosterPatterns[0]?.name ?? null,
      calendar: {
        id: calendar.id,
        name: calendar.name,
        startDay: calendar.startDay,
        endDay: calendar.endDay,
      },
      nextIssue: next
        ? {
            id: next.id,
            title: next.title,
            message: next.message,
            priority: next.priority,
            dateKey: metadata.dateKey ?? null,
            shiftType: metadata.shiftType ?? null,
          }
        : null,
    };
  });
  rows.sort((a, b) => {
    const state = CONTINUITY_STATE_RANK[a.state] - CONTINUITY_STATE_RANK[b.state];
    if (state !== 0) return state;
    if (a.criticalIssueCount !== b.criticalIssueCount) return b.criticalIssueCount - a.criticalIssueCount;
    const aDate = a.nextIssue?.dateKey ?? "9999-12-31";
    const bDate = b.nextIssue?.dateKey ?? "9999-12-31";
    return aDate.localeCompare(bDate) || a.siteName.localeCompare(b.siteName);
  });
  return {
    summary: {
      total: rows.length,
      running: rows.filter((site) => site.state === "running").length,
      needsAttention: rows.filter((site) => site.state === "needs_attention").length,
      paused: rows.filter((site) => site.state === "paused").length,
      notSetup: rows.filter((site) => site.state === "not_setup").length,
    },
    permissions: rosterActionPermissions(user),
    sites: rows,
  };
}

export async function getContinuityStatus(companyId: string, siteId: string, user: AuthenticatedUser) {
  const site = await prisma.site.findFirst({
    where: { id: siteId, companyId },
    select: {
      id: true,
      name: true,
      rosterPeriodCalendarId: true,
      rosterContinuityState: true,
      rosterMaintainedThrough: true,
      rosterLastReconciledAt: true,
      rosterLastReconciliationStatus: true,
      rosterContinuityPauseReason: true,
      company: { select: { settings: true } },
      _count: { select: { assignedGuards: { where: { isActive: true } } } },
      siteRosterPatterns: {
        where: { status: "active" },
        select: { id: true, name: true, cycleLengthDays: true, effectiveFrom: true },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
      },
    },
  });
  if (!site) return null;
  const settings = parsePayrollCalendarSettings(site.company.settings);
  const calendar = getRosterPeriodCalendar(settings, site.rosterPeriodCalendarId);
  const issues = await prisma.operationalAlert.findMany({
    where: {
      companyId,
      siteId,
      sourceModule: "ROSTERING",
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
    select: { id: true, title: true, message: true, priority: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  issues.sort((a, b) => {
    const priority = ALERT_PRIORITY_RANK[a.priority] - ALERT_PRIORITY_RANK[b.priority];
    if (priority !== 0) return priority;
    const aDate = issueMetadata(a.metadata).dateKey ?? "9999-12-31";
    const bDate = issueMetadata(b.metadata).dateKey ?? "9999-12-31";
    return aDate.localeCompare(bDate) || b.createdAt.getTime() - a.createdAt.getTime();
  });
  const activePattern = site.siteRosterPatterns[0];
  return {
    siteId: site.id,
    siteName: site.name,
    state: site.rosterContinuityState,
    calendarId: site.rosterPeriodCalendarId,
    calendar: {
      id: calendar.id,
      name: calendar.name,
      startDay: calendar.startDay,
      endDay: calendar.endDay,
    },
    guardCount: site._count.assignedGuards,
    permissions: rosterActionPermissions(user),
    maintainedThrough: site.rosterMaintainedThrough ? dateKey(site.rosterMaintainedThrough) : null,
    lastReconciledAt: site.rosterLastReconciledAt?.toISOString() ?? null,
    lastStatus: site.rosterLastReconciliationStatus,
    pauseReason: site.rosterContinuityPauseReason,
    activePattern: activePattern
      ? {
          ...activePattern,
          effectiveFrom: dateKey(activePattern.effectiveFrom),
        }
      : null,
    issues,
  };
}

export async function setContinuityPaused(
  companyId: string,
  siteId: string,
  paused: boolean,
  reason?: string
) {
  const site = await prisma.site.findFirst({ where: { id: siteId, companyId } });
  if (!site) return null;
  return prisma.site.update({
    where: { id: siteId },
    data: {
      rosterContinuityState: paused ? "paused" : "running",
      rosterContinuityPauseReason: paused ? reason?.trim() || "Paused by manager" : null,
    },
  });
}

type ReplacementSuggestion = {
  employeeId: string;
  name: string;
  score: number;
  reasons: string[];
};

function alertMetadata(value: unknown): { dateKey?: string; shiftType?: "day" | "night" } {
  if (!value || typeof value !== "object") return {};
  const metadata = value as Record<string, unknown>;
  return {
    dateKey: typeof metadata.dateKey === "string" ? metadata.dateKey : undefined,
    shiftType:
      metadata.shiftType === "day" || metadata.shiftType === "night"
        ? metadata.shiftType
        : undefined,
  };
}

export async function getReplacementSuggestions(
  companyId: string,
  alertId: string
): Promise<{ alertId: string; dateKey: string; shiftType: "day" | "night"; suggestions: ReplacementSuggestion[] } | null> {
  const alert = await prisma.operationalAlert.findFirst({
    where: { id: alertId, companyId, sourceModule: "ROSTERING", status: { in: ["OPEN", "ACKNOWLEDGED"] } },
  });
  if (!alert?.siteId) return null;
  const metadata = alertMetadata(alert.metadata);
  if (!metadata.dateKey || !metadata.shiftType) return null;

  const workDate = dateOnly(metadata.dateKey);
  const rangeStart = addDays(workDate, -90);
  const rangeEnd = addDays(workDate, 15);
  const site = await prisma.site.findFirst({
    where: { id: alert.siteId, companyId },
    include: {
      assignedGuards: {
        include: { employee: true },
      },
    },
  });
  if (!site) return null;
  const candidateAssignments = site.assignedGuards.filter(
    (assignment) =>
      isEffectiveAssignment(assignment, workDate) &&
      ROSTERABLE_STATUSES.has(assignment.employee.status) &&
      (assignment.employee.employeeType ?? "security") === "security"
  );
  const employeeIds = candidateAssignments.map((assignment) => assignment.employeeId);
  const [leaves, leaveApplications, shifts, attendance] = await Promise.all([
    prisma.leaveRecord.findMany({
      where: { employeeId: { in: employeeIds }, date: workDate },
      select: { employeeId: true },
    }),
    prisma.leaveApplication.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        startDate: { lte: workDate },
        endDate: { gte: workDate },
        status: { in: ["APPROVED", "CANCELLATION_REQUESTED", "PAYROLL_PROCESSED", "ADJUSTMENT_REQUIRED", "IMPORTED_APPROVED"] },
      },
      select: { employeeId: true },
    }),
    prisma.shift.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        startTime: { lt: rangeEnd },
        endTime: { gt: rangeStart },
      },
      select: { employeeId: true, siteId: true, shiftType: true, startTime: true, endTime: true },
    }),
    prisma.attendance.findMany({
      where: {
        shift: { companyId, employeeId: { in: employeeIds }, startTime: { gte: rangeStart, lt: workDate } },
      },
      select: { clockIn: true, shift: { select: { employeeId: true } } },
    }),
  ]);
  const leaveIds = new Set([...leaves, ...leaveApplications].map((row) => row.employeeId));
  const timeZone = await getCompanyTimezone(companyId);
  const { shiftStart, shiftEnd } = getShiftTimes(workDate, metadata.shiftType, timeZone);

  const suggestions: ReplacementSuggestion[] = [];
  for (const assignment of candidateAssignments) {
    const employee = assignment.employee;
    if (leaveIds.has(employee.id)) continue;
    const employeeShifts = shifts.filter((shift) => shift.employeeId === employee.id);
    if (employeeShifts.some((shift) => overlaps(shiftStart, shiftEnd, shift.startTime, shift.endTime))) continue;
    if (!meetsSiteShiftGenderRule(employee.gender, site, metadata.shiftType)) continue;
    const typeByDate = new Map(
      employeeShifts.map((shift) => [
        dateKey(shift.startTime),
        shift.shiftType?.toLowerCase() === "night" ? ("night" as const) : ("day" as const),
      ])
    );
    const previousDateKey = dateKey(addDays(workDate, -1));
    const nextDateKey = dateKey(addDays(workDate, 1));
    if (metadata.shiftType === "day" && typeByDate.get(previousDateKey) === "night") continue;
    if (metadata.shiftType === "night" && typeByDate.get(nextDateKey) === "day") continue;
    let consecutiveDays = 0;
    for (let offset = 1; offset <= 6; offset += 1) {
      if (!typeByDate.has(dateKey(addDays(workDate, -offset)))) break;
      consecutiveDays += 1;
    }
    if (consecutiveDays >= 6) continue;

    let score = assignment.priority * 2;
    const reasons: string[] = [];
    if (assignment.assignmentType === "RELIEVER" || employee.status === "reliever") {
      score += 25;
      reasons.push("designated reliever");
    } else {
      score += 10;
      reasons.push("assigned to this site");
    }
    const familiar = employeeShifts.filter((shift) => shift.siteId === site.id).length;
    if (familiar > 0) {
      score += Math.min(20, familiar);
      reasons.push(`${familiar} recent site shift${familiar === 1 ? "" : "s"}`);
    }
    const matchingType = employeeShifts.filter((shift) => shift.shiftType === metadata.shiftType).length;
    if (matchingType > 0) {
      score += Math.min(15, matchingType);
      reasons.push(`${metadata.shiftType}-shift experience`);
    }
    const futureWorkload = employeeShifts.filter((shift) => shift.startTime >= workDate).length;
    score -= futureWorkload * 3;
    if (futureWorkload <= 2) reasons.push("lower upcoming workload");

    const attendanceRows = attendance.filter((row) => row.shift.employeeId === employee.id);
    if (attendanceRows.length > 0) {
      const attended = attendanceRows.filter((row) => row.clockIn).length;
      const reliability = attended / attendanceRows.length;
      score += Math.round(reliability * 15);
      reasons.push(`${Math.round(reliability * 100)}% recorded attendance reliability`);
    } else {
      reasons.push("no reliability history yet (neutral)");
    }
    suggestions.push({
      employeeId: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      score,
      reasons,
    });
  }

  suggestions.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { alertId, dateKey: metadata.dateKey, shiftType: metadata.shiftType, suggestions };
}

export async function confirmReplacement(
  companyId: string,
  userId: string,
  alertId: string,
  employeeId: string
) {
  const available = await getReplacementSuggestions(companyId, alertId);
  const selected = available?.suggestions.find((suggestion) => suggestion.employeeId === employeeId);
  if (!available || !selected) return null;
  const alert = await prisma.operationalAlert.findFirst({ where: { id: alertId, companyId } });
  if (!alert?.siteId) return null;
  const rosterDate = dateOnly(available.dateKey);
  const code: SiteRosterShiftCode = available.shiftType === "night" ? "N" : "D";

  await prisma.$transaction(async (tx) => {
    const existing = await tx.siteRosterGeneratedShift.findUnique({
      where: {
        siteId_guardId_rosterDate: { siteId: alert.siteId!, guardId: employeeId, rosterDate },
      },
    });
    await tx.siteRosterManualOverride.upsert({
      where: {
        siteId_guardId_rosterDate: { siteId: alert.siteId!, guardId: employeeId, rosterDate },
      },
      create: {
        companyId,
        siteId: alert.siteId!,
        guardId: employeeId,
        rosterDate,
        originalShiftCode: existing?.shiftCode ?? null,
        overrideShiftCode: code,
        overrideShiftType: shiftCodeToType(code),
        reason: `[replacement:${alertId}] ${selected.reasons.join(", ")}`,
        createdBy: userId,
      },
      update: {
        overrideShiftCode: code,
        overrideShiftType: shiftCodeToType(code),
        reason: `[replacement:${alertId}] ${selected.reasons.join(", ")}`,
        createdBy: userId,
      },
    });
  });
  const reconciliation = await reconcileRosterContinuityForSite(companyId, alert.siteId, {
    userId,
    trigger: "replacement_confirmed",
  });
  return { replacement: selected, reconciliation };
}
