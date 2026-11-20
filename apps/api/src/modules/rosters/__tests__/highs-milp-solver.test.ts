import { describe, expect, it } from "vitest";
import { getIsoWeekStartKey, getSastDayOfWeek } from "../../../lib/sa-labour-rules.config.js";
import { HeuristicLnsSolver } from "../solver/heuristic-lns.solver.js";
import { HighsMilpSolver } from "../solver/highs-milp.solver.js";
import { calculateFrameworkStaffing } from "../solver/sa-frameworks.js";
import type { SmartRosterDaySpec, SmartRosterGuardInput, SmartRosterSolveRequest } from "../solver/solver.types.js";

function makeDays(startDate: string, count: number): SmartRosterDaySpec[] {
  const days: SmartRosterDaySpec[] = [];
  const start = new Date(`${startDate}T00:00:00.000Z`);
  for (let i = 0; i < count; i++) {
    const dt = new Date(start.getTime() + i * 86_400_000);
    const dk = dt.toISOString().slice(0, 10);
    const dow = getSastDayOfWeek(dk);
    days.push({
      dateKey: dk,
      dayOfWeek: dow,
      isoWeekStartKey: getIsoWeekStartKey(dk),
      isSunday: dow === 0,
      isPublicHoliday: false,
    });
  }
  return days;
}

function makeGuard(id: string, name: string, overrides: Partial<SmartRosterGuardInput> = {}): SmartRosterGuardInput {
  return {
    id,
    employeeNumber: id.toUpperCase(),
    fullName: name,
    status: "active",
    employeeType: "security_officer",
    bceaCategory: "security_officer",
    gender: "M",
    psiraGrade: "C",
    psiraRegistrationNumber: `PS-${id}`,
    psiraRegistrationExpiry: "2028-12-31",
    firearmCompetency: false,
    firearmCompetencyExpiry: null,
    armedGuard: false,
    preferredShiftType: "any",
    isSitePrimary: true,
    isReliever: false,
    eligiblePostIds: [],
    priorWeekWorkedHoursByWeekKey: {},
    priorWorkDateKeys: [],
    priorDayLastShiftType: null,
    leaveDateKeys: [],
    otherSiteShiftsByDate: {},
    ...overrides,
  };
}

function makeBaseRequest(overrides: Partial<SmartRosterSolveRequest> = {}): SmartRosterSolveRequest {
  return {
    siteId: "site-1",
    siteName: "Sandton Logistics Park",
    frameworkId: "4on4off_12h",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-14",
    dayStartTime: "06:00",
    dayEndTime: "18:00",
    nightStartTime: "18:00",
    nightEndTime: "06:00",
    shiftDurationHours: 12,
    mealIntervalPaid: true,
    mealIntervalMinutes: 60,
    psiraEnforcementMode: "BLOCK",
    averagingEnabled: false,
    averagingWeeks: 4,
    fortnightlyRestEnabled: false,
    allowOvertime: false,
    maxWeeklyOvertimeHours: 10,
    preferDedicatedDayNight: true,
    posts: [
      {
        id: "post-main",
        name: "Main Gate",
        dayRequired: 1,
        nightRequired: 1,
        requiredPsiraGrade: "C",
        requiresFirearm: false,
        requiredGender: "any",
        dayAllowedDays: [0, 1, 2, 3, 4, 5, 6],
        nightAllowedDays: [0, 1, 2, 3, 4, 5, 6],
      },
    ],
    guards: [
      makeGuard("g1", "Thabo Mokoena"),
      makeGuard("g2", "Sipho Dlamini"),
      makeGuard("g3", "Kabelo Ndlovu"),
      makeGuard("g4", "Bongani Khumalo"),
    ],
    days: makeDays("2026-06-01", 14),
    holidaysMap: {},
    timeLimitMs: 2500,
    ...overrides,
  };
}

describe("SA Smart Rostering Solvers (HiGHS MILP + Heuristic LNS + SA Frameworks)", () => {
  it("calculates South African NBCPSS staffing math accurately across operating frameworks", () => {
    const fourOnFourOff = calculateFrameworkStaffing({
      frameworkId: "4on4off_12h",
      dayGuardsRequired: 1,
      nightGuardsRequired: 1,
    });
    expect(fourOnFourOff.recommendedTotalGuards).toBe(4);
    expect(fourOnFourOff.minimumGuardsWithoutOvertime).toBe(4);
    expect(fourOnFourOff.estimatedWeeklyHoursPerGuard).toBe(42);
    expect(fourOnFourOff.estimatedMonthlyOvertimeHours).toBe(0);

    const monFriDay = calculateFrameworkStaffing({
      frameworkId: "5on2off_day",
      dayGuardsRequired: 1,
      nightGuardsRequired: 0,
    });
    expect(monFriDay.recommendedTotalGuards).toBe(1);
    expect(monFriDay.estimatedWeeklyHoursPerGuard).toBe(47.5);
  });

  it("solves a 14-day 24/7 site with 4 guards via HiGHS MILP at 100% coverage and zero overtime", async () => {
    const solver = new HighsMilpSolver();
    const res = await solver.solve(makeBaseRequest());

    expect(res.solverUsed).toBe("highs_milp");
    expect(["Optimal", "Feasible"]).toContain(res.solverStatus);
    expect(res.metrics.totalRequiredSlots).toBe(28);
    expect(res.metrics.totalFilledSlots).toBe(28);
    expect(res.metrics.coveragePercent).toBe(100);
    expect(res.unfilledSlots).toHaveLength(0);
    expect(res.metrics.totalOvertimeHours).toBe(0);
    expect(res.metrics.restViolationsCount).toBe(0);
  });

  it("excludes guards on approved leave and guards double-booked at another site", async () => {
    const solver = new HighsMilpSolver();
    const req = makeBaseRequest({
      guards: [
        makeGuard("g1", "Guard One", { leaveDateKeys: ["2026-06-01", "2026-06-02"] }),
        makeGuard("g2", "Guard Two", {
          otherSiteShiftsByDate: {
            "2026-06-03": [
              {
                siteId: "other-site",
                siteName: "Other Warehouse",
                shiftType: "day",
                startTimeIso: "2026-06-03T06:00:00+02:00",
                endTimeIso: "2026-06-03T18:00:00+02:00",
              },
            ],
          },
        }),
        makeGuard("g3", "Guard Three"),
        makeGuard("g4", "Guard Four"),
        makeGuard("g5", "Pool Reliever", { isSitePrimary: false, isReliever: true }),
      ],
    });

    const res = await solver.solve(req);
    expect(res.metrics.coveragePercent).toBe(100);

    const g1OnLeave = res.assignments.filter(
      (a) => a.guardId === "g1" && (a.dateKey === "2026-06-01" || a.dateKey === "2026-06-02"),
    );
    expect(g1OnLeave).toHaveLength(0);

    // g2 cannot take a day OR night shift on 2026-06-03 due to 12h rest around day shift at Other Warehouse
    const g2OnOverlap = res.assignments.filter(
      (a) => a.guardId === "g2" && a.dateKey === "2026-06-03",
    );
    expect(g2OnOverlap).toHaveLength(0);
  });

  it("enforces PSIRA grade & firearm competency under BLOCK mode and reports unfilled slots cleanly when understaffed", async () => {
    const solver = new HighsMilpSolver();
    const req = makeBaseRequest({
      days: makeDays("2026-06-01", 7),
      posts: [
        {
          id: "post-armed",
          name: "Armed Cash Bay",
          dayRequired: 1,
          nightRequired: 1,
          requiredPsiraGrade: "B",
          requiresFirearm: true,
          requiredGender: "any",
          dayAllowedDays: [0, 1, 2, 3, 4, 5, 6],
          nightAllowedDays: [0, 1, 2, 3, 4, 5, 6],
        },
      ],
      guards: [
        // Only g1 qualifies (Grade B + valid firearm). g2 lacks Grade B / firearm.
        makeGuard("g1", "Armed Specialist", {
          psiraGrade: "B",
          firearmCompetency: true,
          firearmCompetencyExpiry: "2028-01-01",
        }),
        makeGuard("g2", "Unarmed Grade D", { psiraGrade: "D", firearmCompetency: false }),
      ],
    });

    const res = await solver.solve(req);
    // g2 must NEVER be assigned to Armed Cash Bay under BLOCK mode
    expect(res.assignments.some((a) => a.guardId === "g2")).toBe(false);
    // With only 1 qualified guard (max 48h/wk = 4 shifts), 10 of 14 slots remain unfilled with plain reasons
    expect(res.assignments.filter((a) => a.guardId === "g1").length).toBeLessThanOrEqual(4);
    expect(res.unfilledSlots.length).toBeGreaterThan(0);
    expect(res.unfilledSlots[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("runs HeuristicLnsSolver standalone cleanly with zero constraint violations", async () => {
    const solver = new HeuristicLnsSolver();
    const res = await solver.solve(makeBaseRequest());

    expect(res.solverUsed).toBe("heuristic_lns");
    expect(res.metrics.totalFilledSlots).toBe(28);
    expect(res.metrics.restViolationsCount).toBe(0);
    expect(res.metrics.totalOvertimeHours).toBe(0);
  });
});
