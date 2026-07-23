import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    siteTimesheetRow: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
import {
  addSiteTimesheetRow,
  confirmSiteTimesheetRow,
  unlockSiteTimesheet,
  updateSiteTimesheetRow,
} from "../site-timesheets.service.js";

const baseRow = {
  id: "row-1",
  companyId: "co-1",
  siteTimesheetId: "ts-1",
  siteId: "site-1",
  workDate: new Date("2026-07-10T00:00:00.000Z"),
  dutyOnObNumber: null,
  dutyOffObNumber: null,
  occurrenceBookNumber: null,
  approvalStatus: "pending",
  attendanceStatus: "present",
  siteTimesheet: { id: "ts-1", status: "draft" },
  plannedGuard: null,
  actualGuard: null,
};

describe("duty ON / duty OFF OB workflow (service)", () => {
  beforeEach(() => {
    vi.mocked(prisma.siteTimesheetRow.findFirst).mockReset();
    vi.mocked(prisma.siteTimesheet.findFirst).mockReset();
    vi.mocked(prisma.siteTimesheet.findUnique).mockReset();
    vi.mocked(prisma.employee.findFirst).mockReset();
    vi.mocked(prisma.$transaction).mockReset();
  });

  it("saves Duty ON and moves row to partially_reviewed", async () => {
    vi.mocked(prisma.siteTimesheetRow.findFirst).mockResolvedValue(baseRow as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const updated = { ...baseRow, dutyOnObNumber: "0232", approvalStatus: "partially_reviewed" };
      return fn({
        siteTimesheetRow: {
          update: vi.fn(),
          findUnique: vi.fn().mockResolvedValue(updated),
        },
        siteTimesheet: { update: vi.fn() },
      });
    });
    vi.mocked(prisma.siteTimesheet.findUnique).mockResolvedValue({
      id: "ts-1",
      site: {},
      rows: [],
    } as never);

    const result = await updateSiteTimesheetRow("co-1", "row-1", { dutyOnObNumber: "0232" });

    expect(result).toEqual(
      expect.objectContaining({
        row: expect.objectContaining({
          dutyOnObNumber: "0232",
          approvalStatus: "partially_reviewed",
        }),
      })
    );
  });

  it("saves Duty ON for pending rostered shifts and moves row to partially_reviewed", async () => {
    vi.mocked(prisma.siteTimesheetRow.findFirst).mockResolvedValue({
      ...baseRow,
      attendanceStatus: "pending",
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const updated = {
        ...baseRow,
        attendanceStatus: "pending",
        dutyOnObNumber: "0232",
        approvalStatus: "partially_reviewed",
      };
      return fn({
        siteTimesheetRow: {
          update: vi.fn(),
          findUnique: vi.fn().mockResolvedValue(updated),
        },
        siteTimesheet: { update: vi.fn() },
      });
    });
    vi.mocked(prisma.siteTimesheet.findUnique).mockResolvedValue({
      id: "ts-1",
      site: {},
      rows: [],
    } as never);

    const result = await updateSiteTimesheetRow("co-1", "row-1", { dutyOnObNumber: "0232" });

    expect(result).toEqual(
      expect.objectContaining({
        row: expect.objectContaining({
          dutyOnObNumber: "0232",
          approvalStatus: "partially_reviewed",
        }),
      })
    );
  });

  it("promotes pending row with existing Duty ON to partially_reviewed on re-save", async () => {
    vi.mocked(prisma.siteTimesheetRow.findFirst).mockResolvedValue({
      ...baseRow,
      attendanceStatus: "pending",
      dutyOnObNumber: "345",
      approvalStatus: "pending",
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const updated = {
        ...baseRow,
        attendanceStatus: "pending",
        dutyOnObNumber: "345",
        approvalStatus: "partially_reviewed",
      };
      return fn({
        siteTimesheetRow: {
          update: vi.fn(),
          findUnique: vi.fn().mockResolvedValue(updated),
        },
        siteTimesheet: { update: vi.fn() },
      });
    });
    vi.mocked(prisma.siteTimesheet.findUnique).mockResolvedValue({
      id: "ts-1",
      site: {},
      rows: [],
    } as never);

    const result = await updateSiteTimesheetRow("co-1", "row-1", { dutyOnObNumber: "345" });

    expect(result).toEqual(
      expect.objectContaining({
        row: expect.objectContaining({
          dutyOnObNumber: "345",
          approvalStatus: "partially_reviewed",
        }),
      })
    );
  });

  it("blocks approve when Duty OFF is missing", async () => {
    vi.mocked(prisma.siteTimesheetRow.findFirst).mockResolvedValue({
      ...baseRow,
      dutyOnObNumber: "0232",
      approvalStatus: "partially_reviewed",
    } as never);

    const result = await confirmSiteTimesheetRow("co-1", "row-1", {});

    expect(result).toEqual({
      error: "Duty OFF OB number is required before you can approve this shift.",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("approves row when both Duty ON and Duty OFF are present", async () => {
    vi.mocked(prisma.siteTimesheetRow.findFirst).mockResolvedValue({
      ...baseRow,
      dutyOnObNumber: "0232",
      dutyOffObNumber: "0233",
      approvalStatus: "partially_reviewed",
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const updated = {
        ...baseRow,
        dutyOnObNumber: "0232",
        dutyOffObNumber: "0233",
        approvalStatus: "reviewed",
      };
      return fn({
        siteTimesheetRow: {
          update: vi.fn(),
          findUnique: vi.fn().mockResolvedValue(updated),
        },
        siteTimesheet: { update: vi.fn() },
      });
    });
    vi.mocked(prisma.siteTimesheet.findUnique).mockResolvedValue({
      id: "ts-1",
      site: {},
      rows: [],
    } as never);

    const result = await confirmSiteTimesheetRow("co-1", "row-1", {});

    expect(result).toEqual(
      expect.objectContaining({
        row: expect.objectContaining({
          approvalStatus: "reviewed",
          dutyOnObNumber: "0232",
          dutyOffObNumber: "0233",
        }),
      })
    );
  });

  it("allows the same Duty ON OB on another row (no uniqueness check)", async () => {
    vi.mocked(prisma.siteTimesheetRow.findFirst).mockResolvedValue({
      ...baseRow,
      id: "row-2",
      workDate: new Date("2026-07-11T00:00:00.000Z"),
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const updated = {
        ...baseRow,
        id: "row-2",
        dutyOnObNumber: "0232",
        approvalStatus: "partially_reviewed",
      };
      return fn({
        siteTimesheetRow: {
          update: vi.fn(),
          findUnique: vi.fn().mockResolvedValue(updated),
        },
        siteTimesheet: { update: vi.fn() },
      });
    });
    vi.mocked(prisma.siteTimesheet.findUnique).mockResolvedValue({
      id: "ts-1",
      site: {},
      rows: [],
    } as never);

    const result = await updateSiteTimesheetRow("co-1", "row-2", { dutyOnObNumber: "0232" });

    expect(result).toEqual(
      expect.objectContaining({
        row: expect.objectContaining({ dutyOnObNumber: "0232" }),
      })
    );
    expect(result).not.toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it("requires Duty ON when adding a reliever", async () => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue({
      id: "ts-1",
      companyId: "co-1",
      siteId: "site-1",
      status: "draft",
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-31T00:00:00.000Z"),
    } as never);
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "g1" } as never);

    const result = await addSiteTimesheetRow("co-1", "ts-1", {
      workDate: "2026-07-11",
      actualGuardId: "g1",
      actualShiftCode: "R",
      actualShiftType: "day",
      attendanceStatus: "reliever",
    });

    expect(result).toEqual({
      error: "Duty ON OB number is required before you can add a reliever to the timesheet.",
    });
  });

  it("invalidates a reviewed row when payroll-affecting work data changes", async () => {
    vi.mocked(prisma.siteTimesheetRow.findFirst).mockResolvedValue({
      ...baseRow,
      approvalStatus: "reviewed",
      dutyOnObNumber: "0232",
      dutyOffObNumber: "0233",
      clockIn: new Date("2026-07-10T06:00:00.000Z"),
      clockOut: new Date("2026-07-10T18:00:00.000Z"),
      hoursWorked: 12,
      overtimeHours: 0,
    } as never);
    const update = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        siteTimesheetRow: {
          update,
          findUnique: vi.fn().mockResolvedValue({
            ...baseRow,
            approvalStatus: "partially_reviewed",
            dutyOnObNumber: "0232",
            dutyOffObNumber: "0233",
            hoursWorked: 10,
          }),
        },
        siteTimesheet: { update: vi.fn() },
      })
    );
    vi.mocked(prisma.siteTimesheet.findUnique).mockResolvedValue({
      id: "ts-1",
      site: {},
      rows: [],
    } as never);

    await updateSiteTimesheetRow("co-1", "row-1", { hoursWorked: 10 });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvalStatus: "partially_reviewed", hoursWorked: 10 }),
      })
    );
  });

  it("rejects invalid hours before mutating a row", async () => {
    vi.mocked(prisma.siteTimesheetRow.findFirst).mockResolvedValue(baseRow as never);

    const result = await updateSiteTimesheetRow("co-1", "row-1", { hoursWorked: -1 });

    expect(result).toEqual({ error: "Hours worked must be between 0 and 24." });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("resets every row and clears approval metadata when unlocking", async () => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue({
      id: "ts-1",
      companyId: "co-1",
      status: "locked",
    } as never);
    const updateMany = vi.fn();
    const updateSheet = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        siteTimesheetRow: { updateMany },
        siteTimesheet: { update: updateSheet },
      })
    );

    const result = await unlockSiteTimesheet("co-1", "ts-1", "user-1", "Correction");

    expect(result).toEqual({ success: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { siteTimesheetId: "ts-1", companyId: "co-1" },
      data: { approvalStatus: "pending" },
    });
    expect(updateSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "draft",
          approvedBy: null,
          approvedAt: null,
          reviewedBy: null,
          reviewedAt: null,
        }),
      })
    );
  });

  it("rejects a reliever row outside the timesheet period", async () => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue({
      id: "ts-1",
      companyId: "co-1",
      siteId: "site-1",
      status: "draft",
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-31T00:00:00.000Z"),
    } as never);

    const result = await addSiteTimesheetRow("co-1", "ts-1", {
      workDate: "2026-08-01",
      actualGuardId: "g1",
      actualShiftCode: "R",
      actualShiftType: "day",
      attendanceStatus: "reliever",
      dutyOnObNumber: "0232",
    });

    expect(result).toEqual({
      error: "Row date must be between 2026-07-01 and 2026-07-31.",
    });
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("adds reliever with Duty ON and starts partially_reviewed", async () => {
    vi.mocked(prisma.siteTimesheet.findFirst).mockResolvedValue({
      id: "ts-1",
      companyId: "co-1",
      siteId: "site-1",
      status: "draft",
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-31T00:00:00.000Z"),
    } as never);
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const created = {
        ...baseRow,
        id: "row-new",
        dutyOnObNumber: "0232",
        approvalStatus: "partially_reviewed",
      };
      return fn({
        siteTimesheetRow: {
          create: vi.fn().mockResolvedValue({ id: "row-new" }),
          findUnique: vi.fn().mockResolvedValue(created),
        },
        siteTimesheet: { update: vi.fn() },
      });
    });
    vi.mocked(prisma.siteTimesheet.findUnique).mockResolvedValue({
      id: "ts-1",
      site: {},
      rows: [],
    } as never);

    const result = await addSiteTimesheetRow("co-1", "ts-1", {
      workDate: "2026-07-11",
      actualGuardId: "g1",
      actualShiftCode: "R",
      actualShiftType: "day",
      attendanceStatus: "reliever",
      dutyOnObNumber: "0232",
    });

    expect(result).toEqual(
      expect.objectContaining({
        row: expect.objectContaining({
          dutyOnObNumber: "0232",
          approvalStatus: "partially_reviewed",
        }),
      })
    );
  });
});
