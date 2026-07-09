import { describe, expect, it, vi, beforeEach } from "vitest";
import { assertPayrollNotBlocked } from "../exceptions.service.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
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

describe("assertPayrollNotBlocked", () => {
  const companyId = "co-1";
  const start = new Date("2026-07-01T00:00:00.000Z");
  const end = new Date("2026-07-31T23:59:59.999Z");

  beforeEach(() => {
    vi.mocked(prisma.attendanceException.count).mockReset();
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
});
