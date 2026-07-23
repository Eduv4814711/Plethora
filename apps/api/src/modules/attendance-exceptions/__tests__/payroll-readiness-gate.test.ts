import { describe, expect, it, vi, beforeEach } from "vitest";
import { assertPayrollNotBlocked } from "../exceptions.service.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    attendanceException: { count: vi.fn() },
    shift: { findMany: vi.fn() },
    payrollPeriodReadiness: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
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

describe("assertPayrollNotBlocked", () => {
  const companyId = "co-1";
  const start = new Date("2026-07-01T00:00:00.000Z");
  const end = new Date("2026-07-31T23:59:59.999Z");

  beforeEach(() => {
    vi.mocked(prisma.attendanceException.count).mockReset();
    vi.mocked(prisma.shift.findMany).mockReset();
    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      { id: "shift-1", startTime: new Date("2026-07-10T06:00:00.000Z") },
    ] as never);
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockReset();
  });

  it("blocks payroll when critical exceptions are open", async () => {
    vi.mocked(prisma.attendanceException.count)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(5);
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockResolvedValue({} as never);

    const result = await assertPayrollNotBlocked(companyId, start, end);
    expect(result.blocked).toBe(true);
    expect(result.status).toBe("BLOCKED_BY_EXCEPTIONS");
  });

  it("allows payroll when no critical exceptions", async () => {
    vi.mocked(prisma.attendanceException.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockResolvedValue({} as never);

    const result = await assertPayrollNotBlocked(companyId, start, end);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe("READY");
  });

  it("keeps a confirmed critical exception blocking until it is resolved", async () => {
    vi.mocked(prisma.attendanceException.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockResolvedValue({} as never);

    const result = await assertPayrollNotBlocked(companyId, start, end);

    expect(result.blocked).toBe(true);
    expect(vi.mocked(prisma.attendanceException.count).mock.calls[0]?.[0]).toEqual({
      where: {
        companyId,
        shiftId: { in: ["shift-1"] },
        severity: "CRITICAL",
        status: { in: ["OPEN", "UNDER_REVIEW", "APPROVED"] },
      },
    });
  });
});
