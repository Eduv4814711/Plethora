import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "../prisma.js";
import {
  databaseHostFromUrl,
  verifyDatabaseConnection,
  verifyDatabaseReadiness,
} from "../db-connectivity.js";

describe("db-connectivity", () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockReset();
  });

  it("databaseHostFromUrl extracts hostname safely", () => {
    expect(databaseHostFromUrl("postgresql://u:p@db.prisma.io:5432/postgres")).toBe("db.prisma.io");
    expect(databaseHostFromUrl(undefined)).toBe("(not set)");
    expect(databaseHostFromUrl("not-a-url")).toBe("(invalid DATABASE_URL)");
  });

  it("verifyDatabaseConnection succeeds when query works", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }] as never);
    await expect(verifyDatabaseConnection()).resolves.toBeUndefined();
  });

  it("verifyDatabaseConnection throws with actionable hints", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(
      new Error("Can't reach database server at `db.prisma.io:5432`")
    );
    process.env.DATABASE_URL = "postgresql://u:p@db.prisma.io:5432/postgres";

    await expect(verifyDatabaseConnection()).rejects.toThrow(/Could not connect to PostgreSQL at db\.prisma\.io/);
    await expect(verifyDatabaseConnection()).rejects.toThrow(/npm run db:push --workspace=api/);
  });

  it("verifyDatabaseReadiness validates core tables, SiteBillingRate, and reports unfinished migrations", async () => {
    // Updated call sequence for new db-connectivity.ts:
    //   1. SELECT 1            — connectivity probe
    //   2. User/Company        — core auth schema check
    //   3. ManagedDocument     — compliance columns check
    //   4. SiteBillingRate     — billing module schema check (added to fix production 500)
    //   5. _prisma_migrations  — unfinished migration warning check (non-fatal)
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ "?column?": 1 }] as never) // 1. connectivity
      .mockResolvedValueOnce([] as never)                  // 2. User/Company
      .mockResolvedValueOnce([] as never)                  // 3. ManagedDocument columns
      .mockResolvedValueOnce([] as never)                  // 4. SiteBillingRate columns
      .mockResolvedValueOnce([] as never);                 // 5. unfinished migrations (empty = clean)
    await expect(verifyDatabaseReadiness()).resolves.toBeUndefined();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(5);
  });

  it("verifyDatabaseReadiness rejects when ManagedDocument columns are missing", async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ "?column?": 1 }] as never)             // 1. connectivity
      .mockResolvedValueOnce([] as never)                              // 2. User/Company
      .mockRejectedValueOnce(new Error('column "documentCategory" does not exist')); // 3. ManagedDocument fails
    await expect(verifyDatabaseReadiness()).rejects.toThrow(/ManagedDocument columns missing/);
  });

  it("verifyDatabaseReadiness rejects when SiteBillingRate table is missing — blocks billing 500", async () => {
    // This is the production failure scenario: the migration that creates
    // SiteBillingRate was not applied, causing every billing route to throw P2021.
    // The readiness check must block Railway from sending traffic in this state.
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ "?column?": 1 }] as never) // 1. connectivity
      .mockResolvedValueOnce([] as never)                  // 2. User/Company
      .mockResolvedValueOnce([] as never)                  // 3. ManagedDocument (ok)
      .mockRejectedValueOnce(                              // 4. SiteBillingRate MISSING
        new Error('relation "SiteBillingRate" does not exist')
      );
    await expect(verifyDatabaseReadiness()).rejects.toThrow(/SiteBillingRate table missing/);
  });

  it("verifyDatabaseReadiness logs a warning for unfinished migrations but does not throw", async () => {
    // Unfinished migrations are logged as warnings (visible in Railway logs)
    // but do NOT block traffic — that allows the app to start if tables are
    // all present, while the warning triggers operator investigation.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ "?column?": 1 }] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ migration_name: "20260911120000_site_billing_rates" }] as never);
    await expect(verifyDatabaseReadiness()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unfinished migration"));
    warnSpy.mockRestore();
  });
});
