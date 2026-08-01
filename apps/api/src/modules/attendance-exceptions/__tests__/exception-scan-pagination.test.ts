import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    shift: { findMany: vi.fn() },
    attendanceException: { count: vi.fn() },
    payrollPeriodReadiness: { upsert: vi.fn() },
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
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockReset();
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
});
