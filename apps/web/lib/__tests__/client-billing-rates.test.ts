import { describe, expect, it } from "vitest";
import { formatCurrency } from "../currency";
import type { SiteBillingSummary, ClientSitesBillingResponse } from "../billing-api";

describe("Client Site Billing Financial Logic", () => {
  it("calculates Site Monthly Charge = Rate Per Guard × Billable Guard Count", () => {
    const ratePerGuard = 12500;
    const billableGuards = 8;
    const siteMonthlyTotal = ratePerGuard * billableGuards;

    expect(siteMonthlyTotal).toBe(100000);
    expect(formatCurrency(siteMonthlyTotal, { currency: "ZAR" }).replace(/\s/g, " ")).toContain("100 000");
  });

  it("handles 0 active billable guards correctly", () => {
    const ratePerGuard = 12500;
    const billableGuards = 0;
    const siteMonthlyTotal = ratePerGuard * billableGuards;

    expect(siteMonthlyTotal).toBe(0);
    expect(formatCurrency(siteMonthlyTotal, { currency: "ZAR" })).toContain("0");
  });

  it("aggregates all site monthly totals into the client monthly total", () => {
    const clientSites: SiteBillingSummary[] = [
      {
        siteId: "site-a",
        siteName: "Site A",
        billingMethod: "PER_GUARD",
        ratePerGuard: "12500.00",
        billableGuardCount: 8,
        siteMonthlyTotal: "100000.00",
        billingConfigured: true,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      },
      {
        siteId: "site-b",
        siteName: "Site B",
        billingMethod: "PER_GUARD",
        ratePerGuard: "14000.00",
        billableGuardCount: 5,
        siteMonthlyTotal: "70000.00",
        billingConfigured: true,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      },
      {
        siteId: "site-c",
        siteName: "Site C",
        billingMethod: "PER_GUARD",
        ratePerGuard: "11500.00",
        billableGuardCount: 12,
        siteMonthlyTotal: "138000.00",
        billingConfigured: true,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      },
    ];

    const totalMonthly = clientSites.reduce((sum, s) => sum + Number(s.siteMonthlyTotal), 0);
    const totalGuards = clientSites.reduce((sum, s) => sum + s.billableGuardCount, 0);

    expect(totalGuards).toBe(25);
    expect(totalMonthly).toBe(308000);
    expect(formatCurrency(totalMonthly, { currency: "ZAR" }).replace(/\s/g, " ")).toContain("308 000");
  });

  it("flags unconfigured sites without breaking calculation", () => {
    const clientSites: SiteBillingSummary[] = [
      {
        siteId: "site-a",
        siteName: "Site A",
        billingMethod: "PER_GUARD",
        ratePerGuard: "12500.00",
        billableGuardCount: 8,
        siteMonthlyTotal: "100000.00",
        billingConfigured: true,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      },
      {
        siteId: "site-b",
        siteName: "Site B (New)",
        billingMethod: "PER_GUARD",
        ratePerGuard: null,
        billableGuardCount: 4,
        siteMonthlyTotal: "0",
        billingConfigured: false,
        effectiveFrom: null,
        effectiveTo: null,
      },
    ];

    const configuredCount = clientSites.filter((s) => s.billingConfigured).length;
    const unconfiguredCount = clientSites.filter((s) => !s.billingConfigured).length;

    expect(configuredCount).toBe(1);
    expect(unconfiguredCount).toBe(1);
  });
});
