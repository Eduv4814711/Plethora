import { describe, expect, it, vi, beforeEach } from "vitest";
import { assertPayrollNotBlocked, getBlockingExceptionBreakdown } from "../exceptions.service.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    attendanceException: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    shift: { findMany: vi.fn() },
    payrollPeriodReadiness: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
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
    vi.mocked(prisma.operationalAlert.updateMany).mockReset().mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.attendanceException.groupBy).mockReset();
    vi.mocked(prisma.attendanceException.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.attendanceException.findMany).mockReset();
    vi.mocked(prisma.attendanceException.findMany).mockResolvedValue([] as never);
  });

  it("keeps payroll available when critical exceptions are open", async () => {
    vi.mocked(prisma.attendanceException.count)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(5);
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockResolvedValue({} as never);

    const result = await assertPayrollNotBlocked(companyId, start, end);
    expect(result.blocked).toBe(false);
    expect(result.status).toBe("PENDING_ATTENDANCE_REVIEW");
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

  it("counts only active reviews and never treats a confirmed issue as a payroll lock", async () => {
    vi.mocked(prisma.attendanceException.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockResolvedValue({} as never);

    const result = await assertPayrollNotBlocked(companyId, start, end);

    expect(result.blocked).toBe(false);
    expect(vi.mocked(prisma.attendanceException.count).mock.calls[0]?.[0]).toEqual({
      where: {
        companyId,
        shiftId: { in: ["shift-1"] },
        severity: "CRITICAL",
        status: { in: ["OPEN", "UNDER_REVIEW"] },
      },
    });
  });

  it("does not attach a blocking breakdown when reviews are still open", async () => {
    vi.mocked(prisma.attendanceException.count)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3);
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockResolvedValue({} as never);
    const result = await assertPayrollNotBlocked(companyId, start, end);

    expect(result.blocked).toBe(false);
    expect(result.blockingExceptions).toBeUndefined();
    expect(prisma.attendanceException.groupBy).not.toHaveBeenCalled();
  });

  it("omits the breakdown entirely when nothing is blocking", async () => {
    vi.mocked(prisma.attendanceException.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockResolvedValue({} as never);

    const result = await assertPayrollNotBlocked(companyId, start, end);

    expect(result.blocked).toBe(false);
    expect(result.blockingExceptions).toBeUndefined();
    expect(prisma.attendanceException.groupBy).not.toHaveBeenCalled();
  });
});

describe("getBlockingExceptionBreakdown", () => {
  const companyId = "co-1";
  const start = new Date("2026-07-01T00:00:00.000Z");
  const end = new Date("2026-07-31T23:59:59.999Z");

  beforeEach(() => {
    vi.mocked(prisma.shift.findMany).mockReset();
    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      { id: "shift-1", startTime: new Date("2026-07-10T06:00:00.000Z") },
    ] as never);
    vi.mocked(prisma.attendanceException.groupBy).mockReset();
    vi.mocked(prisma.attendanceException.findMany).mockReset();
    vi.mocked(prisma.attendanceException.findMany).mockResolvedValue([] as never);
  });

  it("counts only active CRITICAL exceptions in the operational breakdown", async () => {
    vi.mocked(prisma.attendanceException.groupBy).mockResolvedValue([] as never);

    await getBlockingExceptionBreakdown(companyId, start, end);

    expect(vi.mocked(prisma.attendanceException.groupBy).mock.calls[0]?.[0]).toMatchObject({
      by: ["exceptionType"],
      where: {
        companyId,
        shiftId: { in: ["shift-1"] },
        severity: "CRITICAL",
        status: { in: ["OPEN", "UNDER_REVIEW"] },
      },
    });
  });

  it("survives exceptions with no linked employee or site", async () => {
    vi.mocked(prisma.attendanceException.groupBy).mockResolvedValue([
      { exceptionType: "SHIFT_NOT_FOUND", _count: { id: 1 } },
    ] as never);
    vi.mocked(prisma.attendanceException.findMany).mockResolvedValue([
      {
        id: "exc-9",
        description: "Orphaned clock event",
        detectedAt: new Date("2026-07-11T06:00:00.000Z"),
        employee: null,
        site: null,
      },
    ] as never);

    const result = await getBlockingExceptionBreakdown(companyId, start, end);

    expect(result.groups[0].samples[0]).toMatchObject({
      employeeName: null,
      employeeNumber: null,
      siteName: null,
    });
  });
});
