import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    site: { findFirst: vi.fn() },
    shift: { findMany: vi.fn(), count: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    employee: { findMany: vi.fn() },
    post: { findMany: vi.fn() },
    siteAssignment: { findMany: vi.fn() },
    company: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../lib/roster-audit.js", () => ({
  auditRosterGeneration: vi.fn().mockResolvedValue(undefined),
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

import { prisma } from "../../lib/prisma.js";
import {
  applyRosterPlan,
  buildEmployeePostAssignmentMap,
  generateRosterPlan,
  resolvePostForShiftSlot,
  type RosterPlan,
} from "../roster-engine.service.js";
import { buildSiteDemandSlots, buildCalendarDays } from "../roster-scheduler.js";
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
    vi.mocked(prisma.shift.count).mockReset();
    vi.mocked(prisma.shift.findMany).mockResolvedValue([]);
    vi.mocked(prisma.shift.count).mockResolvedValue(0);
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

  it("plans over existing same-site shifts in the period (replan)", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(mockSite() as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([]);
    vi.mocked(prisma.shift.count).mockResolvedValue(62);

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    expect(plan.summary.shiftsPlanned).toBeGreaterThan(0);
    expect(plan.warnings.some((w) => w.code === "REPLAN_REPLACES_EXISTING")).toBe(true);
  });

  it("leaves day slots uncovered when gender rules block all day candidates", async () => {
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

    expect(plan.warnings.some((w) => w.code === "UNCOVERED_SLOT")).toBe(true);
    expect(plan.entries.filter((e) => e.shiftType === "day")).toHaveLength(0);
    expect(plan.entries.filter((e) => e.shiftType === "night").length).toBeGreaterThan(0);
  });

  it("cycles demand slots across multiple day posts", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        rosterDayShiftGuardsRequired: 2,
        posts: [
          { id: "post-day-a", name: "Day A", shiftType: "day", siteId, assignedGuards: [] },
          { id: "post-day-b", name: "Day B", shiftType: "day", siteId, assignedGuards: [] },
          { id: "post-night", name: "Night", shiftType: "night", siteId, assignedGuards: [] },
        ],
        assignedGuards: makeGuards(6),
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
    expect(plan.summary.patternBreaks).toBe(0);
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

  it("leaves slots uncovered with 5 guards when 5 day and 5 night required (no same-day doubles)", async () => {
    const weekEnd = new Date("2026-05-07T23:59:59.999Z");
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        rosterDayShiftGuardsRequired: 5,
        rosterNightShiftGuardsRequired: 5,
        assignedGuards: makeGuards(5),
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: weekEnd,
      pattern: "3_on_3_off",
    });

    expect(plan.summary.demandSlotsTotal).toBe(70);
    expect(plan.summary.uncoveredSlots).toBeGreaterThan(0);
    expect(plan.warnings.filter((w) => w.code === "UNCOVERED_SLOT").length).toBeGreaterThan(0);

    const doubles = plan.entries.filter((e) => {
      const dk = e.startTime.slice(0, 10);
      return plan.entries.some(
        (o) =>
          o.employeeId === e.employeeId &&
          o.startTime.slice(0, 10) === dk &&
          o.shiftType !== e.shiftType
      );
    });
    expect(doubles).toHaveLength(0);
  });

  it("fills pattern-aligned demand slots for 7 days with 2 day and 2 night staffing", async () => {
    const weekEnd = new Date("2026-05-07T23:59:59.999Z");
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        rosterDayShiftGuardsRequired: 2,
        rosterNightShiftGuardsRequired: 2,
        assignedGuards: makeGuards(6),
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: weekEnd,
      pattern: "3_on_3_off",
    });

    expect(plan.summary.demandSlotsTotal).toBe(28);
    expect(plan.summary.patternBreaks).toBe(0);
    expect(plan.entries.length).toBeGreaterThan(0);
    expect(plan.summary.coveragePercent).toBeGreaterThanOrEqual(50);
  });

  it("returns empty plan when site has no night post", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        posts: [{ id: "post-day", name: "Day 1", shiftType: "day", siteId, assignedGuards: [] }],
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    expect(plan.entries).toHaveLength(0);
    expect(plan.warnings.some((w) => w.code === "MISSING_POSTS")).toBe(true);
  });

  it("covers most days with day and night when enough staggered guards", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(6) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: monthEnd,
      pattern: "3_on_3_off",
    });

    expect(plan.summary.patternBreaks).toBe(0);
    expect(plan.summary.uncoveredDays).toBeLessThanOrEqual(5);

    const byDate = new Map<string, Set<string>>();
    for (const e of plan.entries) {
      const dk = e.startTime.slice(0, 10);
      if (!byDate.has(dk)) byDate.set(dk, new Set());
      byDate.get(dk)!.add(e.shiftType);
    }
    let fullyCoveredDays = 0;
    for (let d = 1; d <= 31; d++) {
      const key = `2026-05-${String(d).padStart(2, "0")}`;
      const types = byDate.get(key);
      if (types?.has("day") && types.has("night")) fullyCoveredDays++;
    }
    expect(fullyCoveredDays).toBeGreaterThan(20);
  });

  it("balances day and night counts across guards with aligned stagger", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(6) }) as never
    );

    const threeCycleEnd = new Date("2026-05-27T23:59:59.999Z");
    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: threeCycleEnd,
      pattern: "3_on_3_off",
    });

    expect(plan.summary.patternBreaks).toBe(0);
    expect(plan.summary.fairnessSpread.maxDayMinusMinDay).toBeLessThanOrEqual(2);
    expect(plan.summary.fairnessSpread.maxNightMinusMinNight).toBeLessThanOrEqual(2);
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

    expect(plan.summary.fairnessSpread.maxSundayMinusMinSunday).toBeLessThanOrEqual(2);
    const sundayWorkers = (plan.guardStats ?? []).filter((g) => g.sundayCount > 0);
    expect(sundayWorkers.length).toBeGreaterThan(1);
  });

  it("never assigns night then day on consecutive calendar days", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(6) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: monthEnd,
      pattern: "3_on_3_off",
    });

    const byGuard = new Map<string, { dateKey: string; shiftType: string }[]>();
    for (const e of plan.entries) {
      const list = byGuard.get(e.employeeId) ?? [];
      list.push({ dateKey: e.startTime.slice(0, 10), shiftType: e.shiftType });
      byGuard.set(e.employeeId, list);
    }
    for (const shifts of byGuard.values()) {
      shifts.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      for (let i = 1; i < shifts.length; i++) {
        const prev = shifts[i - 1]!;
        const curr = shifts[i]!;
        const prevDate = new Date(`${prev.dateKey}T00:00:00.000Z`);
        const currDate = new Date(`${curr.dateKey}T00:00:00.000Z`);
        const diffDays = (currDate.getTime() - prevDate.getTime()) / 86400000;
        if (diffDays === 1) {
          expect(prev.shiftType === "night" && curr.shiftType === "day").toBe(false);
        }
      }
    }
  });

  it("never assigns day and night on the same calendar day for one guard", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(6) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: monthEnd,
      pattern: "3_on_3_off",
    });

    const byGuardDay = new Map<string, Set<string>>();
    for (const e of plan.entries) {
      const key = `${e.employeeId}:${e.startTime.slice(0, 10)}`;
      const types = byGuardDay.get(key) ?? new Set();
      types.add(e.shiftType);
      byGuardDay.set(key, types);
    }
    for (const types of byGuardDay.values()) {
      expect(types.size).toBeLessThanOrEqual(1);
    }
  });

  it("assigns only pattern-aligned shifts (zero pattern breaks)", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(3) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    expect(plan.summary.patternBreaks).toBe(0);
  });

  it("does not assign overlapping shifts to the same guard on the same calendar day", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(mockSite() as never);

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    const byGuardDay = new Map<string, { start: Date; end: Date }[]>();
    for (const e of plan.entries) {
      const key = `${e.employeeId}:${e.startTime.slice(0, 10)}`;
      const list = byGuardDay.get(key) ?? [];
      list.push({ start: new Date(e.startTime), end: new Date(e.endTime) });
      byGuardDay.set(key, list);
    }
    for (const shifts of byGuardDay.values()) {
      for (let i = 0; i < shifts.length; i++) {
        for (let j = i + 1; j < shifts.length; j++) {
          const a = shifts[i]!;
          const b = shifts[j]!;
          const overlap = a.start < b.end && a.end > b.start;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it("warns INSUFFICIENT_GUARDS when guards are below max(day, night) staffing", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        rosterDayShiftGuardsRequired: 2,
        rosterNightShiftGuardsRequired: 2,
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

  it("prefers non-reliever guards before relievers when filling slots", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        assignedGuards: [
          ...makeGuards(6).map((a, i) => ({
            employee: { ...a.employee, id: `g-active-${i + 1}`, status: "active" as const },
          })),
          {
            employee: {
              id: "g-reliever",
              firstName: "Rel",
              lastName: "Iever",
              status: "reliever",
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

    const relieverEntries = plan.entries.filter((e) => e.employeeId === "g-reliever");
    const activeEntries = plan.entries.filter((e) => e.employeeId.startsWith("g-active"));
    expect(plan.summary.patternBreaks).toBe(0);
    if (relieverEntries.length > 0) {
      expect(relieverEntries.length).toBeLessThan(activeEntries.length);
    }
  });

  it("includes readiness diagnostics on the plan", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(mockSite() as never);

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
      pattern: "3_on_3_off",
    });

    expect(plan.readiness?.some((d) => d.code === "OK_DAY_POSTS_EXIST")).toBe(true);
    expect(plan.readiness?.some((d) => d.code === "WARNING_STRICT_REST_STAFFING")).toBe(false);
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

  it("populates conflicts and skippedGuardDays when slots cannot be filled", async () => {
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

    expect(plan.conflicts.length).toBeGreaterThan(0);
    expect(plan.conflicts.some((c) => c.reason.includes("day"))).toBe(true);
    expect(plan.summary.skippedGuardDays).toBeGreaterThan(0);
    expect(plan.summary.demandSlotsTotal).toBeGreaterThan(0);
  });

  it("gap-fills day slots with off-pattern guards when only one guard is on day phase", async () => {
    const weekEnd = new Date("2026-05-07T23:59:59.999Z");
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        rosterDayShiftGuardsRequired: 2,
        rosterNightShiftGuardsRequired: 1,
        assignedGuards: makeGuards(2),
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: weekEnd,
      pattern: "3_on_3_off",
    });

    expect(plan.summary.shiftsPlanned).toBeGreaterThan(0);
    expect(plan.warnings.some((w) => w.code === "PATTERN_BREAK_FILL")).toBe(true);
    expect(plan.summary.patternBreaks).toBeGreaterThan(0);
    expect(plan.summary.coveragePercent).toBeGreaterThan(50);
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

describe("applyRosterPlan", () => {
  const basePlan: RosterPlan = {
    siteId,
    pattern: "3_on_3_off",
    startDate: "2026-05-01",
    endDate: "2026-05-07",
    entries: [
      {
        employeeId: "g1",
        postId: "post-day",
        startTime: "2026-05-01T04:00:00.000Z",
        endTime: "2026-05-01T16:00:00.000Z",
        shiftType: "day",
      },
    ],
    summary: {
      guardsConsidered: 1,
      shiftsPlanned: 1,
      postsUsed: 1,
      skippedGuardDays: 0,
      uncoveredDays: 0,
      fairnessSpread: {
        maxDayMinusMinDay: 0,
        maxNightMinusMinNight: 0,
        maxSundayMinusMinSunday: 0,
      },
    },
    guardCycleOffsets: [],
    warnings: [],
    conflicts: [],
  };

  beforeEach(() => {
    vi.mocked(prisma.site.findFirst).mockReset();
    vi.mocked(prisma.employee.findMany).mockReset();
    vi.mocked(prisma.post.findMany).mockReset();
    vi.mocked(prisma.siteAssignment.findMany).mockReset();
    vi.mocked(prisma.shift.findMany).mockReset();
    vi.mocked(prisma.$transaction).mockReset();

    vi.mocked(prisma.site.findFirst).mockResolvedValue({
      id: siteId,
      companyId,
      posts: [{ id: "post-day" }, { id: "post-night" }],
    } as never);

    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "g1", status: "active", gender: "M" },
    ] as never);

    vi.mocked(prisma.post.findMany).mockResolvedValue([
      {
        id: "post-day",
        siteId,
        shiftType: "day",
        site: { companyId, rosterDayShiftGender: null, rosterNightShiftGender: null },
      },
    ] as never);

    vi.mocked(prisma.siteAssignment.findMany).mockResolvedValue([
      { employeeId: "g1" },
    ] as never);

    vi.mocked(prisma.shift.findMany).mockResolvedValue([]);

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const tx = {
        shift: {
          deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      return fn(tx as never);
    });
  });

  it("creates shifts and replaces existing when replaceExisting is true", async () => {
    const result = await applyRosterPlan({
      companyId,
      userId: "user-1",
      plan: basePlan,
      options: { replaceExisting: true },
    });

    expect(result.deleted).toBe(2);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("throws PLAN_EMPTY when plan has no entries", async () => {
    await expect(
      applyRosterPlan({
        companyId,
        userId: "user-1",
        plan: { ...basePlan, entries: [] },
      })
    ).rejects.toThrow("PLAN_EMPTY");
  });

  it("throws INVALID_POST when entry post is not on site", async () => {
    await expect(
      applyRosterPlan({
        companyId,
        userId: "user-1",
        plan: {
          ...basePlan,
          entries: [{ ...basePlan.entries[0]!, postId: "unknown-post" }],
        },
      })
    ).rejects.toThrow("INVALID_POST");
  });

  it("skips entries that fail validation", async () => {
    vi.mocked(prisma.siteAssignment.findMany).mockResolvedValue([] as never);

    const result = await applyRosterPlan({
      companyId,
      userId: "user-1",
      plan: basePlan,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors?.length).toBe(1);
  });
});
