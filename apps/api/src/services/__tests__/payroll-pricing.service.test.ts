import { describe, expect, it, vi } from "vitest";
import {
  loadSitePricingResolver,
  loadPayrollHomeSiteResolver,
} from "../payroll-pricing.service.js";
import { prisma } from "../../lib/prisma.js";

describe("payroll-pricing.service", () => {
  const companyId = "test-company-pricing";

  it("loadSitePricingResolver resolves effective Area × Grade rates for sites", async () => {
    const mockRates = [
      {
        id: "rate-1",
        areaId: "area-1",
        gradeId: "grade-a",
        hourlyRate: "38.99",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "rate-2",
        areaId: "area-1",
        gradeId: "grade-a",
        hourlyRate: "42.50",
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      },
    ];

    const mockProfiles = [
      {
        id: "profile-1",
        siteId: "site-1",
        areaId: "area-1",
        gradeId: "grade-a",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        area: { id: "area-1", name: "Area 1", isActive: true },
        grade: { id: "grade-a", name: "Grade A", isActive: true },
      },
    ];

    vi.spyOn(prisma.sitePayProfile, "findMany").mockResolvedValueOnce(mockProfiles as any);
    vi.spyOn(prisma.payAreaGradeRate, "findMany").mockResolvedValueOnce(mockRates as any);

    const resolver = await loadSitePricingResolver(companyId, ["site-1"], new Date("2026-05-15"));

    // Rate before June 2026 should be 38.99
    const mayPrice = resolver("site-1", new Date("2026-05-15"));
    expect(mayPrice).not.toBeNull();
    expect(mayPrice?.hourlyRate).toBe(38.99);
    expect(mayPrice?.areaName).toBe("Area 1");
    expect(mayPrice?.gradeName).toBe("Grade A");

    // Rate in July 2026 should be 42.50
    const julyPrice = resolver("site-1", new Date("2026-07-01"));
    expect(julyPrice).not.toBeNull();
    expect(julyPrice?.hourlyRate).toBe(42.5);

    // Rate for unknown site should be null
    expect(resolver("unknown-site", new Date("2026-05-15"))).toBeNull();
  });

  it("loadPayrollHomeSiteResolver resolves employee home site based on effective date", async () => {
    const mockHomes = [
      {
        employeeId: "emp-1",
        siteId: "site-home-1",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        employeeId: "emp-1",
        siteId: "site-home-2",
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      },
    ];

    vi.spyOn(prisma.employeePayrollHomeSite, "findMany").mockResolvedValueOnce(mockHomes as any);

    const resolver = await loadPayrollHomeSiteResolver(companyId, ["emp-1"], new Date("2026-06-01"));

    expect(resolver("emp-1", new Date("2026-05-15"))).toBe("site-home-1");
    expect(resolver("emp-1", new Date("2026-06-15"))).toBe("site-home-2");
    expect(resolver("unknown-emp", new Date("2026-05-15"))).toBeNull();
  });
});
