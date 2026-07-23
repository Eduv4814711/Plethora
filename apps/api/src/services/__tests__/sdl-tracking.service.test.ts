import { describe, expect, it, vi } from "vitest";
import { updateSdlTrackingOnPayrollPaid } from "../sdl-tracking.service.js";

function trackingDb(params: {
  grossPay: number;
  periodEnd: Date;
  monthlyPayrollTotals: Record<string, number>;
}) {
  const companyUpdate = vi.fn().mockResolvedValue({});
  const db = {
    payrollItem: {
      findMany: vi.fn().mockResolvedValue([{ grossPay: params.grossPay }]),
    },
    payrollRun: {
      findFirst: vi.fn().mockResolvedValue({ periodEnd: params.periodEnd }),
    },
    company: {
      findUnique: vi.fn().mockResolvedValue({
        monthlyPayrollTotals: params.monthlyPayrollTotals,
        sdlLiableFrom: null,
      }),
      update: companyUpdate,
    },
  };

  return { db: db as never, companyUpdate };
}

describe("SDL payroll tracking", () => {
  it("uses the UTC payroll month and retains exactly 12 months", async () => {
    const { db, companyUpdate } = trackingDb({
      grossPay: 1_000,
      // This instant is July in UTC+2, but belongs to the June payroll period.
      periodEnd: new Date("2026-06-30T23:59:59.999Z"),
      monthlyPayrollTotals: {
        "2025-06": 499_000,
        "2025-07": 1_000,
      },
    });

    await updateSdlTrackingOnPayrollPaid("company-1", "run-1", db);

    const update = companyUpdate.mock.calls[0]?.[0] as {
      data: {
        monthlyPayrollTotals: Record<string, number>;
        sdlLiableFrom?: Date;
      };
    };
    expect(update.data.monthlyPayrollTotals).toEqual({
      "2025-07": 1_000,
      "2026-06": 1_000,
    });
    expect(update.data).not.toHaveProperty("sdlLiableFrom");
  });

  it("accumulates the current month and records liability at the threshold", async () => {
    const { db, companyUpdate } = trackingDb({
      grossPay: 500,
      periodEnd: new Date("2026-06-30T23:59:59.999Z"),
      monthlyPayrollTotals: { "2026-06": 499_500 },
    });

    await updateSdlTrackingOnPayrollPaid("company-1", "run-1", db);

    const update = companyUpdate.mock.calls[0]?.[0] as {
      data: {
        monthlyPayrollTotals: Record<string, number>;
        sdlLiableFrom?: Date;
      };
    };
    expect(update.data.monthlyPayrollTotals["2026-06"]).toBe(500_000);
    expect(update.data.sdlLiableFrom?.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z"
    );
  });
});
