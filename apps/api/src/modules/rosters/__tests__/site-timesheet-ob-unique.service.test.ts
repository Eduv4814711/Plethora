import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    siteTimesheetRow: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    siteTimesheet: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    employee: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "../../../lib/prisma.js";
import { addSiteTimesheetRow, updateSiteTimesheetRow } from "../site-timesheets.service.js";

describe("OB number uniqueness (service)", () => {
  beforeEach(() => {
    vi.mocked(prisma.siteTimesheetRow.findFirst).mockReset();
    vi.mocked(prisma.siteTimesheetRow.findMany).mockReset();
    vi.mocked(prisma.siteTimesheet.findFirst).mockReset();
    vi.mocked(prisma.employee.findFirst).mockReset();
    vi.mocked(prisma.$transaction).mockReset();
  });

  it("rejects update when OB number already exists on another row", async () => {
    vi.mocked(prisma.siteTimesheetRow.findFirst).mockResolvedValue({
      id: "row-2",
      companyId: "co-1",
      siteTimesheetId: "ts-1",
      workDate: new Date("2026-07-11T00:00:00.000Z"),
      occurrenceBookNumber: null,
      approvalStatus: "pending",
      attendanceStatus: "pending",
      siteTimesheet: { id: "ts-1", status: "draft" },
    } as never);
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([
      {
        id: "row-1",
        workDate: new Date("2026-07-10T00:00:00.000Z"),
        occurrenceBookNumber: "1234",
      },
    ] as never);

    const result = await updateSiteTimesheetRow(
      "co-1",
      "row-2",
      { occurrenceBookNumber: "1234" },
      { role: "controller", userId: "u1" }
    );

    expect(result).toEqual({
      error: expect.stringMatching(/already used on 2026-07-10/i),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects add reliever when OB number is already used", async () => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue({
      id: "ts-1",
      companyId: "co-1",
      siteId: "site-1",
      status: "draft",
    } as never);
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([
      {
        id: "row-1",
        workDate: new Date("2026-07-10T00:00:00.000Z"),
        occurrenceBookNumber: "1234",
      },
    ] as never);

    const result = await addSiteTimesheetRow("co-1", "ts-1", {
      workDate: "2026-07-11",
      actualGuardId: "g1",
      actualShiftCode: "R",
      actualShiftType: "day",
      attendanceStatus: "reliever",
      occurrenceBookNumber: "1234",
    });

    expect(result).toEqual({
      error: expect.stringMatching(/already used on 2026-07-10/i),
    });
  });
});
