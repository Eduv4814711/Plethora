import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getStatutorySummaryForRun,
  getStatutorySummaryForMonth,
  estimateTaxReserve,
} from "../payroll-statutory.service.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    payrollRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../lib/prisma.js";

describe("PayrollStatutoryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates statutory totals for a payroll run", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue({
      id: "run1",
      companyId: "company1",
      periodStart: new Date("2025-03-01"),
      periodEnd: new Date("2025-03-31"),
      status: "paid",
      lockedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          payslip: {
            tax: 1000 as never,
            uifEmployee: 50 as never,
            uifEmployer: 50 as never,
            sdl: 100 as never,
          },
        },
        {
          payslip: {
            tax: 800 as never,
            uifEmployee: 40 as never,
            uifEmployer: 40 as never,
            sdl: 80 as never,
          },
        },
      ],
    } as never);

    const result = await getStatutorySummaryForRun("run1", "company1");

    expect(result).not.toBeNull();
    expect(result!.payeTotal).toBe(1800);
    expect(result!.uifTotal).toBe(180);
    expect(result!.sdlTotal).toBe(180);
    expect(result!.totalStatutory).toBe(2160);
  });

  it("returns null when run not found", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null);

    const result = await getStatutorySummaryForRun("nonexistent", "company1");

    expect(result).toBeNull();
  });

  it("estimates tax reserve from paid runs", async () => {
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([
      {
        id: "run1",
        periodEnd: new Date("2025-03-31"),
        items: [
          {
            payslip: {
              tax: 1000 as never,
              uifEmployee: 50 as never,
              uifEmployer: 50 as never,
              sdl: 100 as never,
            },
          },
        ],
      },
    ] as never[]);

    const result = await estimateTaxReserve("company1", { monthsToAverage: 3 });

    expect(result.oneMonthReserve).toBeGreaterThan(0);
    expect(result.threeMonthReserve).toBe(result.oneMonthReserve * 3);
  });
});
