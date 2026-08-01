import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {},
}));
import {
  MAX_CONSECUTIVE_WORK_DAYS,
  buildCalendarDays,
  buildPatternPreferenceGrid,
  buildRosterReadinessDiagnostics,
  buildSiteDemandSlots,
  computeFairnessTargets,
  computePatternFairnessTargets,
  deriveSiteRotationBlocks,
  dayNightBalanceDelta,
  formatRotationPatternLabel,
  buildSiteRotationPlan,
  maxConsecutiveShiftTypeInPattern,
  computeStaggerOffsets,
  getConsecutiveWorkDaysBefore,
  getPatternShiftAtOffset,
  explainGuardIneligibilityForSlot,
  isGuardEligibleForSlot,
  pickBestGuardForDemandSlot,
  scoreGuardFairness,
  scoreGuardForDemandSlot,
  scoreGuardForSlot,
  validateDailyCoverage,
  violatesAdjacentShiftRestRules,
  wouldViolateRestRules,
  type GuardCandidate,
  type GuardRuntimeState,
} from "../roster-scheduler.js";

function emptyRuntime(overrides?: Partial<GuardRuntimeState>): GuardRuntimeState {
  return {
    stats: {
      employeeId: "g1",
      dayCount: 0,
      nightCount: 0,
      offCount: 0,
      sundayCount: 0,
      weekendCount: 0,
    },
    planned: [],
    workedDateKeys: new Set(),
    shiftTypeByDateKey: new Map(),
    ...overrides,
  };
}

describe("roster-scheduler", () => {
  it("buildCalendarDays includes start and end", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-03T23:59:59.999Z");
    const days = buildCalendarDays(start, end);
    expect(days).toHaveLength(3);
    expect(days[0]!.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(days[2]!.toISOString().slice(0, 10)).toBe("2026-05-03");
  });

  it("computeStaggerOffsets spaces phases across the cycle (legacy)", () => {
    expect(computeStaggerOffsets(3, 9)).toEqual([0, 3, 6]);
    expect(computeStaggerOffsets(2, 9)).toEqual([0, 4]);
    expect(computeStaggerOffsets(5, 9)).toEqual([0, 1, 3, 5, 7]);
  });

  it("computeStaggerOffsets optimizes for staffing when options provided", () => {
    const offsets = computeStaggerOffsets(5, 9, {
      pattern: "3_on_3_off",
      staffing: { day: 1, night: 2 },
    });
    expect(offsets).toHaveLength(5);
    expect(new Set(offsets).size).toBe(5);
  });

  it("getPatternShiftAtOffset follows 3_on_3_off cycle", () => {
    expect(getPatternShiftAtOffset(0, "3_on_3_off")).toBe("day");
    expect(getPatternShiftAtOffset(2, "3_on_3_off")).toBe("day");
    expect(getPatternShiftAtOffset(3, "3_on_3_off")).toBe("night");
    expect(getPatternShiftAtOffset(6, "3_on_3_off")).toBe("off");
    expect(getPatternShiftAtOffset(8, "3_on_3_off")).toBe("off");
    expect(getPatternShiftAtOffset(9, "3_on_3_off")).toBe("day");
  });

  it("preference grid rotates stagger offsets within shared pattern timeline", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-05T23:59:59.999Z");
    const days = buildCalendarDays(start, end);
    const grid = buildPatternPreferenceGrid({
      guardIds: ["g1", "g2", "g3"],
      calendarDays: days,
      patternStartDate: start,
      pattern: "3_on_3_off",
      staggerOffsets: new Map([
        ["g1", 0],
        ["g2", 3],
        ["g3", 6],
      ]),
    });
    expect(grid.get("g1")!.get("2026-05-01")).toBe("day");
    expect(grid.get("g2")!.get("2026-05-01")).toBe("night");
    expect(grid.get("g3")!.get("2026-05-01")).toBe("off");
    expect(grid.get("g2")!.get("2026-05-02")).toBe("night");
  });

  it("computePatternFairnessTargets reflects staggered 3D3N3O workload per guard", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-31T23:59:59.999Z");
    const days = buildCalendarDays(start, end);
    const guardIds = ["g1", "g2", "g3"];
    const grid = buildPatternPreferenceGrid({
      guardIds,
      calendarDays: days,
      patternStartDate: start,
      pattern: "3_on_3_off",
      staggerOffsets: new Map([
        ["g1", 0],
        ["g2", 3],
        ["g3", 6],
      ]),
    });
    const targets = computePatternFairnessTargets(guardIds, days, grid);
    expect(targets.targetDay).toBeGreaterThan(9);
    expect(targets.targetNight).toBeGreaterThan(9);
    expect(targets.targetOff).toBeGreaterThan(8);
    expect(Math.abs(targets.targetDay - targets.targetNight)).toBeLessThanOrEqual(1);
  });

  it("scoreGuardForSlot prefers guard with more nights when filling a day slot (equal staffing)", () => {
    const targets = computeFairnessTargets(2, buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-14T23:59:59.999Z")
    ));
    const moreNights: import("../roster-scheduler.js").GuardStats = {
      employeeId: "a",
      dayCount: 2,
      nightCount: 8,
      offCount: 0,
      sundayCount: 0,
      weekendCount: 0,
    };
    const moreDays: import("../roster-scheduler.js").GuardStats = {
      employeeId: "b",
      dayCount: 8,
      nightCount: 2,
      offCount: 0,
      sundayCount: 0,
      weekendCount: 0,
    };
    const date = new Date("2026-05-05T00:00:00.000Z");
    const scoreMoreNights = scoreGuardForSlot(moreNights, "day", date, targets, "day", { day: 1, night: 1 });
    const scoreMoreDays = scoreGuardForSlot(moreDays, "day", date, targets, "day", { day: 1, night: 1 });
    expect(scoreMoreNights).toBeLessThan(scoreMoreDays);
  });

  it("scoreGuardForSlot prefers guard below day target", () => {
    const targets = computeFairnessTargets(2, buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-14T23:59:59.999Z")
    ));
    const low: import("../roster-scheduler.js").GuardStats = {
      employeeId: "a",
      dayCount: 0,
      nightCount: 5,
      offCount: 0,
      sundayCount: 0,
      weekendCount: 0,
    };
    const high: import("../roster-scheduler.js").GuardStats = {
      employeeId: "b",
      dayCount: 7,
      nightCount: 0,
      offCount: 0,
      sundayCount: 0,
      weekendCount: 0,
    };
    const date = new Date("2026-05-05T00:00:00.000Z");
    const scoreLow = scoreGuardForSlot(low, "day", date, targets, "off");
    const scoreHigh = scoreGuardForSlot(high, "day", date, targets, "day");
    expect(scoreLow).toBeLessThan(scoreHigh);
  });

  it("validateDailyCoverage detects missing shifts", () => {
    const days = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-02T23:59:59.999Z")
    );
    const uncovered = validateDailyCoverage(
      [
        {
          startTime: "2026-05-01T04:00:00.000Z",
          shiftType: "day",
        },
      ],
      days
    );
    expect(uncovered).toHaveLength(2);
    expect(uncovered[0]!.missing).toContain("night");
  });

  it("buildSiteDemandSlots creates 124 slots for 31 days with 2 day and 2 night staffing", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-31T23:59:59.999Z");
    const days = buildCalendarDays(start, end);
    const { slots, warnings } = buildSiteDemandSlots({
      siteId: "site-1",
      calendarDays: days,
      dayPosts: [{ id: "d1" }, { id: "d2" }],
      nightPosts: [{ id: "n1" }, { id: "n2" }],
      staffing: { day: 2, night: 2 },
      siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
    });
    expect(slots).toHaveLength(124);
    expect(warnings).toHaveLength(0);
  });

  it("buildSiteDemandSlots warns MISSING_NIGHT_POSTS and STAFFING_EXCEEDS_POSTS", () => {
    const days = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-03T23:59:59.999Z")
    );
    const noNight = buildSiteDemandSlots({
      siteId: "site-1",
      calendarDays: days,
      dayPosts: [{ id: "d1" }],
      nightPosts: [],
      staffing: { day: 1, night: 1 },
      siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
    });
    expect(noNight.warnings.some((w) => w.code === "MISSING_NIGHT_POSTS")).toBe(true);
    expect(noNight.slots.every((s) => s.shiftType === "day")).toBe(true);

    const exceeds = buildSiteDemandSlots({
      siteId: "site-1",
      calendarDays: days,
      dayPosts: [{ id: "d1" }],
      nightPosts: [{ id: "n1" }],
      staffing: { day: 3, night: 1 },
      siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
    });
    expect(exceeds.warnings.some((w) => w.code === "STAFFING_EXCEEDS_POSTS")).toBe(true);
  });

  it("buildSiteDemandSlots skips night slots when night staffing is 0", () => {
    const days = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-03T23:59:59.999Z")
    );
    const dayOnly = buildSiteDemandSlots({
      siteId: "site-1",
      calendarDays: days,
      dayPosts: [{ id: "d1" }],
      nightPosts: [],
      staffing: { day: 2, night: 0 },
      siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
    });
    expect(dayOnly.warnings.some((w) => w.code === "MISSING_NIGHT_POSTS")).toBe(false);
    expect(dayOnly.slots).toHaveLength(6);
    expect(dayOnly.slots.every((s) => s.shiftType === "day")).toBe(true);
  });

  it("buildSiteDemandSlots skips day slots when day staffing is 0", () => {
    const days = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-03T23:59:59.999Z")
    );
    const nightOnly = buildSiteDemandSlots({
      siteId: "site-1",
      calendarDays: days,
      dayPosts: [],
      nightPosts: [{ id: "n1" }],
      staffing: { day: 0, night: 2 },
      siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
    });
    expect(nightOnly.warnings.some((w) => w.code === "MISSING_DAY_POSTS")).toBe(false);
    expect(nightOnly.slots).toHaveLength(6);
    expect(nightOnly.slots.every((s) => s.shiftType === "night")).toBe(true);
  });

  it("isGuardEligibleForSlot rejects overlapping planned shifts on the same day", () => {
    const slot = {
      siteId: "site-1",
      postId: "p1",
      date: new Date("2026-05-02T00:00:00.000Z"),
      dateKey: "2026-05-02",
      shiftType: "day" as const,
      requiredGender: null,
      difficultyScore: 0,
    };
    const guard: GuardCandidate = {
      id: "g1",
      gender: "M",
      status: "active",
      employeeType: "security_officer",
    };
    const shiftStart = new Date("2026-05-02T04:00:00.000Z");
    const shiftEnd = new Date("2026-05-02T16:00:00.000Z");
    const calendarDays = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-03T23:59:59.999Z")
    );
    const runtime = emptyRuntime({
      planned: [{ start: shiftStart, end: shiftEnd }],
      workedDateKeys: new Set(["2026-05-02"]),
      shiftTypeByDateKey: new Map([["2026-05-02", "day"]]),
    });
    expect(
      isGuardEligibleForSlot({
        guard,
        slot,
        siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
        postShiftType: "day",
        siteAssignedGuardIds: new Set(["g1"]),
        existingShifts: [],
        runtime,
        shiftStart,
        shiftEnd,
        calendarDays,
        dayIndex: 1,
        prevDateKey: "2026-05-01",
      })
    ).toBe(false);
  });

  it("isGuardEligibleForSlot rejects day then night on the same calendar day", () => {
    const dayStart = new Date("2026-05-02T04:00:00.000Z");
    const dayEnd = new Date("2026-05-02T16:00:00.000Z");
    const nightStart = new Date("2026-05-02T16:00:00.000Z");
    const nightEnd = new Date("2026-05-03T04:00:00.000Z");
    const guard: GuardCandidate = {
      id: "g1",
      gender: "M",
      status: "active",
      employeeType: "security_officer",
    };
    const calendarDays = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-03T23:59:59.999Z")
    );
    const runtime = emptyRuntime({
      planned: [{ start: dayStart, end: dayEnd }],
      workedDateKeys: new Set(["2026-05-02"]),
      shiftTypeByDateKey: new Map([["2026-05-02", "day"]]),
    });
    const nightSlot = {
      siteId: "site-1",
      postId: "p-night",
      date: new Date("2026-05-02T00:00:00.000Z"),
      dateKey: "2026-05-02",
      shiftType: "night" as const,
      requiredGender: null,
      difficultyScore: 0,
    };
    expect(
      isGuardEligibleForSlot({
        guard,
        slot: nightSlot,
        siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
        postShiftType: "night",
        siteAssignedGuardIds: new Set(["g1"]),
        existingShifts: [],
        runtime,
        shiftStart: nightStart,
        shiftEnd: nightEnd,
        calendarDays,
        dayIndex: 1,
        prevDateKey: "2026-05-01",
      })
    ).toBe(false);
  });

  it("isGuardEligibleForSlot rejects day after night on previous calendar day", () => {
    const guard: GuardCandidate = {
      id: "g1",
      gender: "M",
      status: "active",
      employeeType: "security_officer",
    };
    const calendarDays = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-03T23:59:59.999Z")
    );
    const runtime = emptyRuntime({
      workedDateKeys: new Set(["2026-05-01"]),
      shiftTypeByDateKey: new Map([["2026-05-01", "night"]]),
    });
    const daySlot = {
      siteId: "site-1",
      postId: "p-day",
      date: new Date("2026-05-02T00:00:00.000Z"),
      dateKey: "2026-05-02",
      shiftType: "day" as const,
      requiredGender: null,
      difficultyScore: 0,
    };
    const shiftStart = new Date("2026-05-02T04:00:00.000Z");
    const shiftEnd = new Date("2026-05-02T16:00:00.000Z");
    expect(
      isGuardEligibleForSlot({
        guard,
        slot: daySlot,
        siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
        postShiftType: "day",
        siteAssignedGuardIds: new Set(["g1"]),
        existingShifts: [],
        runtime,
        shiftStart,
        shiftEnd,
        calendarDays,
        dayIndex: 1,
        prevDateKey: "2026-05-01",
      })
    ).toBe(false);
  });

  it("isGuardEligibleForSlot rejects night when the next calendar day already has day", () => {
    const guard: GuardCandidate = {
      id: "g1",
      gender: "M",
      status: "active",
      employeeType: "security_officer",
    };
    const calendarDays = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-03T23:59:59.999Z")
    );
    const runtime = emptyRuntime({
      workedDateKeys: new Set(["2026-05-02"]),
      shiftTypeByDateKey: new Map([["2026-05-02", "day"]]),
    });
    const nightSlot = {
      siteId: "site-1",
      postId: "p-night",
      date: new Date("2026-05-01T00:00:00.000Z"),
      dateKey: "2026-05-01",
      shiftType: "night" as const,
      requiredGender: null,
      difficultyScore: 0,
    };
    const shiftStart = new Date("2026-05-01T16:00:00.000Z");
    const shiftEnd = new Date("2026-05-02T04:00:00.000Z");
    expect(
      isGuardEligibleForSlot({
        guard,
        slot: nightSlot,
        siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
        postShiftType: "night",
        siteAssignedGuardIds: new Set(["g1"]),
        existingShifts: [],
        runtime,
        shiftStart,
        shiftEnd,
        calendarDays,
        dayIndex: 0,
        prevDateKey: null,
      })
    ).toBe(false);
  });

  it("isGuardEligibleForSlot allows night after day on previous calendar day (3D-3N-3O transition)", () => {
    const guard: GuardCandidate = {
      id: "g1",
      gender: "M",
      status: "active",
      employeeType: "security_officer",
    };
    const calendarDays = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-03T23:59:59.999Z")
    );
    const runtime = emptyRuntime({
      workedDateKeys: new Set(["2026-05-01"]),
      shiftTypeByDateKey: new Map([["2026-05-01", "day"]]),
    });
    const nightSlot = {
      siteId: "site-1",
      postId: "p-night",
      date: new Date("2026-05-02T00:00:00.000Z"),
      dateKey: "2026-05-02",
      shiftType: "night" as const,
      requiredGender: null,
      difficultyScore: 0,
    };
    const shiftStart = new Date("2026-05-02T16:00:00.000Z");
    const shiftEnd = new Date("2026-05-03T04:00:00.000Z");
    expect(
      isGuardEligibleForSlot({
        guard,
        slot: nightSlot,
        siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
        postShiftType: "night",
        siteAssignedGuardIds: new Set(["g1"]),
        existingShifts: [],
        runtime,
        shiftStart,
        shiftEnd,
        calendarDays,
        dayIndex: 1,
        prevDateKey: "2026-05-01",
      })
    ).toBe(true);
  });

  it("isGuardEligibleForSlot allows day when the next calendar day already has night", () => {
    const guard: GuardCandidate = {
      id: "g1",
      gender: "M",
      status: "active",
      employeeType: "security_officer",
    };
    const calendarDays = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-03T23:59:59.999Z")
    );
    const runtime = emptyRuntime({
      workedDateKeys: new Set(["2026-05-02"]),
      shiftTypeByDateKey: new Map([["2026-05-02", "night"]]),
    });
    const daySlot = {
      siteId: "site-1",
      postId: "p-day",
      date: new Date("2026-05-01T00:00:00.000Z"),
      dateKey: "2026-05-01",
      shiftType: "day" as const,
      requiredGender: null,
      difficultyScore: 0,
    };
    const shiftStart = new Date("2026-05-01T04:00:00.000Z");
    const shiftEnd = new Date("2026-05-01T16:00:00.000Z");
    expect(
      isGuardEligibleForSlot({
        guard,
        slot: daySlot,
        siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
        postShiftType: "day",
        siteAssignedGuardIds: new Set(["g1"]),
        existingShifts: [],
        runtime,
        shiftStart,
        shiftEnd,
        calendarDays,
        dayIndex: 0,
        prevDateKey: null,
      })
    ).toBe(true);
  });

  it("isGuardEligibleForSlot rejects guards on approved leave", () => {
    const slot = {
      siteId: "site-1",
      postId: "p1",
      date: new Date("2026-07-20T00:00:00.000Z"),
      dateKey: "2026-07-20",
      shiftType: "day" as const,
      requiredGender: null,
      difficultyScore: 0,
    };
    const guard: GuardCandidate = {
      id: "g1",
      gender: "M",
      status: "active",
      employeeType: "security_officer",
    };
    const shiftStart = new Date("2026-07-20T04:00:00.000Z");
    const shiftEnd = new Date("2026-07-20T16:00:00.000Z");
    const calendarDays = buildCalendarDays(
      new Date("2026-07-20T00:00:00.000Z"),
      new Date("2026-07-20T23:59:59.999Z")
    );
    const leaveDateKeysByEmployee = new Map([["g1", new Set(["2026-07-20"])]]);

    expect(
      isGuardEligibleForSlot({
        guard,
        slot,
        siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
        postShiftType: "day",
        siteAssignedGuardIds: new Set(["g1"]),
        existingShifts: [],
        runtime: emptyRuntime(),
        shiftStart,
        shiftEnd,
        calendarDays,
        dayIndex: 0,
        prevDateKey: null,
        leaveDateKeysByEmployee,
      })
    ).toBe(false);

    const reasons = explainGuardIneligibilityForSlot({
      guard,
      slot,
      siteGenderRules: { rosterDayShiftGender: null, rosterNightShiftGender: null },
      postShiftType: "day",
      siteAssignedGuardIds: new Set(["g1"]),
      existingShifts: [],
      runtime: emptyRuntime(),
      shiftStart,
      shiftEnd,
      calendarDays,
      dayIndex: 0,
      leaveDateKeysByEmployee,
    });
    expect(reasons).toContain("on leave (not available for work)");
  });

  it("violatesAdjacentShiftRestRules blocks night-then-day but allows day-then-night", () => {
    const dayThenNight = new Map<string, "day" | "night">([["2026-05-01", "day"]]);
    expect(
      violatesAdjacentShiftRestRules(dayThenNight, { dateKey: "2026-05-02", shiftType: "night" })
    ).toBe(false);

    const nightThenDay = new Map<string, "day" | "night">([["2026-05-01", "night"]]);
    expect(
      violatesAdjacentShiftRestRules(nightThenDay, { dateKey: "2026-05-02", shiftType: "day" })
    ).toBe(true);
  });

  it("deriveSiteRotationBlocks picks 3D-3N-3O for three guards at equal staffing", () => {
    const blocks = deriveSiteRotationBlocks(3, { day: 1, night: 1 });
    expect(formatRotationPatternLabel(blocks)).toBe("3D-3N-3O");
  });

  it("deriveSiteRotationBlocks picks proportional cycle for unequal staffing", () => {
    const blocks = deriveSiteRotationBlocks(5, { day: 1, night: 2 });
    expect(formatRotationPatternLabel(blocks)).toBe("1D-2N-2O");
  });

  it("buildSiteRotationPlan staggers three guards on 3D-3N-3O", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-09T23:59:59.999Z");
    const days = buildCalendarDays(start, end);
    const plan = buildSiteRotationPlan({
      guardIds: ["g1", "g2", "g3"],
      calendarDays: days,
      staffing: { day: 1, night: 1 },
      blocks: [
        { type: "day", count: 3 },
        { type: "night", count: 3 },
        { type: "off", count: 3 },
      ],
    });
    expect(plan?.patternLabel).toBe("3D-3N-3O");
    expect([...plan!.staggerOffsets.values()].sort((a, b) => a - b)).toEqual([0, 3, 6]);
    expect(plan?.preferenceGrid.get("g1")?.get("2026-05-01")).toBe("day");
    expect(plan?.preferenceGrid.get("g2")?.get("2026-05-01")).toBe("night");
    expect(plan?.preferenceGrid.get("g3")?.get("2026-05-01")).toBe("off");
  });

  it("dayNightBalanceDelta prefers guards below on the shift type being filled", () => {
    const balanced = { employeeId: "a", dayCount: 6, nightCount: 6, offCount: 0, sundayCount: 0, weekendCount: 0 };
    const dayHeavy = { employeeId: "b", dayCount: 10, nightCount: 4, offCount: 0, sundayCount: 0, weekendCount: 0 };
    expect(dayNightBalanceDelta(balanced, "day")).toBeCloseTo(0);
    expect(dayNightBalanceDelta(balanced, "night")).toBeCloseTo(0);
    expect(dayNightBalanceDelta(dayHeavy, "day")).toBeGreaterThan(0);
    expect(dayNightBalanceDelta(dayHeavy, "night")).toBeLessThan(0);
  });

  it("scoreGuardFairness prefers guard below shift-type target", () => {
    const targets = computeFairnessTargets(2, buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-14T23:59:59.999Z")
    ), { day: 1, night: 1 });
    const underTarget = {
      employeeId: "g1",
      dayCount: 0,
      nightCount: 0,
      offCount: 0,
      sundayCount: 0,
      weekendCount: 0,
    };
    const overTarget = {
      employeeId: "g2",
      dayCount: 8,
      nightCount: 0,
      offCount: 0,
      sundayCount: 0,
      weekendCount: 0,
    };
    const slot = {
      siteId: "s",
      postId: "p",
      date: new Date("2026-05-05T00:00:00.000Z"),
      dateKey: "2026-05-05",
      shiftType: "day" as const,
      requiredGender: null,
      difficultyScore: 0,
    };
    const guard: GuardCandidate = { id: "g1", gender: "M", status: "active", employeeType: "security_officer" };
    const staffing = { day: 1, night: 1 };
    const low = scoreGuardFairness({
      guard,
      slot,
      date: slot.date,
      stats: underTarget,
      targets,
      assignedToPost: false,
      workedPreviousDay: false,
      staffing,
      consecutiveSameShiftBefore: 0,
    });
    const high = scoreGuardFairness({
      guard: { ...guard, id: "g2" },
      slot,
      date: slot.date,
      stats: overTarget,
      targets,
      assignedToPost: false,
      workedPreviousDay: false,
      staffing,
      consecutiveSameShiftBefore: 0,
    });
    expect(low).toBeLessThan(high);
  });

  it("maxConsecutiveShiftTypeInPattern returns 3 for 3D3N3O", () => {
    expect(maxConsecutiveShiftTypeInPattern("3_on_3_off")).toEqual({ day: 3, night: 3 });
  });

  it("pickBestGuardForDemandSlot selects guard with fewer night shifts for night slot", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-05T23:59:59.999Z");
    const calendarDays = buildCalendarDays(start, end);
    const guardA: GuardCandidate = { id: "g1", gender: "M", status: "active", employeeType: "security_officer" };
    const guardB: GuardCandidate = { id: "g2", gender: "F", status: "active", employeeType: "security_officer" };
    const statsByGuard = new Map([
      ["g1", { employeeId: "g1", dayCount: 2, nightCount: 0, offCount: 0, sundayCount: 0, weekendCount: 0 }],
      ["g2", { employeeId: "g2", dayCount: 2, nightCount: 3, offCount: 0, sundayCount: 0, weekendCount: 0 }],
    ]);
    const runtimeByGuard = new Map([
      ["g1", emptyRuntime({ stats: statsByGuard.get("g1")! })],
      ["g2", emptyRuntime({ stats: statsByGuard.get("g2")! })],
    ]);
    const slot = {
      siteId: "s",
      postId: "p",
      date: new Date("2026-05-01T00:00:00.000Z"),
      dateKey: "2026-05-01",
      shiftType: "night" as const,
      requiredGender: null,
      difficultyScore: 0,
    };
    const picked = pickBestGuardForDemandSlot({
      candidates: [guardA, guardB],
      slot,
      date: slot.date,
      dayIndex: 0,
      statsByGuard,
      runtimeByGuard,
      targets: computeFairnessTargets(2, calendarDays, { day: 1, night: 1 }),
      postAssignedGuardIds: new Set(),
      prevDateKey: null,
      staffing: { day: 1, night: 1 },
      calendarDays,
    });
    expect(picked?.id).toBe("g1");
  });

  it("pickBestGuardForDemandSlot deprioritizes relievers among eligible guards", () => {
    const diagnostics = buildRosterReadinessDiagnostics({
      dayPostCount: 2,
      nightPostCount: 1,
      staffing: { day: 2, night: 2 },
      rosterableGuardCount: 3,
      relieverCount: 0,
      guardsMissingGender: 0,
      hasRestrictiveGenderRules: false,
    });
    expect(diagnostics.some((d) => d.code === "WARNING_STRICT_REST_STAFFING")).toBe(true);
  });

  it("pickBestGuardForDemandSlot deprioritizes relievers among eligible guards", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-14T23:59:59.999Z");
    const calendarDays = buildCalendarDays(start, end);
    const dateKey = "2026-05-01";
    const stats = {
      employeeId: "x",
      dayCount: 0,
      nightCount: 0,
      offCount: 0,
      sundayCount: 0,
      weekendCount: 0,
    };
    const statsByGuard = new Map([
      ["g-active", { ...stats, employeeId: "g-active" }],
      ["g-reliever", { ...stats, employeeId: "g-reliever" }],
    ]);
    const runtimeByGuard = new Map([
      ["g-active", emptyRuntime({ stats: statsByGuard.get("g-active")! })],
      ["g-reliever", emptyRuntime({ stats: statsByGuard.get("g-reliever")! })],
    ]);
    const slot = {
      siteId: "s",
      postId: "p",
      date: new Date("2026-05-01T00:00:00.000Z"),
      dateKey,
      shiftType: "day" as const,
      requiredGender: null,
      difficultyScore: 0,
    };
    const active: GuardCandidate = {
      id: "g-active",
      gender: "M",
      status: "active",
      employeeType: "security_officer",
    };
    const reliever: GuardCandidate = {
      id: "g-reliever",
      gender: "M",
      status: "reliever",
      employeeType: "security_officer",
    };
    const picked = pickBestGuardForDemandSlot({
      candidates: [reliever, active],
      slot,
      date: slot.date,
      dayIndex: 0,
      statsByGuard,
      runtimeByGuard,
      targets: computeFairnessTargets(2, calendarDays, { day: 1, night: 1 }),
      postAssignedGuardIds: new Set(),
      prevDateKey: null,
      staffing: { day: 1, night: 1 },
      calendarDays,
    });
    expect(picked?.id).toBe("g-active");
  });

  it("scoreGuardForDemandSlot prefers assigned post", () => {
    const targets = computeFairnessTargets(2, buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-14T23:59:59.999Z")
    ));
    const stats = {
      employeeId: "g1",
      dayCount: 0,
      nightCount: 0,
      offCount: 0,
      sundayCount: 0,
      weekendCount: 0,
    };
    const slot = {
      siteId: "s",
      postId: "p",
      date: new Date("2026-05-05T00:00:00.000Z"),
      dateKey: "2026-05-05",
      shiftType: "day" as const,
      requiredGender: null,
      difficultyScore: 0,
    };
    const guard: GuardCandidate = { id: "g1", gender: "M", status: "active", employeeType: "security_officer" };
    const staffing = { day: 1, night: 1 };
    const base = scoreGuardForDemandSlot({
      guard,
      slot,
      date: slot.date,
      stats,
      targets,
      preference: "off",
      assignedToPost: false,
      workedPreviousDay: false,
      staffing,
      consecutiveSameShiftBefore: 0,
    });
    const assigned = scoreGuardForDemandSlot({
      guard,
      slot,
      date: slot.date,
      stats,
      targets,
      preference: "day",
      assignedToPost: true,
      workedPreviousDay: false,
      staffing,
      consecutiveSameShiftBefore: 0,
    });
    expect(assigned).toBeLessThan(base);
  });

  it("validateDailyCoverage enforces minimum guards per shift", () => {
    const days = buildCalendarDays(
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-01T23:59:59.999Z")
    );
    const uncovered = validateDailyCoverage(
      [
        { startTime: "2026-05-01T04:00:00.000Z", shiftType: "day" },
        { startTime: "2026-05-01T16:00:00.000Z", shiftType: "night" },
      ],
      days,
      { day: 2, night: 1 }
    );
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0]!.missing).toEqual(["day"]);
    expect(uncovered[0]!.counts?.day).toBe(1);
    expect(uncovered[0]!.required?.day).toBe(2);
  });
});
