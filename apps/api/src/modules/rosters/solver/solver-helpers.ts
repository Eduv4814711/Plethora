import {
  addDaysToDateKey,
  DEFAULT_LABOUR_COMPLIANCE_SETTINGS,
  getIsoWeekStartKey,
  getSastDayOfWeek,
  hasMinimumPsiraGrade,
  SA_NBCPSS_RULES,
  type EffectiveHolidayEntry,
} from "../../../lib/sa-labour-rules.config.js";
import {
  classifyEmployeePeriodShifts,
  type ShiftClassificationInput,
} from "../../../services/sa-hours-classifier.service.js";
import type {
  SmartRosterDaySpec,
  SmartRosterGuardComplianceSummary,
  SmartRosterGuardInput,
  SmartRosterPostInput,
  SmartRosterShiftAssignment,
  SmartRosterSolveRequest,
  SmartRosterSolveResult,
  SmartRosterUnfilledSlot,
} from "./solver.types.js";

export interface SlotRequirement {
  slotIndex: number;
  dayIndex: number;
  dateKey: string;
  isoWeekStartKey: string;
  postId: string | null;
  postName: string;
  shiftType: "day" | "night";
  requiredCount: number;
  post: SmartRosterPostInput;
  day: SmartRosterDaySpec;
}

export interface GuardEligibilityEvaluation {
  eligible: boolean;
  hardReason?: string;
  softPenalty: number;
  warnings: string[];
}

export function normalizeGenderCode(gender: string | null | undefined): "M" | "F" | null {
  if (!gender) return null;
  const g = gender.trim().toUpperCase();
  if (g === "M" || g === "MALE") return "M";
  if (g === "F" || g === "FEMALE") return "F";
  return null;
}

export function buildShiftUtcBounds(
  dateKey: string,
  shiftType: "day" | "night",
  request: Pick<
    SmartRosterSolveRequest,
    "dayStartTime" | "dayEndTime" | "nightStartTime" | "nightEndTime" | "shiftDurationHours"
  >,
): { startTime: Date; endTime: Date; durationHours: number } {
  const startStr = shiftType === "night" ? request.nightStartTime : request.dayStartTime;
  const endStr = shiftType === "night" ? request.nightEndTime : request.dayEndTime;
  const [sh, sm] = startStr.split(":").map(Number);
  const [eh, em] = endStr.split(":").map(Number);
  const startTime = new Date(
    `${dateKey}T${String(sh || 0).padStart(2, "0")}:${String(sm || 0).padStart(2, "0")}:00+02:00`,
  );
  const crossesMidnight = (eh * 60 + em) <= (sh * 60 + sm);
  const endDateKey = crossesMidnight ? addDaysToDateKey(dateKey, 1) : dateKey;
  const endTime = new Date(
    `${endDateKey}T${String(eh || 0).padStart(2, "0")}:${String(em || 0).padStart(2, "0")}:00+02:00`,
  );
  const rawHours = (endTime.getTime() - startTime.getTime()) / 3_600_000;
  const durationHours = rawHours > 0 ? Math.round(rawHours * 100) / 100 : request.shiftDurationHours;
  return { startTime, endTime, durationHours };
}

export function expandSlotRequirements(request: SmartRosterSolveRequest): SlotRequirement[] {
  const slots: SlotRequirement[] = [];
  let idx = 0;
  for (let d = 0; d < request.days.length; d++) {
    const day = request.days[d]!;
    for (const post of request.posts) {
      if (post.dayRequired > 0 && post.dayAllowedDays.includes(day.dayOfWeek)) {
        slots.push({
          slotIndex: idx++,
          dayIndex: d,
          dateKey: day.dateKey,
          isoWeekStartKey: day.isoWeekStartKey,
          postId: post.id,
          postName: post.name,
          shiftType: "day",
          requiredCount: post.dayRequired,
          post,
          day,
        });
      }
      if (post.nightRequired > 0 && post.nightAllowedDays.includes(day.dayOfWeek)) {
        slots.push({
          slotIndex: idx++,
          dayIndex: d,
          dateKey: day.dateKey,
          isoWeekStartKey: day.isoWeekStartKey,
          postId: post.id,
          postName: post.name,
          shiftType: "night",
          requiredCount: post.nightRequired,
          post,
          day,
        });
      }
    }
  }
  return slots;
}

export function evaluateGuardSlotEligibility(
  guard: SmartRosterGuardInput,
  dayIndex: number,
  day: SmartRosterDaySpec,
  post: SmartRosterPostInput,
  shiftType: "day" | "night",
  request: SmartRosterSolveRequest,
): GuardEligibilityEvaluation {
  const warnings: string[] = [];
  let softPenalty = 0;

  if (guard.leaveDateKeys.includes(day.dateKey)) {
    return { eligible: false, hardReason: "Approved leave", softPenalty: 9999, warnings };
  }

  // Day-0 rest transition from previous cycle's last night shift -> cannot work day shift next morning
  if (dayIndex === 0 && shiftType === "day" && guard.priorDayLastShiftType === "night") {
    return {
      eligible: false,
      hardReason: "Needs 12h rest after previous night shift",
      softPenalty: 9999,
      warnings,
    };
  }

  // Cross-site overlap or <12h gap against shifts already rostered at OTHER sites
  const { startTime, endTime } = buildShiftUtcBounds(day.dateKey, shiftType, request);
  const checkDates = [
    addDaysToDateKey(day.dateKey, -1),
    day.dateKey,
    addDaysToDateKey(day.dateKey, 1),
  ];
  const minRestMs = SA_NBCPSS_RULES.minDailyRestHours * 3_600_000;
  for (const dk of checkDates) {
    const others = guard.otherSiteShiftsByDate[dk] ?? [];
    for (const o of others) {
      const oStart = new Date(o.startTimeIso).getTime();
      const oEnd = new Date(o.endTimeIso).getTime();
      if (oStart < endTime.getTime() && oEnd > startTime.getTime()) {
        return {
          eligible: false,
          hardReason: `Double-booked at ${o.siteName}`,
          softPenalty: 9999,
          warnings,
        };
      }
      const gapAfter = startTime.getTime() - oEnd;
      const gapBefore = oStart - endTime.getTime();
      if ((gapAfter >= 0 && gapAfter < minRestMs) || (gapBefore >= 0 && gapBefore < minRestMs)) {
        return {
          eligible: false,
          hardReason: `<12h rest around shift at ${o.siteName}`,
          softPenalty: 9999,
          warnings,
        };
      }
    }
  }

  // Gender rule on post
  if (post.requiredGender && post.requiredGender !== "any") {
    const gCode = normalizeGenderCode(guard.gender);
    if (gCode !== post.requiredGender) {
      return {
        eligible: false,
        hardReason: `Post requires ${post.requiredGender === "M" ? "Male" : "Female"} guard`,
        softPenalty: 9999,
        warnings,
      };
    }
  }

  // Firearm competency on armed post
  if (post.requiresFirearm) {
    const firearmExpired =
      guard.firearmCompetencyExpiry != null &&
      guard.firearmCompetencyExpiry.slice(0, 10) < day.dateKey;
    if (!guard.firearmCompetency || firearmExpired) {
      const msg = !guard.firearmCompetency
        ? "Missing firearm competency"
        : `Firearm competency expired (${guard.firearmCompetencyExpiry?.slice(0, 10)})`;
      if (request.psiraEnforcementMode !== "OFF") {
        return { eligible: false, hardReason: msg, softPenalty: 9999, warnings };
      }
      softPenalty += 200;
      warnings.push(msg);
    }
  }

  // PSIRA registration expiry & grade rule
  const psiraExpired =
    guard.psiraRegistrationExpiry != null &&
    guard.psiraRegistrationExpiry.slice(0, 10) < day.dateKey;
  if (psiraExpired) {
    const msg = `PSIRA expired (${guard.psiraRegistrationExpiry?.slice(0, 10)})`;
    if (request.psiraEnforcementMode === "BLOCK") {
      return { eligible: false, hardReason: msg, softPenalty: 9999, warnings };
    }
    if (request.psiraEnforcementMode === "WARN") {
      softPenalty += 180;
      warnings.push(msg);
    }
  }

  if (post.requiredPsiraGrade && !hasMinimumPsiraGrade(guard.psiraGrade, post.requiredPsiraGrade)) {
    const msg = `Requires PSIRA Grade ${post.requiredPsiraGrade} (guard is ${guard.psiraGrade ?? "ungraded"})`;
    if (request.psiraEnforcementMode === "BLOCK") {
      return { eligible: false, hardReason: msg, softPenalty: 9999, warnings };
    }
    if (request.psiraEnforcementMode === "WARN") {
      softPenalty += 150;
      warnings.push(msg);
    }
  }

  // Soft staffing & fairness preferences (kept well below OT penalty)
  if (!guard.isSitePrimary && !guard.isReliever) {
    softPenalty += 45;
  } else if (guard.isReliever && !guard.isSitePrimary) {
    softPenalty += 12;
  }

  if (guard.preferredShiftType !== "any" && guard.preferredShiftType !== shiftType) {
    softPenalty += 25;
  }

  if (guard.eligiblePostIds.length > 0 && post.id && !guard.eligiblePostIds.includes(post.id)) {
    softPenalty += 15;
  }

  return { eligible: true, softPenalty, warnings };
}

export function computeMaxWorkDaysIn7Window(request: SmartRosterSolveRequest): number {
  if (request.fortnightlyRestEnabled || request.frameworkId === "6on3off_mixed") {
    return 6;
  }
  // 5 working shifts x 12h + 2 rest days easily preserves >= 36h consecutive weekly rest
  return 5;
}

export function summarizeSolvedSchedule(params: {
  request: SmartRosterSolveRequest;
  slots: SlotRequirement[];
  assignments: SmartRosterShiftAssignment[];
  solverUsed: SmartRosterSolveResult["solverUsed"];
  solverStatus: SmartRosterSolveResult["solverStatus"];
  solveDurationMs: number;
  fallbackReason?: string;
}): SmartRosterSolveResult {
  const { request, slots, assignments } = params;
  const holidayEntries = new Map<string, EffectiveHolidayEntry>(
    Object.entries(request.holidaysMap).map(([dateKey, name]) => [
      dateKey,
      { dateKey, name, isObservedMonday: false },
    ]),
  );

  // Track filled count per slot
  const filledMap = new Map<string, number>();
  for (const a of assignments) {
    const key = `${a.dateKey}:${a.postId ?? "default"}:${a.shiftType}`;
    filledMap.set(key, (filledMap.get(key) ?? 0) + 1);
  }

  const unfilledSlots: SmartRosterUnfilledSlot[] = [];
  let totalRequiredSlots = 0;
  let totalFilledSlots = 0;

  for (const slot of slots) {
    totalRequiredSlots += slot.requiredCount;
    const key = `${slot.dateKey}:${slot.postId ?? "default"}:${slot.shiftType}`;
    const filledCount = Math.min(slot.requiredCount, filledMap.get(key) ?? 0);
    totalFilledSlots += filledCount;
    if (filledCount < slot.requiredCount) {
      const reasons = new Set<string>();
      for (const g of request.guards) {
        const evalRes = evaluateGuardSlotEligibility(g, slot.dayIndex, slot.day, slot.post, slot.shiftType, request);
        if (!evalRes.eligible && evalRes.hardReason) {
          reasons.add(evalRes.hardReason);
        }
      }
      if (reasons.size === 0) {
        reasons.add("Available guards reached weekly hours or rest limits");
      }
      unfilledSlots.push({
        dateKey: slot.dateKey,
        shiftType: slot.shiftType,
        postId: slot.postId,
        postName: slot.postName,
        requiredCount: slot.requiredCount,
        filledCount,
        shortfall: slot.requiredCount - filledCount,
        reasons: [...reasons].slice(0, 3),
      });
    }
  }

  const assignmentsByGuard = new Map<string, SmartRosterShiftAssignment[]>();
  for (const a of assignments) {
    if (!assignmentsByGuard.has(a.guardId)) assignmentsByGuard.set(a.guardId, []);
    assignmentsByGuard.get(a.guardId)!.push(a);
  }

  const guardSummaries: SmartRosterGuardComplianceSummary[] = [];
  let totalOvertimeHours = 0;
  let restViolationsCount = 0;
  let credentialWarningsCount = 0;

  for (const guard of request.guards) {
    const guardAssigns = assignmentsByGuard.get(guard.id) ?? [];
    if (guardAssigns.length === 0) continue;

    const shiftInputs: ShiftClassificationInput[] = [];
    // Add prior-week carryover context shifts across individual non-holiday days in the week
    // (never a single monolithic block on Monday, which could fall on a public holiday).
    for (const [weekKey, hours] of Object.entries(guard.priorWeekWorkedHoursByWeekKey)) {
      if (hours <= 0) continue;
      let remainingHours = hours;
      const candidateDays: string[] = [];
      for (const dk of guard.priorWorkDateKeys) {
        if (dk < request.periodStart && getIsoWeekStartKey(dk) === weekKey && !holidayEntries.has(dk)) {
          candidateDays.push(dk);
        }
      }
      for (let offset = 0; offset < 6; offset++) {
        const dk = addDaysToDateKey(weekKey, offset);
        if (dk >= request.periodStart) break;
        if (!holidayEntries.has(dk) && getSastDayOfWeek(dk) !== 0 && !candidateDays.includes(dk)) {
          candidateDays.push(dk);
        }
      }
      if (candidateDays.length === 0) {
        candidateDays.push(weekKey);
      }
      for (let dIdx = 0; dIdx < candidateDays.length && remainingHours > 0; dIdx++) {
        const dk = candidateDays[dIdx]!;
        const chunk = dIdx === candidateDays.length - 1 ? remainingHours : Math.min(12, remainingHours);
        const start = new Date(`${dk}T06:00:00+02:00`);
        const end = new Date(start.getTime() + chunk * 3_600_000);
        shiftInputs.push({
          id: `prior:${guard.id}:${weekKey}:${dk}`,
          employeeId: guard.id,
          siteId: request.siteId,
          startTime: start,
          endTime: end,
          isScheduledOnRoster: true,
          employeeCategory: guard.bceaCategory,
          isCarryoverContextOnly: true,
        });
        remainingHours -= chunk;
      }
    }

    // Add in-period cross-site shifts as carryover context so weekly ordinary buckets
    // and daily rest gaps reflect shifts already worked at other sites.
    for (const [dk, otherList] of Object.entries(guard.otherSiteShiftsByDate)) {
      if (dk < request.periodStart || dk > request.periodEnd) continue;
      for (let oIdx = 0; oIdx < otherList.length; oIdx++) {
        const o = otherList[oIdx]!;
        shiftInputs.push({
          id: `other:${guard.id}:${dk}:${o.siteId}:${oIdx}`,
          employeeId: guard.id,
          siteId: o.siteId,
          startTime: new Date(o.startTimeIso),
          endTime: new Date(o.endTimeIso),
          isScheduledOnRoster: true,
          employeeCategory: guard.bceaCategory,
          isCarryoverContextOnly: true,
        });
      }
    }

    let dayShifts = 0;
    let nightShifts = 0;
    const credWarnSet = new Set<string>();

    for (const a of guardAssigns) {
      if (a.shiftType === "night") nightShifts += 1;
      else dayShifts += 1;
      for (const w of a.warnings) credWarnSet.add(w);
      const { startTime, endTime } = buildShiftUtcBounds(a.dateKey, a.shiftType, request);
      shiftInputs.push({
        id: `plan:${guard.id}:${a.dateKey}:${a.shiftType}`,
        employeeId: guard.id,
        siteId: request.siteId,
        startTime,
        endTime,
        isScheduledOnRoster: true,
        mealIntervalPaid: request.mealIntervalPaid,
        mealIntervalMinutes: request.mealIntervalMinutes,
        employeeCategory: guard.bceaCategory,
        isCarryoverContextOnly: false,
      });
    }

    const period = classifyEmployeePeriodShifts({
      employeeId: guard.id,
      shifts: shiftInputs,
      holidays: holidayEntries,
      settings: {
        ...DEFAULT_LABOUR_COMPLIANCE_SETTINGS,
        averagingEnabled: request.averagingEnabled,
        averagingWeeks: request.averagingWeeks,
        fortnightlyRestEnabled: request.fortnightlyRestEnabled,
      },
      employeeCredentials: {
        psiraRegistrationExpiry: guard.psiraRegistrationExpiry
          ? new Date(guard.psiraRegistrationExpiry)
          : null,
        firearmCompetency: guard.firearmCompetency,
        firearmCompetencyExpiry: guard.firearmCompetencyExpiry
          ? new Date(guard.firearmCompetencyExpiry)
          : null,
      },
    });

    const restWarnings: string[] = [];
    const credWarnings = [...credWarnSet];
    for (const f of period.flags) {
      if (f.code === "PSIRA_EXPIRED" || f.code === "FIREARM_EXPIRED") {
        credWarnings.push(f.message);
      } else {
        restWarnings.push(f.message);
      }
    }

    totalOvertimeHours += period.overtimeHours;
    restViolationsCount += restWarnings.length;
    credentialWarningsCount += credWarnings.length;

    guardSummaries.push({
      guardId: guard.id,
      guardName: guard.fullName,
      employeeNumber: guard.employeeNumber,
      totalShifts: guardAssigns.length,
      dayShifts,
      nightShifts,
      totalHours: period.totalWorkedHours,
      ordinaryHours: period.basicHours,
      overtimeHours: period.overtimeHours,
      sundayHours: period.sundayHours,
      sundayDoubleHours: period.sundayDoubleHours,
      publicHolidayHours: period.publicHolidayHours,
      nightShiftCount: period.nightShiftCount,
      nightAllowanceRand: period.nightAllowanceTotalRand,
      restWarnings: [...new Set(restWarnings)],
      credentialWarnings: [...new Set(credWarnings)],
    });
  }

  guardSummaries.sort((a, b) => a.guardName.localeCompare(b.guardName));

  return {
    solverUsed: params.solverUsed,
    solverStatus: params.solverStatus,
    solveDurationMs: params.solveDurationMs,
    fallbackReason: params.fallbackReason,
    assignments,
    unfilledSlots,
    guardSummaries,
    metrics: {
      totalRequiredSlots,
      totalFilledSlots,
      coveragePercent:
        totalRequiredSlots > 0
          ? Math.round((totalFilledSlots / totalRequiredSlots) * 1000) / 10
          : 100,
      totalOvertimeHours: Math.round(totalOvertimeHours * 100) / 100,
      restViolationsCount,
      credentialWarningsCount,
    },
  };
}
