import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculateEmployeeTrueCost } from "../payroll-cost.service.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    payrollItem: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "../../lib/prisma.js";

describe("PayrollCostService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates employee true cost with employer UIF and SDL", async () => {
    vi.mocked(prisma.payrollItem.findFirst).mockResolvedValue({
      id: "item1",
      payrollRunId: "run1",
      employeeId: "emp1",
      hoursWorked: 160 as never,
      overtimeHours: 10 as never,
      basePay: 8000 as never,
      overtimePay: 1125 as never,
      sundayPay: 0 as never,
      publicHolidayPay: 0 as never,
      grossPay: 9125 as never,
      deductions: 1500 as never,
      netPay: 7625 as never,
      createdAt: new Date(),
      updatedAt: new Date(),
      payslip: {
        earnings: [
          { name: "Basic", amount: 8000 },
          { name: "Overtime", amount: 1125 },
        ],
        deductions: [],
        grossPay: 9125 as never,
        totalDeductions: 1500 as never,
        netPay: 7625 as never,
        generatedAt: new Date(),
        tax: 1200 as never,
        taxableEarnings: 9125 as never,
        uifEmployee: 91.25 as never,
        uifEmployer: 91.25 as never,
        sdl: 91.25 as never,
      } as never,
      employee: {} as never,
    });

    const result = await calculateEmployeeTrueCost("item1", "company1");

    expect(result).not.toBeNull();
    expect(result!.basePay).toBe(8000);
    expect(result!.overtimePay).toBe(1125);
    expect(result!.grossPay).toBe(9125);
    expect(result!.uifEmployer).toBe(91.25);
    expect(result!.sdl).toBe(91.25);
    expect(result!.totalEmployerCost).toBe(9125 + 91.25 + 91.25);
  });

  it("returns null when payroll item not found", async () => {
    vi.mocked(prisma.payrollItem.findFirst).mockResolvedValue(null);

    const result = await calculateEmployeeTrueCost("nonexistent", "company1");

    expect(result).toBeNull();
  });

  it("extracts allowances from earnings (excludes core earnings)", async () => {
    vi.mocked(prisma.payrollItem.findFirst).mockResolvedValue({
      id: "item1",
      payrollRunId: "run1",
      employeeId: "emp1",
      hoursWorked: 160 as never,
      overtimeHours: 0 as never,
      basePay: 8000 as never,
      overtimePay: 0 as never,
      sundayPay: 0 as never,
      publicHolidayPay: 0 as never,
      grossPay: 8300 as never,
      deductions: 1000 as never,
      netPay: 7300 as never,
      createdAt: new Date(),
      updatedAt: new Date(),
      payslip: {
        earnings: [
          { name: "Basic", amount: 8000 },
          { name: "Transport", amount: 300 },
        ],
        deductions: [],
        grossPay: 8300 as never,
        totalDeductions: 1000 as never,
        netPay: 7300 as never,
        generatedAt: new Date(),
        tax: 800 as never,
        taxableEarnings: 8300 as never,
        uifEmployee: 83 as never,
        uifEmployer: 83 as never,
        sdl: 83 as never,
      } as never,
      employee: {} as never,
    });

    const result = await calculateEmployeeTrueCost("item1", "company1");

    expect(result!.allowances).toBe(300);
  });
});
