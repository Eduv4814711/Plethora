import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    site: { findFirst: vi.fn() },
    shift: { findMany: vi.fn(), count: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    employee: { findMany: vi.fn() },
    sitePost: { findMany: vi.fn() },
    siteAssignment: { findMany: vi.fn() },
    company: { findUnique: vi.fn() },
    leaveRecord: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../lib/roster-audit.js", () => ({
  auditRosterGeneration: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/timezone.js", () => ({
  getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg"),
  dateKeyInTimeZone: (d: Date) => d.toISOString().slice(0, 10),
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

function makePost(
  id: string,
  name: string,
  shiftType: "day" | "night",
  eligibleEmployeeIds: string[] = []
) {
  return {
    id,
    name,
    siteId,
    guardEligibilities: eligibleEmployeeIds.map((employeeId) => ({ employeeId })),
    coverageRequirements: [{ shiftTypeCode: shiftType, isEnabled: true }],
  };
}

function mockSite(overrides: Record<string, unknown> = {}) {
  return {
    id: siteId,
    companyId,
    name: "Test Site",
    rosterDayShiftGender: null,
    rosterNightShiftGender: null,
    posts: [makePost("post-day", "Day 1", "day"), makePost("post-night", "Night 1", "night")],
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
    vi.mocked(prisma.leaveRecord.findMany).mockReset();
    vi.mocked(prisma.shift.findMany).mockResolvedValue([]);
    vi.mocked(prisma.shift.count).mockResolvedValue(0);
    vi.mocked(prisma.leaveRecord.findMany).mockResolvedValue([]);
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
    });

    expect(plan.entries).toHaveLength(0);
    expect(plan.warnings.some((w) => w.code === "NO_SITE_GUARDS")).toBe(true);
  });

  it("achieves 100% coverage for 3 guards over June roster period (26 May – 25 Jun)", async () => {
    const periodStart = new Date("2026-05-26T00:00:00.000Z");
    const periodEnd = new Date("2026-06-25T23:59:59.999Z");
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(3) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate: periodStart,
      endDate: periodEnd,
    });

    expect(plan.summary.rotationPattern).toBe("3D-3N-3O");
    expect(plan.summary.demandSlotsTotal).toBe(62);
    expect(plan.summary.shiftsPlanned).toBe(62);
    expect(plan.summary.coveragePercent).toBe(100);
    expect(plan.summary.uncoveredSlots).toBe(0);
    expect(plan.warnings.filter((w) => w.code === "UNCOVERED_SLOT")).toHaveLength(0);
  });

  it("uses 3D-3N-3O rotation for three site guards", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(3) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: new Date("2026-05-14T23:59:59.999Z"),
    });

    expect(plan.summary.rotationPattern).toBe("3D-3N-3O");
    expect(plan.summary.rotationRecommendation?.strategy).toBe("equal_rotation");
    expect(plan.summary.coveragePercent).toBe(100);
  });

  it("plans dual-pattern shifts for multiple site guards with stagger", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(mockSite() as never);

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
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
          makePost("post-day-a", "Day A", "day"),
          makePost("post-day-b", "Day B", "day"),
          makePost("post-night", "Night", "night"),
        ],
        assignedGuards: makeGuards(6),
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
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
          makePost("post-day-a", "Day A", "day", ["g1"]),
          makePost("post-day-b", "Day B", "day"),
          makePost("post-night", "Night", "night", ["g1"]),
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
    });

    const dayEntries = plan.entries.filter((e) => e.shiftType === "day");
    expect(dayEntries.length).toBeGreaterThan(0);
    expect(dayEntries.every((e) => e.postId === "post-day-a")).toBe(true);
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
    });

    expect(plan.warnings.some((w) => w.code === "INSUFFICIENT_GUARDS")).toBe(true);
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
    });

    expect(plan.summary.demandSlotsTotal).toBe(28);
    expect(plan.entries.length).toBeGreaterThan(0);
    expect(plan.summary.coveragePercent).toBeGreaterThanOrEqual(50);
  });

  it("returns empty plan when site has no night post", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        posts: [makePost("post-day", "Day 1", "day")],
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
    });

    expect(plan.entries).toHaveLength(0);
    expect(plan.warnings.some((w) => w.code === "MISSING_POSTS")).toBe(true);
  });

  it("plans day-only slots when night staffing is 0 and no night post", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        rosterNightShiftGuardsRequired: 0,
        posts: [makePost("post-day", "Day 1", "day")],
        assignedGuards: makeGuards(3),
      }) as never
    );
    vi.mocked(prisma.shift.findMany).mockResolvedValue([]);
    vi.mocked(prisma.shift.count).mockResolvedValue(0);

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
    });

    expect(plan.warnings.some((w) => w.code === "MISSING_POSTS")).toBe(false);
    expect(plan.entries.length).toBeGreaterThan(0);
    expect(plan.entries.every((e) => e.shiftType === "day")).toBe(true);
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
    });

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

  it("balances day and night counts across guards over a full month", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(4) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: monthEnd,
    });

    expect(plan.summary.rotationRecommendation?.recommendedPatternLabel).toBe("2D-2N-4O");
    expect(plan.summary.fairnessSpread.maxDayMinusMinDay).toBeLessThanOrEqual(4);
    expect(plan.summary.fairnessSpread.maxNightMinusMinNight).toBeLessThanOrEqual(4);
    expect(plan.summary.fairnessSpread.maxDayNightImbalance).toBeLessThanOrEqual(4);
  });

  it("keeps day and night counts equal per guard for 5 guards with 1 day and 1 night per day", async () => {
    const periodStart = new Date("2026-05-26T00:00:00.000Z");
    const periodEnd = new Date("2026-06-25T23:59:59.999Z");
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        rosterDayShiftGuardsRequired: 1,
        rosterNightShiftGuardsRequired: 1,
        assignedGuards: makeGuards(5),
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate: periodStart,
      endDate: periodEnd,
    });

    expect(plan.summary.demandSlotsTotal).toBe(62);
    expect(plan.summary.coveragePercent).toBe(100);
    expect(plan.summary.fairnessSpread.maxDayNightImbalance).toBeLessThanOrEqual(3);
    for (const stat of plan.guardStats ?? []) {
      expect(Math.abs(stat.dayCount - stat.nightCount)).toBeLessThanOrEqual(2);
    }
  });

  it("minimises day/night gap per guard when night staffing exceeds day staffing", async () => {
    const periodStart = new Date("2026-05-26T00:00:00.000Z");
    const periodEnd = new Date("2026-06-25T23:59:59.999Z");
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        rosterDayShiftGuardsRequired: 1,
        rosterNightShiftGuardsRequired: 2,
        posts: [
          makePost("post-day", "Day 1", "day"),
          makePost("post-night-1", "Night 1", "night"),
          makePost("post-night-2", "Night 2", "night"),
        ],
        assignedGuards: makeGuards(5),
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate: periodStart,
      endDate: periodEnd,
    });

    expect(plan.summary.demandSlotsTotal).toBe(93);
    expect(plan.summary.coveragePercent).toBeGreaterThanOrEqual(99);
    expect(plan.summary.uncoveredSlots).toBeLessThanOrEqual(1);
    expect(plan.summary.fairnessSpread.maxDayNightImbalance).toBeLessThanOrEqual(8);
    expect(plan.summary.fairnessSpread.maxDayMinusMinDay).toBeLessThanOrEqual(3);
    expect(plan.summary.fairnessSpread.maxNightMinusMinNight).toBeLessThanOrEqual(3);
    for (const stat of plan.guardStats ?? []) {
      expect(Math.abs(stat.dayCount - stat.nightCount)).toBeLessThanOrEqual(8);
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
    });

    expect(plan.summary.rotationRecommendation?.recommendedPatternLabel).toBe("3D-3N-3O");
    expect(plan.summary.fairnessSpread.maxDayMinusMinDay).toBeLessThanOrEqual(3);
    expect(plan.summary.fairnessSpread.maxNightMinusMinNight).toBeLessThanOrEqual(3);
  });

  it("recommends core plus reliever pool for five guards by default", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({ assignedGuards: makeGuards(5) }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
    });

    expect(plan.summary.rotationRecommendation?.strategy).toBe("core_with_relievers");
    expect(plan.summary.rotationRecommendation?.coreGuardCount).toBe(4);
    expect(plan.summary.rotationRecommendation?.relieverGuardCount).toBe(1);
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
    });

    expect(plan.summary.fairnessSpread.maxSundayMinusMinSunday).toBeLessThanOrEqual(4);
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

  it("does not assign overlapping shifts to the same guard on the same calendar day", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(mockSite() as never);

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate,
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
    });

    const relieverEntries = plan.entries.filter((e) => e.employeeId === "g-reliever");
    const activeEntries = plan.entries.filter((e) => e.employeeId.startsWith("g-active"));
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
    });

    const dayUncovered = plan.warnings.filter(
      (w) => w.code === "UNCOVERED_DAY" && w.message.includes("day")
    );
    expect(dayUncovered.length).toBeGreaterThan(0);
    expect(plan.entries.filter((e) => e.shiftType === "day").length).toBe(0);
    expect(plan.entries.filter((e) => e.shiftType === "night").length).toBeGreaterThan(0);
  });

  it("populates conflicts when slots cannot be filled", async () => {
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
    });

    expect(plan.conflicts.length).toBeGreaterThan(0);
    expect(plan.conflicts.some((c) => c.reason.includes("day"))).toBe(true);
    expect(plan.summary.demandSlotsTotal).toBeGreaterThan(0);
  });

  it("fills day slots fairly when staffing exceeds guard count", async () => {
    const weekEnd = new Date("2026-05-07T23:59:59.999Z");
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockSite({
        rosterDayShiftGuardsRequired: 2,
        rosterNightShiftGuardsRequired: 1,
        assignedGuards: makeGuards(3),
      }) as never
    );

    const plan = await generateRosterPlan({
      companyId,
      siteId,
      startDate,
      endDate: weekEnd,
    });

    expect(plan.summary.shiftsPlanned).toBeGreaterThan(0);
    expect(plan.summary.coveragePercent).toBeGreaterThan(50);
    expect(plan.summary.fairnessSpread.maxDayMinusMinDay).toBeLessThanOrEqual(3);
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
        maxDayNightImbalance: 0,
      },
    },
    warnings: [],
    conflicts: [],
  };

  beforeEach(() => {
    vi.mocked(prisma.site.findFirst).mockReset();
    vi.mocked(prisma.employee.findMany).mockReset();
    vi.mocked(prisma.sitePost.findMany).mockReset();
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

    vi.mocked(prisma.sitePost.findMany).mockResolvedValue([
      {
        id: "post-day",
        name: "Day 1",
        siteId,
        coverageRequirements: [{ shiftTypeCode: "day", isEnabled: true }],
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
