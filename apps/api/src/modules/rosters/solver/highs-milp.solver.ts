import { addDaysToDateKey, SA_NBCPSS_RULES } from "../../../lib/sa-labour-rules.config.js";
import { HeuristicLnsSolver } from "./heuristic-lns.solver.js";
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
  SmartRosterShiftAssignment,
  SmartRosterSolveRequest,
  SmartRosterSolveResult,
} from "./solver.types.js";

type HighsInstance = {
  solve(
    problem: string,
    options?: Partial<{
      time_limit: number;
      mip_rel_gap: number;
      output_flag: boolean;
    }>,
  ): {
    Status: string;
    Columns: Record<string, { Primal: number }>;
  };
};

let cachedHighsPromise: Promise<HighsInstance> | null = null;

async function getHighsSolver(): Promise<HighsInstance> {
  if (!cachedHighsPromise) {
    cachedHighsPromise = import("highs").then(async (mod) => {
      const factory = (mod.default ?? mod) as unknown as () => Promise<HighsInstance>;
      return factory();
    });
  }
  return cachedHighsPromise;
}

/** Formats LP linear expression terms wrapped safely onto multiple short lines. */
function formatLinearSum(terms: string[], perLine = 10): string {
  if (terms.length === 0) return "0 x_empty";
  const chunks: string[] = [];
  for (let i = 0; i < terms.length; i += perLine) {
    chunks.push(terms.slice(i, i + perLine).join(" "));
  }
  return chunks.join("\n  ");
}

/**
 * Exact Mixed-Integer Linear Programming (MILP) roster optimizer powered by HiGHS WASM.
 * Falls back transparently to HeuristicLnsSolver if WASM initialization fails or the LP
 * hits an unexpected solver status.
 */
export class HighsMilpSolver implements RosterSolverAdapter {
  public readonly name = "highs_milp";
  private readonly fallbackSolver = new HeuristicLnsSolver();

  public async solve(request: SmartRosterSolveRequest): Promise<SmartRosterSolveResult> {
    const startedAt = Date.now();
    const slots = expandSlotRequirements(request);

    if (slots.length === 0 || request.guards.length === 0) {
      return summarizeSolvedSchedule({
        request,
        slots,
        assignments: [],
        solverUsed: "highs_milp",
        solverStatus: "Optimal",
        solveDurationMs: Date.now() - startedAt,
      });
    }

    try {
      const highs = await getHighsSolver();
      const maxWorkDaysIn7 = computeMaxWorkDaysIn7Window(request);

      interface EligibleVar {
        varName: string;
        gIdx: number;
        sIdx: number;
        slot: SlotRequirement;
        durationHours: number;
        warnings: string[];
        objCost: number;
      }

      const eligibleVars: EligibleVar[] = [];
      const varsBySlot = new Map<number, EligibleVar[]>();
      const varsByGuardDay = new Map<string, EligibleVar[]>();
      const varsByGuardDayShift = new Map<string, EligibleVar[]>();
      const varsByGuardWeek = new Map<string, EligibleVar[]>();
      const varsByGuard = new Map<number, EligibleVar[]>();
      const varsByGuardSunday = new Map<number, EligibleVar[]>();

      const pushMap = <K, V>(map: Map<K, V[]>, key: K, val: V) => {
        const arr = map.get(key);
        if (arr) arr.push(val);
        else map.set(key, [val]);
      };

      for (let sIdx = 0; sIdx < slots.length; sIdx++) {
        const slot = slots[sIdx]!;
        const { durationHours } = buildShiftUtcBounds(slot.dateKey, slot.shiftType, request);

        for (let gIdx = 0; gIdx < request.guards.length; gIdx++) {
          const guard = request.guards[gIdx]!;
          const evalRes = evaluateGuardSlotEligibility(
            guard,
            slot.dayIndex,
            slot.day,
            slot.post,
            slot.shiftType,
            request,
          );
          if (!evalRes.eligible) continue;

          // Symmetry breaker & Day/Night role stability bias
          let affinityOffset = 0;
          if (request.preferDedicatedDayNight && guard.preferredShiftType === "any") {
            const preferDay = gIdx % 2 === 0;
            if ((preferDay && slot.shiftType === "night") || (!preferDay && slot.shiftType === "day")) {
              affinityOffset += 18;
            }
          }
          // Subtle block bias towards framework rhythm (breaks degenerate ties quickly)
          const cycleMod =
            request.frameworkId === "continental_223"
              ? 14
              : request.frameworkId === "6on3off_mixed"
                ? 9
                : request.frameworkId === "4on2off_swing"
                  ? 6
                  : 8;
          const phase = (gIdx * 2 + slot.dayIndex) % cycleMod;
          const workWindow = request.frameworkId === "6on3off_mixed" ? 6 : request.frameworkId === "5on2off_day" ? 5 : 4;
          if (phase < workWindow) {
            affinityOffset -= 1.5;
          }

          const varName = `x_${gIdx}_${sIdx}`;
          const objCost = Math.max(0.1, Number((5 + evalRes.softPenalty + affinityOffset).toFixed(2)));
          const v: EligibleVar = {
            varName,
            gIdx,
            sIdx,
            slot,
            durationHours,
            warnings: evalRes.warnings,
            objCost,
          };

          eligibleVars.push(v);
          pushMap(varsBySlot, sIdx, v);
          pushMap(varsByGuardDay, `${gIdx}:${slot.dayIndex}`, v);
          pushMap(varsByGuardDayShift, `${gIdx}:${slot.dayIndex}:${slot.shiftType}`, v);
          pushMap(varsByGuardWeek, `${gIdx}:${slot.isoWeekStartKey}`, v);
          pushMap(varsByGuard, gIdx, v);
          if (slot.day.isSunday) {
            pushMap(varsByGuardSunday, gIdx, v);
          }
        }
      }

      if (eligibleVars.length === 0) {
        return summarizeSolvedSchedule({
          request,
          slots,
          assignments: [],
          solverUsed: "highs_milp",
          solverStatus: "Optimal",
          solveDurationMs: Date.now() - startedAt,
        });
      }

      const weekKeys = [...new Set(request.days.map((d) => d.isoWeekStartKey))].sort();
      const objTerms: string[] = [];
      const constraints: string[] = [];
      const bounds: string[] = [];
      const binaries: string[] = [];

      for (const v of eligibleVars) {
        objTerms.push(`+ ${v.objCost} ${v.varName}`);
        binaries.push(v.varName);
      }

      // Coverage constraints: sum_{g} x_{g,slot} + u_{slot} = requiredCount
      const slackCost = request.allowOvertime ? 10000 : 2500;
      for (let sIdx = 0; sIdx < slots.length; sIdx++) {
        const slot = slots[sIdx]!;
        const sVars = varsBySlot.get(sIdx) ?? [];
        const uVar = `u_${sIdx}`;
        objTerms.push(`+ ${slackCost} ${uVar}`);
        bounds.push(`0 <= ${uVar} <= ${slot.requiredCount}`);
        const lhsTerms = [...sVars.map((v) => `+ 1 ${v.varName}`), `+ 1 ${uVar}`];
        constraints.push(`cov_${sIdx}: ${formatLinearSum(lhsTerms)} = ${slot.requiredCount}`);
      }

      // Guard daily exclusivity: <= 1 shift per calendar day
      for (let gIdx = 0; gIdx < request.guards.length; gIdx++) {
        for (let dIdx = 0; dIdx < request.days.length; dIdx++) {
          const dVars = varsByGuardDay.get(`${gIdx}:${dIdx}`);
          if (!dVars || dVars.length <= 1) continue;
          constraints.push(
            `one_${gIdx}_${dIdx}: ${formatLinearSum(dVars.map((v) => `+ 1 ${v.varName}`))} <= 1`,
          );
        }
      }

      // 12h Daily Rest: Night(d) + Day(d+1) <= 1
      for (let gIdx = 0; gIdx < request.guards.length; gIdx++) {
        for (let dIdx = 0; dIdx < request.days.length - 1; dIdx++) {
          const nightVars = varsByGuardDayShift.get(`${gIdx}:${dIdx}:night`) ?? [];
          const nextDayVars = varsByGuardDayShift.get(`${gIdx}:${dIdx + 1}:day`) ?? [];
          if (nightVars.length === 0 || nextDayVars.length === 0) continue;
          const terms = [
            ...nightVars.map((v) => `+ 1 ${v.varName}`),
            ...nextDayVars.map((v) => `+ 1 ${v.varName}`),
          ];
          constraints.push(`rest12_${gIdx}_${dIdx}: ${formatLinearSum(terms)} <= 1`);
        }
      }

      // 36h Weekly Rest: any rolling 7 calendar days has <= maxWorkDaysIn7 shifts
      const dateIndexMap = new Map(request.days.map((d, idx) => [d.dateKey, idx]));
      for (let gIdx = 0; gIdx < request.guards.length; gIdx++) {
        const guard = request.guards[gIdx]!;
        const priorSet = new Set(guard.priorWorkDateKeys);
        for (let endD = 0; endD < request.days.length; endD++) {
          const endDateKey = request.days[endD]!.dateKey;
          const windowTerms: string[] = [];
          let priorWorkedInWin = 0;
          for (let offset = 0; offset < 7; offset++) {
            const dk = addDaysToDateKey(endDateKey, -offset);
            const idx = dateIndexMap.get(dk);
            if (idx !== undefined) {
              const dVars = varsByGuardDay.get(`${gIdx}:${idx}`) ?? [];
              for (const v of dVars) windowTerms.push(`+ 1 ${v.varName}`);
            } else if (priorSet.has(dk)) {
              priorWorkedInWin += 1;
            }
          }
          if (windowTerms.length === 0) continue;
          const rhs = Math.max(0, maxWorkDaysIn7 - priorWorkedInWin);
          constraints.push(`rest7_${gIdx}_${endD}: ${formatLinearSum(windowTerms)} <= ${rhs}`);
        }
      }

      // Weekly ordinary caps (48h security / 45h general) or BCEA s12 cycle averaging
      const otHourCost = request.allowOvertime ? 80 : 1800;
      const excessOtHourCost = request.allowOvertime ? 850 : 4000;

      if (request.averagingEnabled) {
        const avgWeeks = Math.max(1, Math.min(request.averagingWeeks, Math.max(1, weekKeys.length)));
        for (let gIdx = 0; gIdx < request.guards.length; gIdx++) {
          const gVars = varsByGuard.get(gIdx) ?? [];
          if (gVars.length === 0) continue;
          const guard = request.guards[gIdx]!;
          const baseWeekly =
            guard.bceaCategory === "general"
              ? SA_NBCPSS_RULES.generalStaffMaxWeeklyOrdinaryHours
              : SA_NBCPSS_RULES.securityOfficerMaxWeeklyOrdinaryHours;
          const priorTotal = Object.values(guard.priorWeekWorkedHoursByWeekKey).reduce((a, b) => a + b, 0);
          const rhs = Math.max(0, baseWeekly * avgWeeks - priorTotal);
          const otVar = `ota_${gIdx}`;
          objTerms.push(`+ ${otHourCost} ${otVar}`);
          bounds.push(`0 <= ${otVar} <= 120`);
          const terms = [...gVars.map((v) => `+ ${v.durationHours} ${v.varName}`), `- 1 ${otVar}`];
          constraints.push(`avg_${gIdx}: ${formatLinearSum(terms)} <= ${rhs}`);
        }
      } else {
        for (let gIdx = 0; gIdx < request.guards.length; gIdx++) {
          const guard = request.guards[gIdx]!;
          const baseWeekly =
            guard.bceaCategory === "general"
              ? SA_NBCPSS_RULES.generalStaffMaxWeeklyOrdinaryHours
              : SA_NBCPSS_RULES.securityOfficerMaxWeeklyOrdinaryHours;

          for (let wIdx = 0; wIdx < weekKeys.length; wIdx++) {
            const wk = weekKeys[wIdx]!;
            const wVars = varsByGuardWeek.get(`${gIdx}:${wk}`) ?? [];
            if (wVars.length === 0) continue;

            const priorHrs = guard.priorWeekWorkedHoursByWeekKey[wk] ?? 0;
            const rhs = Math.max(0, baseWeekly - priorHrs);
            const otVar = `ot_${gIdx}_${wIdx}`;
            const otxVar = `otx_${gIdx}_${wIdx}`;
            objTerms.push(`+ ${otHourCost} ${otVar}`, `+ ${excessOtHourCost} ${otxVar}`);
            bounds.push(`0 <= ${otVar} <= 60`, `0 <= ${otxVar} <= 60`);

            const hrTerms = [...wVars.map((v) => `+ ${v.durationHours} ${v.varName}`), `- 1 ${otVar}`];
            constraints.push(`wk_${gIdx}_${wIdx}: ${formatLinearSum(hrTerms)} <= ${rhs}`);
            constraints.push(`otc_${gIdx}_${wIdx}: + 1 ${otVar} - 1 ${otxVar} <= ${request.maxWeeklyOvertimeHours}`);
          }
        }
      }

      // Minimax fairness on total hours & Sundays across participating guards
      objTerms.push("+ 2.5 peak_hrs", "+ 12 peak_sun");
      bounds.push("0 <= peak_hrs <= 500", "0 <= peak_sun <= 31");
      for (let gIdx = 0; gIdx < request.guards.length; gIdx++) {
        const gVars = varsByGuard.get(gIdx) ?? [];
        if (gVars.length > 0) {
          const hrTerms = [...gVars.map((v) => `+ ${v.durationHours} ${v.varName}`), "- 1 peak_hrs"];
          constraints.push(`fairh_${gIdx}: ${formatLinearSum(hrTerms)} <= 0`);
        }
        const sVars = varsByGuardSunday.get(gIdx) ?? [];
        if (sVars.length > 0) {
          const sunTerms = [...sVars.map((v) => `+ 1 ${v.varName}`), "- 1 peak_sun"];
          constraints.push(`fairs_${gIdx}: ${formatLinearSum(sunTerms)} <= 0`);
        }
      }

      const lpSections = [
        "Minimize",
        `  obj: ${formatLinearSum(objTerms)}`,
        "Subject To",
        ...constraints.map((c) => `  ${c}`),
        "Bounds",
        ...bounds.map((b) => `  ${b}`),
        "Binary",
        `  ${binaries.join(" ")}`,
        "End",
      ];
      const lpProblem = lpSections.join("\n");

      const timeLimitSec = Math.max(0.5, Math.min(5, (request.timeLimitMs ?? 2500) / 1000));
      const solution = highs.solve(lpProblem, {
        time_limit: timeLimitSec,
        mip_rel_gap: 0.02,
        output_flag: false,
      });

      const acceptedStatus =
        solution.Status === "Optimal" || solution.Status === "Time limit reached";
      if (!acceptedStatus || !solution.Columns) {
        const fallback = await this.fallbackSolver.solve(request);
        return {
          ...fallback,
          fallbackReason: `HiGHS status ${solution.Status}; repaired via TypeScript LNS`,
        };
      }

      const assignments: SmartRosterShiftAssignment[] = [];
      for (const v of eligibleVars) {
        const val = solution.Columns[v.varName]?.Primal ?? 0;
        if (val > 0.5) {
          const guard = request.guards[v.gIdx]!;
          assignments.push({
            guardId: guard.id,
            guardName: guard.fullName,
            employeeNumber: guard.employeeNumber,
            dateKey: v.slot.dateKey,
            shiftType: v.slot.shiftType,
            shiftCode: v.slot.shiftType === "night" ? "N" : "D",
            postId: v.slot.postId,
            postName: v.slot.postName,
            warnings: v.warnings,
          });
        }
      }

      assignments.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.guardName.localeCompare(b.guardName));

      // Guardrail: if time limit left valid Columns empty on non-empty eligible vars, use fallback
      if (assignments.length === 0 && eligibleVars.length > 0 && slots.length > 0) {
        const fallback = await this.fallbackSolver.solve(request);
        return {
          ...fallback,
          fallbackReason: `HiGHS returned empty primal (${solution.Status}); repaired via TypeScript LNS`,
        };
      }

      return summarizeSolvedSchedule({
        request,
        slots,
        assignments,
        solverUsed: "highs_milp",
        solverStatus: solution.Status === "Optimal" ? "Optimal" : "Feasible",
        solveDurationMs: Date.now() - startedAt,
      });
    } catch (err) {
      const fallback = await this.fallbackSolver.solve(request);
      return {
        ...fallback,
        fallbackReason:
          err instanceof Error
            ? `HiGHS fallback (${err.message})`
            : "HiGHS fallback due to runtime error",
      };
    }
  }
}
