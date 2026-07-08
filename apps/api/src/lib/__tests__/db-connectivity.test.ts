import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../prisma.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "../prisma.js";
import { databaseHostFromUrl, verifyDatabaseConnection } from "../db-connectivity.js";

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
});
