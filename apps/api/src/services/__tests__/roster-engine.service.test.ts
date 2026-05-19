import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    site: { findFirst: vi.fn() },
    shift: { findMany: vi.fn() },
    company: { findUnique: vi.fn() },
  },
}));

vi.mock("../../lib/timezone.js", () => ({
  getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg"),
  getShiftTimes: vi.fn((date: Date, shiftType: "day" | "night") => {
    const start = new Date(date);
    start.setUTCHours(shiftType === "day" ? 4 : 16, 0, 0, 0);
    const end = new Date(date);
    end.setUTCHours(shiftType === "day" ? 16 : 28, 0, 0, 0);
    return { shiftStart: start, shiftEnd: end };
  }),
}));

import { differenceInCalendarDays } from "date-fns";
import { prisma } from "../../lib/prisma.js";
import { getPatternShiftAtOffset } from "../roster-scheduler.js";
import {
  buildEmployeePostAssignmentMap,
  generateRosterPlan,
  resolvePostForShiftSlot,
} from "../roster-engine.service.js";
import type { PostWithAssignments } from "../roster-engine.service.js";

const companyId = "co-1";
const siteId = "site-1";
const startDate = new Date("2026-05-01T00:00:00.000Z");
const endDate = new Date("2026-05-14T23:59:59.999Z");
const monthEnd = new Date("2026-05-31T23:59:59.999Z");

function makeGuards(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    employee: {
      id: `g${i + 1}`,
      firstName: `Guard`,
      lastName: `${i + 1}`,
      status: "active",
      gender: "M",
      employeeType: "security",
    },
  }));
}

function mockSite(overrides: Record<string, unknown> = {}) {
  return {
    id: siteId,
    companyId,
    name: "Test Site",
    rosterDayShiftGender: null,
    rosterNightShiftGender: null,
    posts: [
      { id: "post-day", name: "Day 1", shiftType: "day", siteId, assignedGuards: [] },
      { id: "post-night", name: "Night 1", shiftType: "night", siteId, assignedGuards: [] },
    ],
    assignedGuards: [
      {
        employee: {
          id: "g1",
          firstName: "A",
          lastName: "One",
          status: "active",
          gender: "M",
          employeeType: "security",
        },
      },
      {
        employee: {
          id: "g2",
          firstName: "B",
          lastName: "Two",
          status: "active",
          gender: "F",
          employeeType: "security",
        },
      },
    ],
    ...overrides,
  };
}

describe("generateRosterPlan", () => {
  beforeEach(() => {
    vi.mocked(prisma.site.findFirst).mockReset();
    vi.mocked(prisma.shift.findMany).mockReset();
    vi.mocked(prisma.shift.findMany).mockResolvedValue([]);
  });

  it("returns empty plan with warning when no site guards", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: [] }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    expect(plan.entries).toHaveLength(0);
    expect(plan.warnings.some((w) => w.code === "NO_SITE_GUARDS")).toBe(true);
  });

  it("plans dual-pattern shifts for multiple site guards with stagger", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(mockSite() as never);

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    expect(plan.summary.guardsConsidered).toBe(2);
    expect(plan.summary.shiftsPlanned).toBeGreaterThan(0);
    expect(plan.entries.length).toBe(plan.summary.shiftsPlanned);

    const g1Starts = plan.entries.filter((e) => e.employeeId === "g1").map((e) => e.startTime);
    const g2Starts = plan.entries.filter((e) => e.employeeId === "g2").map((e) => e.startTime);
    expect(g1Starts[0]).not.toBe(g2Starts[0]);
  });

  it("records gender rule conflicts without throwing", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        rosterDayShiftGender: "female",
        rosterNightShiftGender: "any",
        assignedGuards: [
          {
            employee: {
              id: "g-male",
              firstName: "M",
              lastName: "Guard",
              status: "active",
              gender: "M",
              employeeType: "security",
            },
          },
        ],
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    const dayConflicts = plan.conflicts.filter((c) => c.reason.includes("day"));
    expect(dayConflicts.length).toBeGreaterThan(0);
    expect(plan.entries.filter((e) => e.shiftType === "day")).toHaveLength(0);
  });

  it("round-robins across multiple day posts", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        posts: [
          { id: "post-day-a", name: "Day A", shiftType: "day", siteId, assignedGuards: [] },
          { id: "post-day-b", name: "Day B", shiftType: "day", siteId, assignedGuards: [] },
          { id: "post-night", name: "Night", shiftType: "night", siteId, assignedGuards: [] },
        ],
        assignedGuards: [
          {
            employee: {
              id: "g1",
              firstName: "A",
              lastName: "One",
              status: "active",
              gender: "M",
              employeeType: "security",
            },
          },
        ],
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    const dayPostIds = new Set(
      plan.entries.filter((e) => e.shiftType === "day").map((e) => e.postId)
    );
    expect(dayPostIds.size).toBeGreaterThan(1);
  });

  it("uses PostAssignment instead of site-wide round-robin when set", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        posts: [
          {
            id: "post-day-a",
            name: "Day A",
            shiftType: "day",
            siteId,
            assignedGuards: [{ employeeId: "g1" }],
          },
          {
            id: "post-day-b",
            name: "Day B",
            shiftType: "day",
            siteId,
            assignedGuards: [],
          },
          {
            id: "post-night",
            name: "Night",
            shiftType: "night",
            siteId,
            assignedGuards: [{ employeeId: "g1" }],
          },
        ],
        assignedGuards: [
          {
            employee: {
              id: "g1",
              firstName: "A",
              lastName: "One",
              status: "active",
              gender: "M",
              employeeType: "security",
            },
          },
        ],
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    const dayEntries = plan.entries.filter((e) => e.shiftType === "day");
    expect(dayEntries.length).toBeGreaterThan(0);
    expect(dayEntries.every((e) => e.postId === "post-day-a")).toBe(true);
    expect(plan.guardCycleOffsets).toHaveLength(1);
    expect(plan.guardCycleOffsets[0]?.offsetDays).toBe(0);
  });

  it("includes phase-aligned stagger offsets for two guards", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(mockSite() as never);

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
      options: { staggerGuards: true },
    });

    const offsets = [...plan.guardCycleOffsets].sort(
      (a, b) => a.employeeId.localeCompare(b.employeeId)
    );
    expect(offsets).toHaveLength(2);
    expect(offsets[0]?.offsetDays).toBe(0);
    expect(offsets[1]?.offsetDays).toBe(4);
  });

  it("uses 0, 3, 6 offsets for three guards on 3d3n3o", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(3) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
      options: { staggerGuards: true },
    });

    const offsets = [...plan.guardCycleOffsets]
      .sort((a, b) => a.employeeId.localeCompare(b.employeeId))
      .map((o) => o.offsetDays);
    expect(offsets).toEqual([0, 3, 6]);
  });

  it("emits coverage hint when fewer than three guards on 3d3n3o", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(mockSite() as never);

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    expect(plan.warnings.some((w) => w.code === "PATTERN_COVERAGE_HINT")).toBe(true);
  });

  it("assigns only pattern-matching shifts per guard", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(3) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: monthEnd,
      pattern: "3_on_3_off",
      options: { staggerGuards: true },
    });

    const offsetByGuard = new Map(
      plan.guardCycleOffsets.map((o) => [o.employeeId, o.offsetDays])
    );

    for (const entry of plan.entries) {
      const offset = offsetByGuard.get(entry.employeeId) ?? 0;
      const day = new Date(entry.startTime.slice(0, 10) + "T00:00:00.000Z");
      const dayIndex = differenceInCalendarDays(day, startDate);
      const expected = getPatternShiftAtOffset(dayIndex - offset, "3_on_3_off");
      expect(expected).toBe(entry.shiftType);
    }

    for (let d = 1; d <= 31; d++) {
      const day = new Date(`2026-05-${String(d).padStart(2, "0")}T00:00:00.000Z`);
      const dateKey = day.toISOString().slice(0, 10);
      for (const guardId of ["g1", "g2", "g3"]) {
        const hasShift = plan.entries.some(
          (e) => e.employeeId === guardId && e.startTime.startsWith(dateKey)
        );
        const offset = offsetByGuard.get(guardId) ?? 0;
        const dayIndex = differenceInCalendarDays(day, startDate);
        const expected = getPatternShiftAtOffset(dayIndex - offset, "3_on_3_off");
        if (expected === "off") {
          expect(hasShift).toBe(false);
        }
      }
    }
  });

  it("forms contiguous blocks of three D, N, and O per guard", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(3) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: monthEnd,
      pattern: "3_on_3_off",
      options: { staggerGuards: true },
    });

    const offsetByGuard = new Map(
      plan.guardCycleOffsets.map((o) => [o.employeeId, o.offsetDays])
    );

    for (const guardId of ["g1", "g2", "g3"]) {
      for (let d = 1; d <= 31; d++) {
        const day = new Date(`2026-05-${String(d).padStart(2, "0")}T00:00:00.000Z`);
        const dayIndex = differenceInCalendarDays(day, startDate);
        const offset = offsetByGuard.get(guardId) ?? 0;
        const expected = getPatternShiftAtOffset(dayIndex - offset, "3_on_3_off");
        const dateKey = day.toISOString().slice(0, 10);
        const entry = plan.entries.find(
          (e) => e.employeeId === guardId && e.startTime.startsWith(dateKey)
        );
        const actual = entry ? (entry.shiftType === "day" ? "D" : "N") : "O";
        const expectedLetter = expected === "day" ? "D" : expected === "night" ? "N" : "O";
        expect(actual).toBe(expectedLetter);
      }
    }
  });

  it("covers every day with at least one day and one night shift", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(5) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: monthEnd,
      pattern: "3_on_3_off",
    });

    expect(plan.summary.uncoveredDays).toBe(0);
    expect(plan.warnings.filter((w) => w.code === "UNCOVERED_DAY")).toHaveLength(0);

    const byDate = new Map<string, Set<string>>();
    for (const e of plan.entries) {
      const dk = e.startTime.slice(0, 10);
      if (!byDate.has(dk)) byDate.set(dk, new Set());
      byDate.get(dk)!.add(e.shiftType);
    }
    for (let d = 1; d <= 31; d++) {
      const key = `2026-05-${String(d).padStart(2, "0")}`;
      expect(byDate.get(key)?.has("day")).toBe(true);
      expect(byDate.get(key)?.has("night")).toBe(true);
    }
  });

  it("balances day and night counts across guards with aligned stagger", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(3) }) as never
    );

    const threeCycleEnd = new Date("2026-05-27T23:59:59.999Z");
    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: threeCycleEnd,
      pattern: "3_on_3_off",
      options: { staggerGuards: true },
    });

    expect(plan.summary.fairnessSpread.maxDayMinusMinDay).toBeLessThanOrEqual(1);
    expect(plan.summary.fairnessSpread.maxNightMinusMinNight).toBeLessThanOrEqual(1);
  });

  it("spreads Sunday work across guards", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(5) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: monthEnd,
      pattern: "3_on_3_off",
    });

    expect(plan.summary.fairnessSpread.maxSundayMinusMinSunday).toBeLessThanOrEqual(1);
    const sundayWorkers = (plan.guardStats ?? []).filter((g) => g.sundayCount > 0);
    expect(sundayWorkers.length).toBeGreaterThan(1);
  });

  it("assigns at most one shift per guard per calendar day", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(mockSite() as never);

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    const perGuardDay = new Map<string, number>();
    for (const e of plan.entries) {
      const key = `${e.employeeId}:${e.startTime.slice(0, 10)}`;
      perGuardDay.set(key, (perGuardDay.get(key) ?? 0) + 1);
    }
    for (const count of perGuardDay.values()) {
      expect(count).toBe(1);
    }
  });

  it("warns INSUFFICIENT_GUARDS when only one guard", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        assignedGuards: [makeGuards(1)[0]!],
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    expect(plan.warnings.some((w) => w.code === "INSUFFICIENT_GUARDS")).toBe(true);
  });

  it("emits UNCOVERED_DAY when gender rules block all day candidates", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        rosterDayShiftGender: "female",
        rosterNightShiftGender: "any",
        assignedGuards: makeGuards(2).map((a) => ({
          employee: { ...a.employee, gender: "M" },
        })),
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    const dayUncovered = plan.warnings.filter(
      (w) => w.code === "UNCOVERED_DAY" && w.message.includes("day")
    );
    expect(dayUncovered.length).toBeGreaterThan(0);
    expect(plan.entries.filter((e) => e.shiftType === "day").length).toBe(0);
    expect(plan.entries.filter((e) => e.shiftType === "night").length).toBeGreaterThan(0);
  });
});

describe("resolvePostForShiftSlot", () => {
  const dayA = { id: "day-a", name: "A", shiftType: "day", siteId, assignedGuards: [] } as PostWithAssignments;
  const dayB = { id: "day-b", name: "B", shiftType: "day", siteId, assignedGuards: [] } as PostWithAssignments;
  const night = { id: "night", name: "N", shiftType: "night", siteId, assignedGuards: [] } as PostWithAssignments;

  it("prefers post assigned to the guard", () => {
    const dayAssigned = {
      ...dayA,
      assignedGuards: [{ employeeId: "g1" }],
    };
    const map = buildEmployeePostAssignmentMap([dayAssigned, dayB, night]);

    const post = resolvePostForShiftSlot({
      employeeId: "g1",
      shiftType: "day",
      dayPosts: [dayAssigned, dayB],
      nightPosts: [night],
      assignmentByEmployee: map,
      roundRobin: { day: 0, night: 0 },
    });

    expect(post.id).toBe("day-a");
  });
});
