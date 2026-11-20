import { HighsMilpSolver } from "./highs-milp.solver.js";
import type {
  RosterSolverAdapter,
  SmartRosterSolveRequest,
  SmartRosterSolveResult,
} from "./solver.types.js";

/**
 * Pluggable adapter for an optional external solver service (e.g. Google OR-Tools CP-SAT
 * or Timefold microservice) configured via `EXTERNAL_ROSTER_SOLVER_URL`.
 * Transparently falls back to the built-in HiGHS MILP WASM solver when unconfigured or offline.
 */
export class ExternalHttpSolver implements RosterSolverAdapter {
  public readonly name = "external_http";
  private readonly defaultSolver = new HighsMilpSolver();

  public async solve(request: SmartRosterSolveRequest): Promise<SmartRosterSolveResult> {
    const endpoint = process.env.EXTERNAL_ROSTER_SOLVER_URL?.trim();
    if (!endpoint) {
      return this.defaultSolver.solve(request);
    }

    const startedAt = Date.now();
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(request.timeLimitMs ?? 3500),
      });
      if (!res.ok) {
        throw new Error(`External solver HTTP ${res.status}`);
      }
      const data = (await res.json()) as SmartRosterSolveResult;
      if (!Array.isArray(data.assignments)) {
        throw new Error("Invalid response payload from external solver");
      }
      return {
        ...data,
        solverUsed: "external_http",
        solveDurationMs: Date.now() - startedAt,
      };
    } catch (err) {
      const fallback = await this.defaultSolver.solve(request);
      return {
        ...fallback,
        fallbackReason:
          err instanceof Error
            ? `External solver unavailable (${err.message}); solved locally via HiGHS`
            : "External solver unavailable; solved locally via HiGHS",
      };
    }
  }
}
