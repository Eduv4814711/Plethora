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
  computeStaggerOffsets,
  getConsecutiveWorkDaysBefore,
  getPatternShiftAtOffset,
  isGuardEligibleForSlot,
  pickBestGuardForDemandSlot,
  scoreGuardForDemandSlot,
  scoreGuardForSlot,
  validateDailyCoverage,
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

  it("computeStaggerOffsets spaces phases across the cycle", () => {
    expect(computeStaggerOffsets(3, 9)).toEqual([0, 3, 6]);
    expect(computeStaggerOffsets(2, 9)).toEqual([0, 4]);
    expect(computeStaggerOffsets(5, 9)).toEqual([0, 1, 3, 5, 7]);
  });

  it("getPatternShiftAtOffset follows 3_on_3_off cycle", () => {
    expect(getPatternShiftAtOffset(0, "3_on_3_off")).toBe("day");
    expect(getPatternShiftAtOffset(2, "3_on_3_off")).toBe("day");
    expect(getPatternShiftAtOffset(3, "3_on_3_off")).toBe("night");
    expect(getPatternShiftAtOffset(6, "3_on_3_off")).toBe("off");
    expect(getPatternShiftAtOffset(8, "3_on_3_off")).toBe("off");
    expect(getPatternShiftAtOffset(9, "3_on_3_off")).toBe("day");
  });

  it("preference grid respects stagger offsets", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-05T23:59:59.999Z");
    const days = buildCalendarDays(start, end);
    const grid = buildPatternPreferenceGrid({
      guardIds: ["g1", "g2"],
      calendarDays: days,
      patternStartDate: start,
      pattern: "3_on_3_off",
      staggerOffsets: new Map([
        ["g1", 0],
        ["g2", 1],
      ]),
    });
    expect(grid.get("g1")!.get("2026-05-01")).toBe("day");
    expect(grid.get("g2")!.get("2026-05-01")).toBe("off");
    expect(grid.get("g2")!.get("2026-05-02")).toBe("day");
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
      employeeType: "security",
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
      employeeType: "security",
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
      employeeType: "security",
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

  it("rejects assignment on 7th consecutive work day", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-10T23:59:59.999Z");
    const calendarDays = buildCalendarDays(start, end);
    const worked = new Set<string>();
    const shiftTypes = new Map<string, "day" | "night">();
    for (let i = 0; i < MAX_CONSECUTIVE_WORK_DAYS; i++) {
      const key = calendarDays[i]!.toISOString().slice(0, 10);
      worked.add(key);
      shiftTypes.set(key, "day");
    }
    const dayIndex = MAX_CONSECUTIVE_WORK_DAYS;
    const dateKey = calendarDays[dayIndex]!.toISOString().slice(0, 10);
    expect(getConsecutiveWorkDaysBefore(worked, calendarDays, dayIndex)).toBe(
      MAX_CONSECUTIVE_WORK_DAYS
    );
    expect(
      wouldViolateRestRules({
        slot: { dateKey, shiftType: "day" },
        runtime: emptyRuntime({ workedDateKeys: worked, shiftTypeByDateKey: shiftTypes }),
        prevDateKey: calendarDays[dayIndex - 1]!.toISOString().slice(0, 10),
        calendarDays,
        dayIndex,
      })
    ).toBe(true);
  });

  it("pickBestGuardForDemandSlot returns null when only pattern-misaligned candidates exist", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-05T23:59:59.999Z");
    const calendarDays = buildCalendarDays(start, end);
    const grid = buildPatternPreferenceGrid({
      guardIds: ["g1"],
      calendarDays,
      patternStartDate: start,
      pattern: "3_on_3_off",
      staggerOffsets: new Map([["g1", 0]]),
    });
    const guard: GuardCandidate = { id: "g1", gender: "M", status: "active", employeeType: "security" };
    const statsByGuard = new Map([
      [
        "g1",
        {
          employeeId: "g1",
          dayCount: 0,
          nightCount: 0,
          offCount: 0,
          sundayCount: 0,
          weekendCount: 0,
        },
      ],
    ]);
    const runtimeByGuard = new Map([["g1", emptyRuntime({ stats: statsByGuard.get("g1")! })]]);
    const slot = {
      siteId: "s",
      postId: "p",
      date: new Date("2026-05-01T00:00:00.000Z"),
      dateKey: "2026-05-01",
      shiftType: "night" as const,
      requiredGender: null,
      difficultyScore: 0,
    };
    expect(grid.get("g1")!.get("2026-05-01")).toBe("day");
    const picked = pickBestGuardForDemandSlot({
      candidates: [guard],
      slot,
      date: slot.date,
      dayIndex: 0,
      statsByGuard,
      runtimeByGuard,
      targets: computeFairnessTargets(1, calendarDays),
      preferenceGrid: grid,
      postAssignedGuardIds: new Set(),
      prevDateKey: null,
    });
    expect(picked).toBeNull();
  });

  it("buildRosterReadinessDiagnostics warns strict rest when day+night staffing exceeds guards", () => {
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

  it("pickBestGuardForDemandSlot deprioritizes relievers among pattern-aligned guards", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-14T23:59:59.999Z");
    const calendarDays = buildCalendarDays(start, end);
    const grid = buildPatternPreferenceGrid({
      guardIds: ["g-active", "g-reliever"],
      calendarDays,
      patternStartDate: start,
      pattern: "3_on_3_off",
      staggerOffsets: new Map([
        ["g-active", 0],
        ["g-reliever", 0],
      ]),
    });
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
      employeeType: "security",
    };
    const reliever: GuardCandidate = {
      id: "g-reliever",
      gender: "M",
      status: "reliever",
      employeeType: "security",
    };
    expect(grid.get("g-active")!.get(dateKey)).toBe("day");
    const picked = pickBestGuardForDemandSlot({
      candidates: [reliever, active],
      slot,
      date: slot.date,
      dayIndex: 0,
      statsByGuard,
      runtimeByGuard,
      targets: computeFairnessTargets(2, calendarDays),
      preferenceGrid: grid,
      postAssignedGuardIds: new Set(),
      prevDateKey: null,
    });
    expect(picked?.id).toBe("g-active");
  });

  it("scoreGuardForDemandSlot prefers assigned post and pattern match", () => {
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
    const guard: GuardCandidate = { id: "g1", gender: "M", status: "active", employeeType: "security" };
    const base = scoreGuardForDemandSlot({
      guard,
      slot,
      date: slot.date,
      stats,
      targets,
      preference: "off",
      assignedToPost: false,
      workedPreviousDay: false,
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
