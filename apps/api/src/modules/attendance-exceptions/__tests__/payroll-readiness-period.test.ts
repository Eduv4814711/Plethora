import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getPayrollReadiness } from "../exceptions.service.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
    attendanceException: { count: vi.fn() },
    payrollPeriodReadiness: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../alerts/alerts.service.js", () => ({
  upsertAlert: vi.fn().mockResolvedValue({ alert: {}, created: true }),
}));

import { prisma } from "../../../lib/prisma.js";

describe("getPayrollReadiness pay period alignment", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    vi.mocked(prisma.company.findUnique).mockReset();
    vi.mocked(prisma.attendanceException.count).mockReset();
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockReset();
    vi.mocked(prisma.payrollPeriodReadiness.findUnique).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses configured 26–25 pay period instead of calendar month", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      settings: { payPeriodStartDay: 26, payPeriodEndDay: 25, timezone: "Africa/Johannesburg" },
    } as never);

    vi.mocked(prisma.attendanceException.count).mockResolvedValue(0);
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.payrollPeriodReadiness.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        companyId: "co-1",
        status: "READY",
        openExceptions: 0,
        periodStart: new Date("2026-06-26T00:00:00.000Z"),
        periodEnd: new Date("2026-07-25T23:59:59.999Z"),
      } as never);

    const result = await getPayrollReadiness("co-1");
    expect(result?.periodStart).toEqual(new Date("2026-06-26T00:00:00.000Z"));
    expect(result?.periodEnd).toEqual(new Date("2026-07-25T23:59:59.999Z"));

    const upsertArg = vi.mocked(prisma.payrollPeriodReadiness.upsert).mock.calls[0]?.[0];
    expect(upsertArg?.create?.periodStart).toEqual(new Date("2026-06-26T00:00:00.000Z"));
  });
});
