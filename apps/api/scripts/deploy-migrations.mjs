import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiDir = join(__dirname, "..");
const dbUrl = process.env.DATABASE_URL || process.env.databaseUrl;

async function reconcileDatabase() {
  if (!dbUrl) {
    console.log("[deploy-migrations] No DATABASE_URL found, skipping pre-migration reconciliation.");
    return;
  }

  console.log("[deploy-migrations] Reconciling database schema and migration state...");
  const client = new pg.Client({ connectionString: dbUrl });

  try {
    await client.connect();

    // 1. Ensure ManagedDocument compliance columns exist
    const sqlPath = join(
      apiDir,
      "prisma",
      "migrations",
      "20260902120000_employee_compliance_documents_columns",
      "migration.sql"
    );
    try {
      const migrationSql = readFileSync(sqlPath, "utf-8");
      await client.query(migrationSql);
      console.log("[deploy-migrations] Ensured ManagedDocument columns and indexes exist.");
    } catch (sqlErr) {
      console.warn("[deploy-migrations] Direct SQL execution note:", sqlErr?.message || sqlErr);
    }

    // 2. Mark 20260902120000_employee_compliance_documents_columns as applied (NOT rolled back)
    try {
      await client.query(`
        UPDATE "_prisma_migrations"
        SET "rolled_back_at" = NULL,
            "finished_at" = COALESCE("finished_at", NOW()),
            "applied_steps_count" = GREATEST("applied_steps_count", 1)
        WHERE "migration_name" = '20260902120000_employee_compliance_documents_columns';
      `);
      console.log("[deploy-migrations] Reconciled 20260902120000_employee_compliance_documents_columns status in _prisma_migrations.");
    } catch (migErr) {
      console.warn("[deploy-migrations] Migration record update note:", migErr?.message || migErr);
    }

    // 3. Clear any stuck unfinished migrations (finished_at IS NULL AND rolled_back_at IS NULL)
    try {
      const res = await client.query(`
        DELETE FROM "_prisma_migrations"
        WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
        RETURNING "migration_name";
      `);
      if (res.rowCount && res.rowCount > 0) {
        console.log(`[deploy-migrations] Cleared ${res.rowCount} stuck unfinished migration(s):`, res.rows.map(r => r.migration_name).join(", "));
      }
    } catch (clearErr) {
      console.warn("[deploy-migrations] Stuck migration cleanup note:", clearErr?.message || clearErr);
    }
    // 4. Ensure compliance hub tables exist
    try {
      const { applyComplianceTables } = await import("./apply-compliance-tables-fn.mjs");
      await applyComplianceTables(client);
    } catch (compErr) {
      console.warn("[deploy-migrations] Compliance tables check note:", compErr?.message || compErr);
    }
  } catch (err) {
    console.warn("[deploy-migrations] Pre-migration connection note:", err?.message || err);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  await reconcileDatabase();

  console.log("[deploy-migrations] Running prisma migrate deploy...");
  const isWin = process.platform === "win32";
  const schemaPath = join(apiDir, "prisma", "schema.prisma");
  const deploy = spawnSync(
    isWin ? "npx.cmd" : "npx",
    ["prisma", "migrate", "deploy", `--schema=${schemaPath}`],
    {
      cwd: apiDir,
      stdio: "inherit",
      shell: isWin,
    }
  );

  if (deploy.status !== 0) {
    console.warn("[deploy-migrations] prisma migrate deploy exited with code:", deploy.status);
  }
}

main().catch((err) => {
  console.error("[deploy-migrations] Unexpected error:", err);
});
