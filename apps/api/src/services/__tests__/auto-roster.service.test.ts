import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    site: { findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    rosterAutomationRun: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    company: { findMany: vi.fn() },
  },
}));

vi.mock("../roster-engine.service.js", () => ({
  generateRosterPlan: vi.fn(),
  applyRosterPlan: vi.fn(),
}));

vi.mock("../payroll-period.service.js", () => ({
  getPayrollCalendarFromCompanySettings: vi.fn().mockReturnValue({
    payrollPeriod: "monthly",
    payPeriodStartDay: 26,
    payPeriodEndDay: 25,
    autoRosterHorizonPeriods: 2,
  }),
  getRosterWindow: vi.fn().mockReturnValue({
    startDate: new Date("2026-06-18T00:00:00.000Z"),
    endDate: new Date("2026-07-25T00:00:00.000Z"),
    periods: [],
  }),
  formatDateKey: (d: Date) => d.toISOString().slice(0, 10),
}));

import { prisma } from "../../lib/prisma.js";
import { generateRosterPlan, applyRosterPlan } from "../roster-engine.service.js";
import { runAutoRosterForSite } from "../auto-roster.service.js";
import type { RosterPlan } from "../roster-engine.service.js";

const companyId = "co-1";
const siteId = "site-1";

function makePlan(coveragePercent: number): RosterPlan {
  return {
    siteId,
    startDate: "2026-06-18",
    endDate: "2026-07-31",
    entries: [],
    summary: {
      guardsConsidered: 3,
      shiftsPlanned: 10,
      postsUsed: 2,
      skippedGuardDays: 0,
      uncoveredDays: 0,
      coveragePercent,
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
}

function mockEnabledSite(overrides: Record<string, unknown> = {}) {
  return {
    id: siteId,
    name: "Alpha Site",
    autoRosterEnabled: true,
    autoRosterMinCoveragePercent: 100,
    posts: [
      { id: "p-day", coverageRequirements: [{ shiftTypeCode: "day", isEnabled: true }] },
      { id: "p-night", coverageRequirements: [{ shiftTypeCode: "night", isEnabled: true }] },
    ],
    assignedGuards: [
      { employee: { id: "g1", status: "active", employeeType: "security_officer" } },
      { employee: { id: "g2", status: "active", employeeType: "security_officer" } },
      { employee: { id: "g3", status: "active", employeeType: "security_officer" } },
    ],
    company: { settings: {}, name: "Co" },
    ...overrides,
  };
}

describe("auto-roster.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.site.update).mockResolvedValue({} as never);
    vi.mocked(prisma.rosterAutomationRun.create).mockResolvedValue({ id: "run-1" } as never);
    vi.mocked(prisma.rosterAutomationRun.findFirst).mockResolvedValue(null);
  });

  it("skips when auto-roster is disabled", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockEnabledSite({ autoRosterEnabled: false }) as never
    );

    const result = await runAutoRosterForSite({ companyId, siteId });
    expect(result.status).toBe("skipped");
    expect(generateRosterPlan).not.toHaveBeenCalled();
  });

  it("auto-applies when coverage meets threshold", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(mockEnabledSite() as never);
    vi.mocked(generateRosterPlan).mockResolvedValue(makePlan(100));
    vi.mocked(applyRosterPlan).mockResolvedValue({ created: 42, deleted: 0, skipped: 0, errors: [] });

    const result = await runAutoRosterForSite({ companyId, siteId, userId: "user-1" });

    expect(result.status).toBe("applied");
    expect(result.created).toBe(42);
    expect(applyRosterPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        userId: "user-1",
        options: { replaceExisting: true },
      })
    );
    expect(prisma.rosterAutomationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "applied" }),
      })
    );
  });

  it("queues for review when coverage is below threshold", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(mockEnabledSite() as never);
    vi.mocked(generateRosterPlan).mockResolvedValue(makePlan(85));

    const result = await runAutoRosterForSite({ companyId, siteId });

    expect(result.status).toBe("pending_review");
    expect(result.automationRunId).toBe("run-1");
    expect(applyRosterPlan).not.toHaveBeenCalled();
    expect(prisma.rosterAutomationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "pending_review", coveragePercent: 85 }),
      })
    );
  });

  it("respects custom coverage threshold", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue(
      mockEnabledSite({ autoRosterMinCoveragePercent: 80 }) as never
    );
    vi.mocked(generateRosterPlan).mockResolvedValue(makePlan(85));
    vi.mocked(applyRosterPlan).mockResolvedValue({ created: 10, deleted: 0, skipped: 0, errors: [] });

    const result = await runAutoRosterForSite({ companyId, siteId });
    expect(result.status).toBe("applied");
  });
});
