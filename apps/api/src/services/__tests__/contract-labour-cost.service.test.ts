import { describe, it, expect, vi, beforeEach } from "vitest";
import { getContractLabourCost } from "../contract-labour-cost.service.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    payrollRun: { findMany: vi.fn() },
    shift: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma.js";

describe("ContractLabourCostService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns healthy indicator when labour ratio <= 70%", async () => {
    vi.mocked(prisma.site.findMany).mockResolvedValue([
      {
        id: "site1",
        name: "Site A",
        monthlyRevenue: 100000 as never,
      },
    ] as never[]);

    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      {
        id: "run1",
        periodStart: new Date("2025-03-01"),
        periodEnd: new Date("2025-03-31"),
        items: [
          {
            employeeId: "emp1",
            grossPay: 65000 as never,
            overtimePay: 5000 as never,
            payslip: {
              earnings: [
                { name: "Basic", amount: 60000 },
                { name: "Overtime", amount: 5000 },
              ],
            },
          },
        ],
      },
    ] as never[]);

    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      {
        post: { siteId: "site1" },
        employeeId: "emp1",
        attendances: [{ hoursWorked: 160, overtimeHours: 10 }],
      },
    ] as never[]);

    const result = await getContractLabourCost(
      "company1",
      new Date("2025-03-01"),
      new Date("2025-03-31")
    );

    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].healthIndicator).toBe("healthy");
    expect(result.contracts[0].labourRatio).toBeLessThanOrEqual(0.7);
  });

  it("returns insufficientData when site has no revenue", async () => {
    vi.mocked(prisma.site.findMany).mockResolvedValue([
      {
        id: "site1",
        name: "Site A",
        monthlyRevenue: null,
      },
    ] as never[]);

    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      {
        id: "run1",
        periodStart: new Date("2025-03-01"),
        periodEnd: new Date("2025-03-31"),
        items: [
          {
            employeeId: "emp1",
            grossPay: 50000 as never,
            overtimePay: 5000 as never,
            payslip: { earnings: [{ name: "Basic", amount: 50000 }, { name: "Overtime", amount: 5000 }] },
          },
        ],
      },
    ] as never[]);

    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      {
        post: { siteId: "site1" },
        employeeId: "emp1",
        attendances: [{ hoursWorked: 160, overtimeHours: 10 }],
      },
    ] as never[]);

    const result = await getContractLabourCost(
      "company1",
      new Date("2025-03-01"),
      new Date("2025-03-31")
    );

    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].insufficientData).toBe(true);
    expect(result.contracts[0].healthIndicator).toBeNull();
  });
});
