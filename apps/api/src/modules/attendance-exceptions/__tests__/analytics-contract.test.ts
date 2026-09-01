import { beforeEach, describe, expect, it, vi } from "vitest";
import { getExceptionAnalytics, listExceptions } from "../exceptions.service.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    attendanceException: {
      groupBy: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    shift: { count: vi.fn(), findMany: vi.fn() },
    siteTimesheetRow: { findMany: vi.fn() },
    siteTimesheet: { findMany: vi.fn() },
    approvalRequest: { findMany: vi.fn(), updateMany: vi.fn() },
    operationalAlert: { updateMany: vi.fn() },
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

describe("attendance exception analytics contract", () => {
  beforeEach(() => {
    vi.mocked(prisma.attendanceException.groupBy).mockReset();
    vi.mocked(prisma.attendanceException.count).mockReset();
    vi.mocked(prisma.attendanceException.findMany).mockReset();
    vi.mocked(prisma.shift.count).mockReset();
    vi.mocked(prisma.shift.findMany).mockReset();
    vi.mocked(prisma.siteTimesheetRow.findMany).mockReset().mockResolvedValue([] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockReset().mockResolvedValue([] as never);
  });

  it("returns period totals, period open count, and the canonical absentee percentage", async () => {
    vi.mocked(prisma.attendanceException.groupBy)
      .mockResolvedValueOnce([{ exceptionType: "ABSENT", _count: { id: 2 } }] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.attendanceException.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(7);
    vi.mocked(prisma.shift.count)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(8);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      { id: "shift-period", startTime: new Date("2026-07-10T06:00:00.000Z") },
    ] as never);

    const periodStart = new Date("2026-07-01T00:00:00.000Z");
    const periodEnd = new Date("2026-07-31T23:59:59.999Z");
    const result = await getExceptionAnalytics("company-1", periodStart, periodEnd);

    expect(result).toMatchObject({
      total: 7,
      openCount: 3,
      openCritical: 1,
      absences: 2,
      absenteePercentage: 20,
      completionRate: 80,
    });
    expect(vi.mocked(prisma.attendanceException.count).mock.calls[1]?.[0]).toEqual({
      where: {
        companyId: "company-1",
        shiftId: { in: ["shift-period"] },
        status: { in: ["OPEN", "UNDER_REVIEW"] },
      },
    });
  });

  it("includes the final date-only day and enriches rows with their shift", async () => {
    const exception = {
      id: "exception-1",
      companyId: "company-1",
      shiftId: "shift-1",
      detectedAt: new Date("2026-07-31T18:30:00.000Z"),
    };
    const shift = {
      id: "shift-1",
      startTime: new Date("2026-07-31T18:00:00.000Z"),
      endTime: new Date("2026-08-01T06:00:00.000Z"),
    };
    vi.mocked(prisma.attendanceException.findMany).mockResolvedValue([exception] as never);
    vi.mocked(prisma.attendanceException.count).mockResolvedValue(1);
    vi.mocked(prisma.shift.findMany)
      .mockResolvedValueOnce([
        { id: "shift-1", startTime: new Date("2026-07-31T18:00:00.000Z") },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([shift] as never);

    const result = await listExceptions("company-1", {
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      limit: 50,
      offset: 0,
    });

    expect(vi.mocked(prisma.attendanceException.findMany).mock.calls[0]?.[0]?.where).toEqual({
      companyId: "company-1",
      shiftId: { in: ["shift-1"] },
    });
    expect(prisma.shift.findMany).toHaveBeenNthCalledWith(3, {
      where: { companyId: "company-1", id: { in: ["shift-1"] } },
      select: { id: true, startTime: true, endTime: true },
    });
    expect(result.items[0]).toMatchObject({ id: "exception-1", shift });
  });
});
