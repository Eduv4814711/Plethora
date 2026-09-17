import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    site: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    client: {
      findFirst: vi.fn(),
    },
    siteAssignment: {
      findMany: vi.fn(),
    },
    siteBillingRate: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({
      siteBillingRate: {
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    })),
  },
}));

import { prisma } from "../../lib/prisma.js";
import {
  ACTIVE_BILLABLE_GUARD_STATUSES,
  calculateClientBilling,
  calculateSiteBilling,
  configureSiteBillingRate,
  getActiveBillableGuards,
  getActiveBillableGuardCount,
  getEffectiveSiteBillingRate,
} from "../client-billing.service.js";

describe("ACTIVE_BILLABLE_GUARD_STATUSES", () => {
  it("includes active rosterable statuses and excludes non-working statuses", () => {
    expect(ACTIVE_BILLABLE_GUARD_STATUSES).toContain("active");
    expect(ACTIVE_BILLABLE_GUARD_STATUSES).toContain("training");
    expect(ACTIVE_BILLABLE_GUARD_STATUSES).toContain("hired");
    expect(ACTIVE_BILLABLE_GUARD_STATUSES).toContain("reliever");

    // Excluded from billable count:
    expect(ACTIVE_BILLABLE_GUARD_STATUSES).not.toContain("suspended");
    expect(ACTIVE_BILLABLE_GUARD_STATUSES).not.toContain("offboarded");
    expect(ACTIVE_BILLABLE_GUARD_STATUSES).not.toContain("applicant");
  });
});

describe("getActiveBillableGuards & getActiveBillableGuardCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries only active assignments for security_officer with valid rosterable statuses", async () => {
    const mockAssignments = [
      {
        siteId: "site-1",
        assignedAt: new Date("2026-01-01"),
        effectiveFrom: null,
        effectiveTo: null,
        employee: {
          id: "emp-1",
          employeeNumber: "EMP001",
          firstName: "John",
          lastName: "Dlamini",
          status: "active",
        },
      },
      {
        siteId: "site-1",
        assignedAt: new Date("2026-02-01"),
        effectiveFrom: null,
        effectiveTo: null,
        employee: {
          id: "emp-2",
          employeeNumber: "EMP002",
          firstName: "Thabo",
          lastName: "Mokoena",
          status: "active",
        },
      },
    ];

    vi.mocked(prisma.siteAssignment.findMany).mockResolvedValue(mockAssignments as never);

    const guards = await getActiveBillableGuards("comp-1", "site-1", new Date("2026-09-01"));
    expect(guards).toHaveLength(2);
    expect(guards[0].firstName).toBe("John");
    expect(guards[1].employeeNumber).toBe("EMP002");

    const count = await getActiveBillableGuardCount("comp-1", "site-1", new Date("2026-09-01"));
    expect(count).toBe(2);

    const callArg = vi.mocked(prisma.siteAssignment.findMany).mock.calls[0][0];
    expect(callArg?.where?.siteId).toBe("site-1");
    expect(callArg?.where?.isActive).toBe(true);
    expect(callArg?.where?.employee?.companyId).toBe("comp-1");
    expect(callArg?.where?.employee?.employeeType).toBe("security_officer");
  });
});

describe("calculateSiteBilling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates Price Per Guard × Billable Guard Count = Site Monthly Total", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue({
      id: "site-abc",
      name: "ABC Warehouse",
      clientId: "client-xyz",
      client: { name: "XYZ Logistics" },
    } as never);

    // 8 active guards
    const mockGuards = Array.from({ length: 8 }, (_, i) => ({
      siteId: "site-abc",
      assignedAt: new Date("2026-01-01"),
      effectiveFrom: null,
      effectiveTo: null,
      employee: {
        id: `emp-${i}`,
        employeeNumber: `EMP00${i}`,
        firstName: `Guard`,
        lastName: `${i}`,
        status: "active",
      },
    }));
    vi.mocked(prisma.siteAssignment.findMany).mockResolvedValue(mockGuards as never);

    // R12,500.00 rate
    vi.mocked(prisma.siteBillingRate.findFirst).mockResolvedValue({
      id: "rate-1",
      siteId: "site-abc",
      companyId: "comp-1",
      billingMethod: "PER_GUARD",
      ratePerGuard: new Prisma.Decimal("12500.00"),
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      isActive: true,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    } as never);

    const result = await calculateSiteBilling("comp-1", "site-abc", new Date("2026-09-01"));

    expect(result.billingConfigured).toBe(true);
    expect(result.billableGuardCount).toBe(8);
    expect(result.ratePerGuard?.toString()).toBe("12500");
    // 8 * 12500 = 100,000
    expect(result.siteMonthlyTotal.toString()).toBe("100000");
  });

  it("handles unconfigured billing rate gracefully without crashing", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue({
      id: "site-new",
      name: "New Unpriced Site",
      clientId: "client-xyz",
      client: { name: "XYZ Logistics" },
    } as never);

    vi.mocked(prisma.siteAssignment.findMany).mockResolvedValue([
      {
        siteId: "site-new",
        assignedAt: new Date(),
        effectiveFrom: null,
        effectiveTo: null,
        employee: { id: "emp-1", employeeNumber: "E1", firstName: "A", lastName: "B", status: "active" },
      },
    ] as never);

    vi.mocked(prisma.siteBillingRate.findFirst).mockResolvedValue(null);

    const result = await calculateSiteBilling("comp-1", "site-new", new Date("2026-09-01"));

    expect(result.billingConfigured).toBe(false);
    expect(result.ratePerGuard).toBeNull();
    expect(result.billableGuardCount).toBe(1);
    expect(result.siteMonthlyTotal.toString()).toBe("0");
  });

  it("handles 0 active billable guards correctly (0 × rate = 0)", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue({
      id: "site-empty",
      name: "Empty Site",
      clientId: "client-xyz",
      client: { name: "XYZ Logistics" },
    } as never);

    vi.mocked(prisma.siteAssignment.findMany).mockResolvedValue([] as never);

    vi.mocked(prisma.siteBillingRate.findFirst).mockResolvedValue({
      id: "rate-2",
      siteId: "site-empty",
      companyId: "comp-1",
      billingMethod: "PER_GUARD",
      ratePerGuard: new Prisma.Decimal("15000.00"),
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      isActive: true,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
    } as never);

    const result = await calculateSiteBilling("comp-1", "site-empty", new Date("2026-09-01"));

    expect(result.billingConfigured).toBe(true);
    expect(result.billableGuardCount).toBe(0);
    expect(result.ratePerGuard?.toString()).toBe("15000");
    expect(result.siteMonthlyTotal.toString()).toBe("0");
  });
});

describe("calculateClientBilling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates monthly billing totals across all sites of a client", async () => {
    vi.mocked(prisma.client.findFirst).mockResolvedValue({
      id: "client-1",
      name: "Example Security Client",
    } as never);

    vi.mocked(prisma.site.findMany).mockResolvedValue([
      { id: "site-a" },
      { id: "site-b" },
      { id: "site-c" },
    ] as never);

    // Site A: 8 guards * 12500 = 100,000
    // Site B: 5 guards * 14000 = 70,000
    // Site C: 12 guards * 11500 = 138,000
    vi.mocked(prisma.site.findFirst)
      .mockResolvedValueOnce({ id: "site-a", name: "Site A", clientId: "client-1" } as never)
      .mockResolvedValueOnce({ id: "site-b", name: "Site B", clientId: "client-1" } as never)
      .mockResolvedValueOnce({ id: "site-c", name: "Site C", clientId: "client-1" } as never);

    vi.mocked(prisma.siteAssignment.findMany)
      .mockResolvedValueOnce(Array.from({ length: 8 }, (_, i) => ({ employee: { id: `a-${i}`, employeeNumber: `A${i}`, firstName: "A", lastName: `${i}`, status: "active" } })) as never)
      .mockResolvedValueOnce(Array.from({ length: 5 }, (_, i) => ({ employee: { id: `b-${i}`, employeeNumber: `B${i}`, firstName: "B", lastName: `${i}`, status: "active" } })) as never)
      .mockResolvedValueOnce(Array.from({ length: 12 }, (_, i) => ({ employee: { id: `c-${i}`, employeeNumber: `C${i}`, firstName: "C", lastName: `${i}`, status: "active" } })) as never);

    vi.mocked(prisma.siteBillingRate.findFirst)
      .mockResolvedValueOnce({ ratePerGuard: new Prisma.Decimal("12500.00"), effectiveFrom: new Date("2026-01-01"), effectiveTo: null } as never)
      .mockResolvedValueOnce({ ratePerGuard: new Prisma.Decimal("14000.00"), effectiveFrom: new Date("2026-01-01"), effectiveTo: null } as never)
      .mockResolvedValueOnce({ ratePerGuard: new Prisma.Decimal("11500.00"), effectiveFrom: new Date("2026-01-01"), effectiveTo: null } as never);

    const clientBilling = await calculateClientBilling("comp-1", "client-1", new Date("2026-09-01"));

    expect(clientBilling.clientId).toBe("client-1");
    expect(clientBilling.clientName).toBe("Example Security Client");
    expect(clientBilling.sites).toHaveLength(3);
    expect(clientBilling.totalBillableGuards).toBe(25); // 8 + 5 + 12
    // Total = 100,000 + 70,000 + 138,000 = 308,000
    expect(clientBilling.totalMonthlyAmount.toString()).toBe("308000");
    expect(clientBilling.sitesConfiguredCount).toBe(3);
    expect(clientBilling.sitesUnconfiguredCount).toBe(0);
  });
});

describe("configureSiteBillingRate validation & effective dating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects negative rates", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue({
      id: "site-1",
      clientId: "client-1",
    } as never);

    await expect(
      configureSiteBillingRate("comp-1", "client-1", "site-1", {
        ratePerGuard: -500,
        effectiveFrom: "2026-09-01",
      })
    ).rejects.toThrow("Rate per guard must be greater than zero");
  });

  it("rejects zero rates", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue({
      id: "site-1",
      clientId: "client-1",
    } as never);

    await expect(
      configureSiteBillingRate("comp-1", "client-1", "site-1", {
        ratePerGuard: 0,
        effectiveFrom: "2026-09-01",
      })
    ).rejects.toThrow("Rate per guard must be greater than zero");
  });

  it("rejects configuring a site belonging to a different client", async () => {
    vi.mocked(prisma.site.findFirst).mockResolvedValue({
      id: "site-1",
      clientId: "client-other",
    } as never);

    await expect(
      configureSiteBillingRate("comp-1", "client-1", "site-1", {
        ratePerGuard: 12500,
        effectiveFrom: "2026-09-01",
      })
    ).rejects.toThrow("Site does not belong to the specified client");
  });
});
