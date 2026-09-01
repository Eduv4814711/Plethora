import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    shift: { findMany: vi.fn() },
    attendanceException: {
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    siteTimesheetRow: { findMany: vi.fn() },
    siteTimesheet: { findMany: vi.fn() },
    approvalRequest: { findMany: vi.fn(), updateMany: vi.fn() },
    payrollPeriodReadiness: { upsert: vi.fn() },
    operationalAlert: { updateMany: vi.fn() },
    leaveRequest: { findFirst: vi.fn() },
    company: { findUnique: vi.fn() },
  },
}));

vi.mock("../../alerts/alerts.service.js", () => ({
  upsertAlert: vi.fn().mockResolvedValue({ alert: {}, created: true }),
}));

vi.mock("../../../lib/timezone.js", () => ({
  getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg"),
  dateKeyInTimeZone: (date: Date) => date.toISOString().slice(0, 10),
}));

import { prisma } from "../../../lib/prisma.js";
import { detectAndPersistExceptions } from "../exceptions.service.js";

describe("attendance exception scan pagination", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    vi.mocked(prisma.shift.findMany).mockReset();
    vi.mocked(prisma.attendanceException.count).mockReset();
    vi.mocked(prisma.attendanceException.findMany).mockReset().mockResolvedValue([] as never);
    vi.mocked(prisma.attendanceException.updateMany).mockReset().mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.attendanceException.findFirst).mockReset();
    vi.mocked(prisma.attendanceException.create).mockReset();
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockReset();
    vi.mocked(prisma.siteTimesheetRow.findMany).mockReset().mockResolvedValue([] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockReset().mockResolvedValue([] as never);
    vi.mocked(prisma.operationalAlert.updateMany).mockReset().mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.approvalRequest.findMany).mockReset().mockResolvedValue([] as never);
    vi.mocked(prisma.approvalRequest.updateMany).mockReset().mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.attendanceException.count).mockResolvedValue(0);
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.leaveRequest.findFirst).mockReset().mockResolvedValue(null as never);
    vi.mocked(prisma.company.findUnique).mockReset().mockResolvedValue({ settings: null } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("continues after the first 500 eligible shifts", async () => {
    const makeShift = (id: string) => ({
      id,
      employeeId: `employee-${id}`,
      siteId: null,
      startTime: new Date("2026-07-11T06:00:00.000Z"),
      endTime: new Date("2026-07-11T18:00:00.000Z"),
      attendances: [],
      site: null,
    });
    const firstPage = Array.from({ length: 500 }, (_, index) =>
      makeShift(`shift-${String(index).padStart(4, "0")}`)
    );
    const secondPage = [makeShift("shift-0500")];
    vi.mocked(prisma.shift.findMany)
      .mockResolvedValueOnce(firstPage as never)
      .mockResolvedValueOnce(secondPage as never)
      .mockResolvedValueOnce([] as never);

    const result = await detectAndPersistExceptions({
      companyId: "co-1",
      lookbackHours: 48,
    });

    expect(result).toEqual({ scanned: 501, created: 0 });
    expect(prisma.shift.findMany).toHaveBeenCalledTimes(3);
    expect(vi.mocked(prisma.shift.findMany).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        cursor: { id: firstPage.at(-1)!.id },
        skip: 1,
        take: 500,
      })
    );
  });

  it("does not create a critical absence for a covered shift and resolves its stale issue", async () => {
    const coveredShift = {
      id: "shift-covered",
      employeeId: "scheduled-guard",
      siteId: "site-1",
      startTime: new Date("2026-07-10T06:00:00.000Z"),
      endTime: new Date("2026-07-10T10:00:00.000Z"),
      status: "completed",
      attendances: [],
      site: null,
    };
    vi.mocked(prisma.shift.findMany)
      .mockResolvedValueOnce([coveredShift] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValueOnce([
      {
        sourceShiftId: coveredShift.id,
        approvalStatus: "pending",
        actualGuardId: "reliever-1",
        attendanceStatus: "reliever",
      },
    ] as never);
    vi.mocked(prisma.attendanceException.findMany).mockResolvedValueOnce([
      { id: "exception-stale" },
    ] as never);

    const result = await detectAndPersistExceptions({ companyId: "co-1", lookbackHours: 48 });

    expect(result).toEqual({ scanned: 1, created: 0 });
    expect(prisma.attendanceException.create).not.toHaveBeenCalled();
    expect(prisma.attendanceException.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["exception-stale"] }, companyId: "co-1" },
        data: expect.objectContaining({ status: "RESOLVED" }),
      })
    );
  });

  it("recognizes approved legacy coverage when the row has no source shift id", async () => {
    const coveredShift = {
      id: "shift-legacy",
      employeeId: "guard-covering",
      siteId: "site-1",
      startTime: new Date("2026-07-10T18:00:00.000Z"),
      endTime: new Date("2026-07-11T06:00:00.000Z"),
      shiftType: "night",
      status: "assigned",
      attendances: [],
      site: null,
    };
    vi.mocked(prisma.shift.findMany)
      .mockResolvedValueOnce([coveredShift] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValueOnce([
      {
        sourceShiftId: null,
        siteId: coveredShift.siteId,
        workDate: new Date("2026-07-10T00:00:00.000Z"),
        plannedGuardId: "scheduled-guard",
        actualGuardId: coveredShift.employeeId,
        plannedShiftType: "night",
        actualShiftType: "night",
        approvalStatus: "approved",
        attendanceStatus: "shift_swapped",
      },
    ] as never);
    vi.mocked(prisma.attendanceException.findMany).mockResolvedValueOnce([
      { id: "exception-legacy" },
    ] as never);

    await expect(
      detectAndPersistExceptions({ companyId: "co-1", lookbackHours: 48 })
    ).resolves.toEqual({ scanned: 1, created: 0 });
    expect(prisma.attendanceException.create).not.toHaveBeenCalled();
    expect(prisma.attendanceException.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["exception-legacy"] }, companyId: "co-1" },
        data: expect.objectContaining({ status: "RESOLVED" }),
      })
    );
  });

  it("treats an approved period as authoritative for a pre-existing legacy shift", async () => {
    const shift = {
      id: "shift-omitted-before-approval",
      employeeId: "guard-1",
      siteId: "site-1",
      startTime: new Date("2026-07-10T06:00:00.000Z"),
      endTime: new Date("2026-07-10T18:00:00.000Z"),
      shiftType: "day",
      status: "assigned",
      updatedAt: new Date("2026-07-09T08:00:00.000Z"),
      attendances: [],
      site: null,
    };
    vi.mocked(prisma.shift.findMany)
      .mockResolvedValueOnce([shift] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValueOnce([
      {
        siteId: shift.siteId,
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T00:00:00.000Z"),
        approvedAt: new Date("2026-07-12T09:00:00.000Z"),
      },
    ] as never);
    vi.mocked(prisma.attendanceException.findMany).mockResolvedValueOnce([
      { id: "exception-approved-period" },
    ] as never);

    await expect(
      detectAndPersistExceptions({ companyId: "co-1", lookbackHours: 48 })
    ).resolves.toEqual({ scanned: 1, created: 0 });
    expect(prisma.attendanceException.create).not.toHaveBeenCalled();
  });
});
