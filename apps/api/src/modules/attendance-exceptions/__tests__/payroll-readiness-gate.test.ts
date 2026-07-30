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
    vi.mocked(prisma.attendanceException.groupBy).mockReset();
    vi.mocked(prisma.attendanceException.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.attendanceException.findMany).mockReset();
    vi.mocked(prisma.attendanceException.findMany).mockResolvedValue([] as never);
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

  it("tells the caller what is blocking, not just how many", async () => {
    vi.mocked(prisma.attendanceException.count)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3);
    vi.mocked(prisma.payrollPeriodReadiness.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.attendanceException.groupBy).mockResolvedValue([
      { exceptionType: "MISSED_CLOCK_IN", _count: { id: 1 } },
      { exceptionType: "ABSENT", _count: { id: 2 } },
    ] as never);
    vi.mocked(prisma.attendanceException.findMany).mockResolvedValue([
      {
        id: "exc-1",
        description: "No attendance recorded — marked absent",
        detectedAt: new Date("2026-07-10T06:00:00.000Z"),
        employee: { firstName: "Thabo", lastName: "Nkosi", employeeNumber: "E-100" },
        site: { name: "Sandton Gate" },
      },
    ] as never);

    const result = await assertPayrollNotBlocked(companyId, start, end);

    expect(result.blocked).toBe(true);
    expect(result.blockingExceptions?.total).toBe(3);
    // Largest group first, so the operator starts where the volume is.
    expect(result.blockingExceptions?.groups[0]).toMatchObject({
      exceptionType: "ABSENT",
      label: "Absent",
      count: 2,
    });
    expect(result.blockingExceptions?.groups[0].samples[0]).toMatchObject({
      employeeName: "Thabo Nkosi",
      employeeNumber: "E-100",
      siteName: "Sandton Gate",
      date: "2026-07-10",
    });
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

  it("counts only CRITICAL exceptions in a payroll-blocking status", async () => {
    vi.mocked(prisma.attendanceException.groupBy).mockResolvedValue([] as never);

    await getBlockingExceptionBreakdown(companyId, start, end);

    expect(vi.mocked(prisma.attendanceException.groupBy).mock.calls[0]?.[0]).toMatchObject({
      by: ["exceptionType"],
      where: {
        companyId,
        shiftId: { in: ["shift-1"] },
        severity: "CRITICAL",
        status: { in: ["OPEN", "UNDER_REVIEW", "APPROVED"] },
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
