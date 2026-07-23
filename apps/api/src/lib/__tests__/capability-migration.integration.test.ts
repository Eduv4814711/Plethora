import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migrationUrl = new URL(
  "../../../prisma/migrations/20260723120000_capability_access/migration.sql",
  import.meta.url
);

function schemaName() {
  return `capability_upgrade_${randomUUID().replaceAll("-", "")}`;
}

async function createLegacyFixture(client: Client, schema: string) {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await client.query(`
    CREATE TYPE "UserRole" AS ENUM (
      'admin', 'operations_manager', 'hr_payroll', 'supervisor', 'controller', 'client'
    );
    CREATE TABLE "Company" (
      "id" TEXT PRIMARY KEY,
      "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "User" (
      "id" TEXT PRIMARY KEY,
      "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
      "email" TEXT NOT NULL UNIQUE,
      "role" "UserRole" NOT NULL,
      "roleLabel" TEXT,
      "moduleAccess" JSONB,
      "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "LeaveApprovalStep" (
      "id" TEXT PRIMARY KEY,
      "role" TEXT NOT NULL,
      "decision" TEXT NOT NULL
    );
    CREATE INDEX "LeaveApprovalStep_role_decision_idx"
      ON "LeaveApprovalStep"("role", "decision");
  `);
  await client.query(`INSERT INTO "Company" ("id") VALUES ('company-a')`);
  await client.query(`
    INSERT INTO "User"
      ("id", "companyId", "email", "role", "moduleAccess", "createdAt")
    VALUES
      ('admin-null', 'company-a', 'admin-null@test.local', 'admin', NULL, '2025-01-01'),
      ('admin-empty', 'company-a', 'admin-empty@test.local', 'admin', '{}'::jsonb, '2025-01-02'),
      ('client-user', 'company-a', 'client@test.local', 'client', NULL, '2025-01-03'),
      (
        'team-reader',
        'company-a',
        'team-reader@test.local',
        'hr_payroll',
        '{"/employees":"read"}'::jsonb,
        '2025-01-04'
      )
  `);
  await client.query(`
    INSERT INTO "LeaveApprovalStep" ("id", "role", "decision")
    VALUES ('step-a', 'hr_payroll', 'PENDING')
  `);
}

describeWithDatabase("capability migration upgrade safety", () => {
  let client: Client;
  const schemas: string[] = [];

  beforeEach(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterEach(async () => {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query("RESET search_path").catch(() => undefined);
    for (const schema of schemas.splice(0)) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await client.end();
  });

  it("preserves unrestricted admins, legacy clients, scoped readers, and owner identity", async () => {
    const schema = schemaName();
    schemas.push(schema);
    await createLegacyFixture(client, schema);
    const migration = await readFile(migrationUrl, "utf8");
    await client.query(migration);

    const users = await client.query<{
      id: string;
      accountType: "staff" | "client";
      capabilities: Record<string, string[]>;
    }>(`SELECT "id", "accountType", "capabilities" FROM "User" ORDER BY "id"`);
    const byId = new Map(users.rows.map((row) => [row.id, row]));
    expect(byId.get("admin-null")?.capabilities["/payroll"]).toContain("approve");
    expect(byId.get("admin-empty")?.capabilities["/employees"]).toContain("view_sensitive");
    expect(byId.get("client-user")).toMatchObject({ accountType: "client" });
    expect(byId.get("client-user")?.capabilities["/client-portal"]).toContain("view");
    expect(byId.get("team-reader")?.capabilities["/employees"]).toEqual([
      "view",
      "view_sensitive",
    ]);

    const company = await client.query<{ ownerUserId: string }>(
      `SELECT "ownerUserId" FROM "Company" WHERE "id" = 'company-a'`
    );
    expect(company.rows[0]?.ownerUserId).toBe("admin-null");
  });

  it("rolls back the destructive conversion when any statement fails", async () => {
    const schema = schemaName();
    schemas.push(schema);
    await createLegacyFixture(client, schema);
    const migration = await readFile(migrationUrl, "utf8");
    const failingMigration = migration.replace(
      /\nCOMMIT;\s*$/,
      '\nSELECT * FROM "migration_failure_sentinel";\nCOMMIT;\n'
    );
    await expect(client.query(failingMigration)).rejects.toThrow();
    await client.query("ROLLBACK");

    const columns = await client.query<{ column_name: string }>(`
      SELECT "column_name"
      FROM information_schema.columns
      WHERE "table_schema" = '${schema}' AND "table_name" = 'User'
    `);
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain("role");
    expect(names).toContain("moduleAccess");
    expect(names).not.toContain("accountType");
  });
});
