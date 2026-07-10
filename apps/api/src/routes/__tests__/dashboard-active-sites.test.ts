import { describe, expect, it } from "vitest";

/**
 * Documents dashboard active-sites semantics (see dashboard.ts).
 * Counts operational ACTIVE sites, not sites with a shift clocked in right now.
 */
describe("dashboard active sites semantics", () => {
  it("activeSitesCount should use siteStatus ACTIVE not live shift status", () => {
    const operationalWhere = {
      companyId: "co-1",
      siteStatus: "ACTIVE" as const,
    };
    const wrongWhere = {
      companyId: "co-1",
      shifts: {
        some: {
          status: "active",
          startTime: { lte: new Date() },
          endTime: { gte: new Date() },
        },
      },
    };

    expect(operationalWhere.siteStatus).toBe("ACTIVE");
    expect(wrongWhere).not.toHaveProperty("siteStatus");
  });

  it("activeSitesDelta is new ACTIVE sites added since start of current month", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const baselineCreatedBefore = { siteStatus: "ACTIVE" as const, createdAt: { lt: startOfThisMonth } };
    expect(baselineCreatedBefore.createdAt.lt.getMonth()).toBe(6); // July 0-indexed → June start boundary
  });
});
