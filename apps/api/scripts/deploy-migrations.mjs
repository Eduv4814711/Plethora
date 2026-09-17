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

    // 1. Ensure ManagedDocument compliance columns exist.
    //    This is a forward-compatibility patch for 20260902120000_employee_compliance_documents_columns
    //    which may have been applied without its migration record in some environments.
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
    //    so Prisma does not attempt to re-apply it via migrate deploy.
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

    // NOTE: We intentionally do NOT delete unfinished _prisma_migrations rows.
    //
    // Auto-deleting rows where finished_at IS NULL was previously used to clear
    // "stuck" migrations, but this is dangerous: it destroys the migration history
    // that Prisma relies on, and silently hides production failures. A failed
    // migration must be diagnosed and resolved explicitly using:
    //
    //   prisma migrate resolve --rolled-back <migration_name>
    //
    // before re-running migrate deploy. See DEPLOYMENT_RAILWAY.md for the recovery
    // procedure. Removing this block ensures the pipeline fails loudly if a
    // migration is in a bad state instead of hiding it.

    // 3. Ensure compliance hub tables exist.
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

  if (deploy.error) {
    console.error("[deploy-migrations] Failed to spawn prisma migrate deploy:", deploy.error.message);
    process.exit(1);
  }

  if (deploy.status !== 0) {
    console.error(
      "[deploy-migrations] prisma migrate deploy exited with code:",
      deploy.status,
      "— aborting deployment to prevent running application code against an incomplete database schema.",
      "Review the migration history and resolve any stuck/failed migrations before redeploying.",
      "Recovery: prisma migrate resolve --rolled-back <migration_name>"
    );
    process.exit(deploy.status ?? 1);
  }

  console.log("[deploy-migrations] prisma migrate deploy completed successfully.");
}

main().catch((err) => {
  console.error("[deploy-migrations] Unexpected error:", err);
  process.exit(1);
});
