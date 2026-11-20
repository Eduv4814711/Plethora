import { addDaysToDateKey, SA_NBCPSS_RULES } from "../../../lib/sa-labour-rules.config.js";
import {
  buildShiftUtcBounds,
  computeMaxWorkDaysIn7Window,
  evaluateGuardSlotEligibility,
  expandSlotRequirements,
  summarizeSolvedSchedule,
  type SlotRequirement,
} from "./solver-helpers.js";
import type {
  RosterSolverAdapter,
  SmartRosterGuardInput,
  SmartRosterShiftAssignment,
  SmartRosterSolveRequest,
  SmartRosterSolveResult,
} from "./solver.types.js";

interface CandidateAssignmentState {
  guardId: string;
  slot: SlotRequirement;
  warnings: string[];
  softPenalty: number;
}

/**
 * Pure TypeScript constructive greedy + 2-opt Large Neighborhood Search (LNS) roster solver.
 * Serves both as an ultra-fast fallback when HiGHS hits a time budget and as an
 * independent constraint-preserving optimizer.
 */
export class HeuristicLnsSolver implements RosterSolverAdapter {
  public readonly name = "heuristic_lns";

  public async solve(request: SmartRosterSolveRequest): Promise<SmartRosterSolveResult> {
    const startedAt = Date.now();
    const slots = expandSlotRequirements(request);
    const maxWorkDaysIn7 = computeMaxWorkDaysIn7Window(request);
    const weeklyOrdinaryCap =
      request.averagingEnabled
        ? SA_NBCPSS_RULES.securityOfficerMaxWeeklyOrdinaryHours * Math.max(1, request.averagingWeeks)
        : SA_NBCPSS_RULES.securityOfficerMaxWeeklyOrdinaryHours;

    // Precompute per-guard mutable state during construction
    const guardDayShift = new Map<string, Map<string, "day" | "night">>();
    const guardWeekHours = new Map<string, Map<string, number>>();
    const guardTotalHours = new Map<string, number>();
    const guardSundayCount = new Map<string, number>();
    const guardTotalShifts = new Map<string, number>();
    const guardDominantShift = new Map<string, "day" | "night">();

    for (const g of request.guards) {
      guardDayShift.set(g.id, new Map());
      guardWeekHours.set(
        g.id,
        new Map(Object.entries(g.priorWeekWorkedHoursByWeekKey)),
      );
      guardTotalHours.set(g.id, 0);
      guardSundayCount.set(g.id, 0);
      guardTotalShifts.set(g.id, 0);
    }

    const canAssignGuardToDay = (
      guard: SmartRosterGuardInput,
      dayIndex: number,
      dateKey: string,
      shiftType: "day" | "night",
      ignoreDateKey?: string,
    ): { ok: boolean; reason?: string } => {
      const workedMap = guardDayShift.get(guard.id)!;
      if (workedMap.has(dateKey) && dateKey !== ignoreDateKey) {
        return { ok: false, reason: "Already assigned that day" };
      }

      // 12h daily rest check: previous day night cannot follow with today day, and vice versa
      const prevDateKey = addDaysToDateKey(dateKey, -1);
      const nextDateKey = addDaysToDateKey(dateKey, 1);
      const prevShift =
        dayIndex === 0
          ? guard.priorDayLastShiftType === "day" || guard.priorDayLastShiftType === "night"
            ? guard.priorDayLastShiftType
            : null
          : workedMap.get(prevDateKey) ?? null;
      const nextShift = workedMap.get(nextDateKey) ?? null;

      if (shiftType === "day" && prevShift === "night") {
        return { ok: false, reason: "Requires 12h rest after night shift" };
      }
      if (shiftType === "night" && nextShift === "day") {
        return { ok: false, reason: "Requires 12h rest before next day shift" };
      }

      // Rolling 7-day work count <= maxWorkDaysIn7 (preserves >=36h weekly rest)
      const isDateWorked = (dk: string) =>
        dk === dateKey ||
        (dk !== ignoreDateKey && (workedMap.has(dk) || guard.priorWorkDateKeys.includes(dk)));

      for (let winEndOffset = 0; winEndOffset <= 6; winEndOffset++) {
        let countInWin = 0;
        for (let k = -6 + winEndOffset; k <= winEndOffset; k++) {
          if (isDateWorked(addDaysToDateKey(dateKey, k))) {
            countInWin += 1;
          }
        }
        if (countInWin > maxWorkDaysIn7) {
          return { ok: false, reason: "Preserves 36h consecutive weekly rest" };
        }
      }

      return { ok: true };
    };

    const scoreCandidate = (
      guard: SmartRosterGuardInput,
      slot: SlotRequirement,
      evalSoftPenalty: number,
      shiftHours: number,
    ): number => {
      let cost = evalSoftPenalty;
      const weekMap = guardWeekHours.get(guard.id)!;
      const curWeekHours = weekMap.get(slot.isoWeekStartKey) ?? 0;
      const ordCap =
        guard.bceaCategory === "general"
          ? SA_NBCPSS_RULES.generalStaffMaxWeeklyOrdinaryHours
          : weeklyOrdinaryCap;
      const nextWeekHours = curWeekHours + shiftHours;
      const otHoursAfter = Math.max(0, nextWeekHours - (request.averagingEnabled ? 999 : ordCap));
      const otHoursBefore = Math.max(0, curWeekHours - (request.averagingEnabled ? 999 : ordCap));
      const marginalOt = otHoursAfter - otHoursBefore;

      if (marginalOt > 0) {
        if (!request.allowOvertime) cost += 20000;
        else cost += marginalOt * 120;
        if (otHoursAfter > request.maxWeeklyOvertimeHours) {
          cost += 8000;
        }
      }

      // Prefer keeping a guard consistently on Day or Night within a month
      const dominant = guardDominantShift.get(guard.id);
      if (request.preferDedicatedDayNight && dominant && dominant !== slot.shiftType) {
        cost += 280;
      }

      // Framework cadence affinity: gentle nudge to build natural contiguous blocks (e.g., 4-on/4-off)
      const prevWorked = guardDayShift.get(guard.id)!.has(addDaysToDateKey(slot.dateKey, -1));
      const sameShiftYesterday =
        guardDayShift.get(guard.id)!.get(addDaysToDateKey(slot.dateKey, -1)) === slot.shiftType;
      let streak = 0;
      for (let back = 1; back <= 6; back++) {
        if (guardDayShift.get(guard.id)!.has(addDaysToDateKey(slot.dateKey, -back))) streak += 1;
        else break;
      }
      const targetBlock = request.frameworkId === "continental_223" ? 3 : request.frameworkId === "6on3off_mixed" ? 6 : request.frameworkId === "5on2off_day" ? 5 : 4;
      if (sameShiftYesterday && streak < targetBlock) {
        cost -= 18; // reward finishing current shift block smoothly
      } else if (prevWorked && streak >= targetBlock) {
        cost += 45; // reward taking rest block after completing target block
      }

      // Balance total hours & Sundays fairly
      cost += (guardTotalHours.get(guard.id) ?? 0) * 0.6;
      if (slot.day.isSunday) {
        cost += (guardSundayCount.get(guard.id) ?? 0) * 14;
      }
      return cost;
    };

    const chosen: CandidateAssignmentState[] = [];

    // Sort harder/specialized slots first (e.g. armed/graded posts before generic posts)
    const prioritizedSlots = [...slots].sort((a, b) => {
      const specA = (a.post.requiresFirearm ? 4 : 0) + (a.post.requiredPsiraGrade ? 2 : 0) + (a.post.requiredGender ? 1 : 0);
      const specB = (b.post.requiresFirearm ? 4 : 0) + (b.post.requiredPsiraGrade ? 2 : 0) + (b.post.requiredGender ? 1 : 0);
      if (specB !== specA) return specB - specA;
      return a.dayIndex - b.dayIndex;
    });

    for (const slot of prioritizedSlots) {
      const { durationHours } = buildShiftUtcBounds(slot.dateKey, slot.shiftType, request);
      for (let seat = 0; seat < slot.requiredCount; seat++) {
        let bestGuard: SmartRosterGuardInput | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        let bestWarnings: string[] = [];
        let bestPenalty = 0;

        for (const guard of request.guards) {
          const eligibility = evaluateGuardSlotEligibility(
            guard,
            slot.dayIndex,
            slot.day,
            slot.post,
            slot.shiftType,
            request,
          );
          if (!eligibility.eligible) continue;

          const dayCheck = canAssignGuardToDay(guard, slot.dayIndex, slot.dateKey, slot.shiftType);
          if (!dayCheck.ok) continue;

          const score = scoreCandidate(guard, slot, eligibility.softPenalty, durationHours);
          if (score < bestScore) {
            bestScore = score;
            bestGuard = guard;
            bestWarnings = eligibility.warnings;
            bestPenalty = eligibility.softPenalty;
          }
        }

        if (bestGuard) {
          chosen.push({
            guardId: bestGuard.id,
            slot,
            warnings: bestWarnings,
            softPenalty: bestPenalty,
          });
          guardDayShift.get(bestGuard.id)!.set(slot.dateKey, slot.shiftType);
          const wk = guardWeekHours.get(bestGuard.id)!;
          wk.set(slot.isoWeekStartKey, (wk.get(slot.isoWeekStartKey) ?? 0) + durationHours);
          guardTotalHours.set(bestGuard.id, (guardTotalHours.get(bestGuard.id) ?? 0) + durationHours);
          guardTotalShifts.set(bestGuard.id, (guardTotalShifts.get(bestGuard.id) ?? 0) + 1);
          if (slot.day.isSunday) {
            guardSundayCount.set(bestGuard.id, (guardSundayCount.get(bestGuard.id) ?? 0) + 1);
          }
          if (!guardDominantShift.has(bestGuard.id)) {
            guardDominantShift.set(bestGuard.id, slot.shiftType);
          }
        }
      }
    }

    // LNS Repair Pass: try relocating shifts from any guard > 48h/week onto eligible < 48h/week guards
    for (let iter = 0; iter < 40; iter++) {
      let improved = false;
      for (const assign of chosen) {
        const gWeekMap = guardWeekHours.get(assign.guardId)!;
        const gWeekHrs = gWeekMap.get(assign.slot.isoWeekStartKey) ?? 0;
        if (gWeekHrs <= SA_NBCPSS_RULES.securityOfficerMaxWeeklyOrdinaryHours) continue;

        const { durationHours } = buildShiftUtcBounds(assign.slot.dateKey, assign.slot.shiftType, request);
        for (const candidate of request.guards) {
          if (candidate.id === assign.guardId) continue;
          const cWeekMap = guardWeekHours.get(candidate.id)!;
          const cWeekHrs = cWeekMap.get(assign.slot.isoWeekStartKey) ?? 0;
          if (cWeekHrs + durationHours > SA_NBCPSS_RULES.securityOfficerMaxWeeklyOrdinaryHours) continue;

          const el = evaluateGuardSlotEligibility(
            candidate,
            assign.slot.dayIndex,
            assign.slot.day,
            assign.slot.post,
            assign.slot.shiftType,
            request,
          );
          if (!el.eligible) continue;
          const dayOk = canAssignGuardToDay(candidate, assign.slot.dayIndex, assign.slot.dateKey, assign.slot.shiftType);
          if (!dayOk.ok) continue;

          // Relocate shift cleanly
          guardDayShift.get(assign.guardId)!.delete(assign.slot.dateKey);
          gWeekMap.set(assign.slot.isoWeekStartKey, gWeekHrs - durationHours);
          guardDayShift.get(candidate.id)!.set(assign.slot.dateKey, assign.slot.shiftType);
          cWeekMap.set(assign.slot.isoWeekStartKey, cWeekHrs + durationHours);
          assign.guardId = candidate.id;
          assign.warnings = el.warnings;
          improved = true;
          break;
        }
      }
      if (!improved) break;
    }

    const guardMap = new Map(request.guards.map((g) => [g.id, g]));
    const finalAssignments: SmartRosterShiftAssignment[] = chosen
      .map((item) => {
        const g = guardMap.get(item.guardId)!;
        return {
          guardId: g.id,
          guardName: g.fullName,
          employeeNumber: g.employeeNumber,
          dateKey: item.slot.dateKey,
          shiftType: item.slot.shiftType,
          shiftCode: item.slot.shiftType === "night" ? ("N" as const) : ("D" as const),
          postId: item.slot.postId,
          postName: item.slot.postName,
          warnings: item.warnings,
        };
      })
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.guardName.localeCompare(b.guardName));

    return summarizeSolvedSchedule({
      request,
      slots,
      assignments: finalAssignments,
      solverUsed: "heuristic_lns",
      solverStatus: "Heuristic",
      solveDurationMs: Date.now() - startedAt,
    });
  }
}
