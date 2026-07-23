import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    site: { findFirst: vi.fn() },
    employee: { findMany: vi.fn() },
    siteRosterPattern: { create: vi.fn(), findFirst: vi.fn() },
    siteRosterGeneratedShift: { findMany: vi.fn() },
    siteRosterManualOverride: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../roster-continuity.service.js", () => ({
  reconcileRosterContinuityForSite: vi.fn(),
}));

vi.mock("../../../lib/timezone.js", () => ({
  getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg"),
  getShiftTimes: vi.fn(),
}));

import { prisma } from "../../../lib/prisma.js";
import {
  applyManualOverridesBulk,
  createPattern,
  RosterGuardValidationError,
} from "../rosters.service.js";

describe("roster guard tenant validation", () => {
  beforeEach(() => {
    vi.mocked(prisma.site.findFirst).mockReset();
    vi.mocked(prisma.employee.findMany).mockReset();
    vi.mocked(prisma.siteRosterPattern.create).mockReset();
    vi.mocked(prisma.$transaction).mockReset();
    vi.mocked(prisma.site.findFirst).mockResolvedValue({
      id: "site-1",
      companyId: "co-1",
      rosterContinuityState: "not_started",
    } as never);
  });

  it("rejects a cross-tenant guard before creating a roster pattern", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);

    await expect(
      createPattern("co-1", "user-1", {
        siteId: "site-1",
        name: "Pattern",
        anchorDate: "2026-07-01",
        effectiveFrom: "2026-07-01",
        cycleLengthDays: 3,
        cells: [{ guardId: "foreign-guard", patternDayIndex: 0, shiftCode: "D" }],
      })
    ).rejects.toBeInstanceOf(RosterGuardValidationError);

    expect(prisma.siteRosterPattern.create).not.toHaveBeenCalled();
  });

  it("validates every bulk override guard before applying any mutation", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "guard-1" },
    ] as never);

    await expect(
      applyManualOverridesBulk("co-1", "user-1", {
        siteId: "site-1",
        changes: [
          {
            guardId: "guard-1",
            rosterDate: "2026-07-01",
            overrideShiftCode: "D",
          },
          {
            guardId: "foreign-guard",
            rosterDate: "2026-07-02",
            overrideShiftCode: "N",
          },
        ],
      })
    ).rejects.toBeInstanceOf(RosterGuardValidationError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
