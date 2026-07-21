import { describe, expect, it } from "vitest";
import { confirmDatabaseTarget, parseDatabaseTarget } from "../leave-import-target.js";

describe("leave import database target guard", () => {
  it("parses an explicit PostgreSQL host, port, and decoded database name", () => {
    expect(parseDatabaseTarget("postgresql://user:secret@db.internal:6543/payroll%20prod?schema=public")).toEqual({
      host: "db.internal",
      port: "6543",
      database: "payroll prod",
    });
  });

  it("uses PostgreSQL's default port when DATABASE_URL omits it", () => {
    expect(parseDatabaseTarget("postgres://user:secret@db.internal/payroll")).toEqual({
      host: "db.internal",
      port: "5432",
      database: "payroll",
    });
  });

  it.each([
    [undefined, "DATABASE_URL is required"],
    ["not a URL", "DATABASE_URL is not a valid URL"],
    ["mysql://db.internal/payroll", "must use the postgres or postgresql protocol"],
    ["postgresql:///payroll", "must include an explicit host and database name"],
    ["postgresql://db.internal", "must include an explicit host and database name"],
  ])("rejects an unsafe target value %#", (databaseUrl, message) => {
    expect(() => parseDatabaseTarget(databaseUrl)).toThrow(message);
  });

  it("allows a dry-run without expected target flags", () => {
    expect(
      confirmDatabaseTarget({
        rawDatabaseUrl: "postgresql://db.internal/payroll",
        apply: false,
      })
    ).toEqual({ host: "db.internal", port: "5432", database: "payroll" });
  });

  it.each([
    { expectedHost: undefined, expectedPort: "5432", expectedDatabase: "payroll" },
    { expectedHost: "db.internal", expectedPort: undefined, expectedDatabase: "payroll" },
    { expectedHost: "db.internal", expectedPort: "5432", expectedDatabase: undefined },
  ])("requires all three expected target values before apply", (expected) => {
    expect(() =>
      confirmDatabaseTarget({
        rawDatabaseUrl: "postgresql://db.internal/payroll",
        apply: true,
        ...expected,
      })
    ).toThrow("Apply requires --expected-host, --expected-port, and --expected-database");
  });

  it.each(["0", "65536", "54.32", "not-a-port"])("rejects invalid expected port %s", (expectedPort) => {
    expect(() =>
      confirmDatabaseTarget({
        rawDatabaseUrl: "postgresql://db.internal/payroll",
        apply: true,
        expectedHost: "db.internal",
        expectedPort,
        expectedDatabase: "payroll",
      })
    ).toThrow("--expected-port must be an integer from 1 to 65535");
  });

  it.each([
    { expectedHost: "other.internal", expectedPort: "5432", expectedDatabase: "payroll" },
    { expectedHost: "db.internal", expectedPort: "6543", expectedDatabase: "payroll" },
    { expectedHost: "db.internal", expectedPort: "5432", expectedDatabase: "other" },
  ])("rejects a mismatched apply target", (expected) => {
    expect(() =>
      confirmDatabaseTarget({
        rawDatabaseUrl: "postgresql://db.internal/payroll",
        apply: true,
        ...expected,
      })
    ).toThrow("Database target mismatch");
  });

  it("accepts the exact target, including the implicit default port", () => {
    expect(
      confirmDatabaseTarget({
        rawDatabaseUrl: "postgresql://db.internal/payroll",
        apply: true,
        expectedHost: "DB.INTERNAL",
        expectedPort: "5432",
        expectedDatabase: "payroll",
      })
    ).toEqual({ host: "db.internal", port: "5432", database: "payroll" });
  });
});
