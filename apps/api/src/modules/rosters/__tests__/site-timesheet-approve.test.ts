import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    siteTimesheet: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    siteTimesheetRow: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        siteTimesheetRow: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        siteTimesheet: { update: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    }),
  },
}));

vi.mock("../../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "../../../lib/prisma.js";
import { createAuditLog } from "../../../lib/audit.js";
import { approveSiteTimesheet } from "../site-timesheets.service.js";

const companyId = "co-1";
const timesheetId = "ts-1";
const userId = "user-1";

function row(partial: {
  id: string;
  approvalStatus: string;
  plannedShiftType?: string | null;
  plannedShiftCode?: string | null;
  dutyOnObNumber?: string | null;
  dutyOffObNumber?: string | null;
  attendanceStatus?: string;
}) {
  return {
    dutyOnObNumber: "OB-1",
    dutyOffObNumber: "OB-2",
    attendanceStatus: "present",
    plannedShiftType: null,
    plannedShiftCode: null,
    actualShiftType: null,
    actualShiftCode: null,
    ...partial,
  };
}

describe("approveSiteTimesheet (shift-safe)", () => {
  beforeEach(() => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockReset();
    vi.mocked(prisma.$transaction).mockClear();
    vi.mocked(createAuditLog).mockClear();
  });

  it("rejects when day rows are still partially reviewed under shiftType=day", async () => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue({
      id: timesheetId,
      status: "draft",
      rows: [
        row({
          id: "d1",
          approvalStatus: "partially_reviewed",
          plannedShiftType: "day",
          plannedShiftCode: "D",
        }),
        row({
          id: "n1",
          approvalStatus: "reviewed",
          plannedShiftType: "night",
          plannedShiftCode: "N",
        }),
      ],
    } as never);

    const result = await approveSiteTimesheet(companyId, timesheetId, userId, {
      shiftType: "day",
    });
    expect(result).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("still need individual review"),
      })
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects when day rows are still pending under shiftType=day", async () => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue({
      id: timesheetId,
      status: "draft",
      rows: [
        row({
          id: "d1",
          approvalStatus: "pending",
          plannedShiftType: "day",
          plannedShiftCode: "D",
        }),
        row({
          id: "n1",
          approvalStatus: "reviewed",
          plannedShiftType: "night",
          plannedShiftCode: "N",
        }),
      ],
    } as never);

    const result = await approveSiteTimesheet(companyId, timesheetId, userId, {
      shiftType: "day",
    });
    expect(result).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("still need individual review"),
      })
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("approves only day rows and keeps sheet draft when night is still pending", async () => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue({
      id: timesheetId,
      status: "draft",
      rows: [
        row({
          id: "d1",
          approvalStatus: "reviewed",
          plannedShiftType: "day",
          plannedShiftCode: "D",
        }),
        row({
          id: "n1",
          approvalStatus: "pending",
          plannedShiftType: "night",
          plannedShiftCode: "N",
        }),
      ],
    } as never);

    const result = await approveSiteTimesheet(companyId, timesheetId, userId, {
      shiftType: "day",
    });
    expect(result).toEqual({
      success: true,
      locked: false,
      approvedRowCount: 1,
      remainingPending: 1,
      shiftType: "day",
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "site_timesheet.approve_partial" })
    );
  });

  it("locks the sheet when all shifts are reviewed (shiftType=all)", async () => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue({
      id: timesheetId,
      status: "draft",
      rows: [
        row({
          id: "d1",
          approvalStatus: "reviewed",
          plannedShiftType: "day",
          plannedShiftCode: "D",
        }),
        row({
          id: "n1",
          approvalStatus: "reviewed",
          plannedShiftType: "night",
          plannedShiftCode: "N",
        }),
      ],
    } as never);

    const result = await approveSiteTimesheet(companyId, timesheetId, userId, {
      shiftType: "all",
    });
    expect(result).toEqual({
      success: true,
      locked: true,
      approvedRowCount: 2,
      remainingPending: 0,
      shiftType: "all",
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "site_timesheet.approve_lock" })
    );
  });

  it("rejects full approve when any row is still pending", async () => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue({
      id: timesheetId,
      status: "draft",
      rows: [
        row({
          id: "d1",
          approvalStatus: "reviewed",
          plannedShiftType: "day",
          plannedShiftCode: "D",
        }),
        row({
          id: "n1",
          approvalStatus: "pending",
          plannedShiftType: "night",
          plannedShiftCode: "N",
        }),
      ],
    } as never);

    const result = await approveSiteTimesheet(companyId, timesheetId, userId, {
      shiftType: "all",
    });
    expect(result).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("still need individual review"),
      })
    );
  });

  it("rejects when already locked", async () => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue({
      id: timesheetId,
      status: "locked",
      rows: [],
    } as never);
    const result = await approveSiteTimesheet(companyId, timesheetId, userId);
    expect(result).toEqual({
      error: "Timesheet is already approved and locked.",
    });
  });
});
