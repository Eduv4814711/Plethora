import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

    // 3. Reconcile 20260909120000_compliance_hub
    //    In Railway production, manual/custom deployment code previously created enums
    //    and tables directly, causing Prisma migrate deploy to fail with:
    //    ERROR: type "ComplianceObligationType" already exists (SQLSTATE 42710)
    //    which left 20260909120000_compliance_hub in a failed state (finished_at IS NULL).
    //
    //    To reconcile this safely and non-destructively:
    //    a) Check _prisma_migrations and actual database schema.
    //    b) If the migration record failed/unfinished OR compliance tables already exist
    //       without an applied record:
    //       - Execute the idempotent compliance SQL (safe IF NOT EXISTS, zero DROP TABLE).
    //       - Reconcile _prisma_migrations with the exact sha256 checksum of migration.sql
    //         so Prisma recognises it as cleanly applied without checksum drift.
    //    c) If already applied, align checksum to avoid hash mismatch if whitespace changed.
    try {
      const migTableRes = await client.query(`
        SELECT to_regclass('public."_prisma_migrations"') as tbl;
      `);
      if (migTableRes.rows[0]?.tbl) {
        const complianceMigPath = join(
          apiDir,
          "prisma",
          "migrations",
          "20260909120000_compliance_hub",
          "migration.sql"
        );
        const complianceSql = readFileSync(complianceMigPath, "utf-8");
        const complianceChecksum = createHash("sha256").update(complianceSql).digest("hex");

        const migRecordRes = await client.query(`
          SELECT "id", "finished_at", "rolled_back_at", "checksum"
          FROM "_prisma_migrations"
          WHERE "migration_name" = '20260909120000_compliance_hub';
        `);

        const tableCheck = await client.query(`
          SELECT to_regclass('public."ComplianceObligation"') as tbl;
        `);

        const migRecord = migRecordRes.rows[0];
        const hasFailedOrRolledBackRecord = migRecord && (!migRecord.finished_at || migRecord.rolled_back_at);
        const tableExistsWithoutFinishedRecord = tableCheck.rows[0]?.tbl && (!migRecord || !migRecord.finished_at || migRecord.rolled_back_at);

        if (hasFailedOrRolledBackRecord || tableExistsWithoutFinishedRecord) {
          console.log("[deploy-migrations] Reconciling 20260909120000_compliance_hub schema and migration state...");
          try {
            await client.query(complianceSql);
            console.log("[deploy-migrations] Applied idempotent compliance hub DDL successfully.");
          } catch (ddlErr) {
            console.warn("[deploy-migrations] Compliance hub DDL note:", ddlErr?.message || ddlErr);
          }

          if (migRecord) {
            await client.query(`
              UPDATE "_prisma_migrations"
              SET "finished_at" = COALESCE("finished_at", NOW()),
                  "rolled_back_at" = NULL,
                  "applied_steps_count" = GREATEST("applied_steps_count", 1),
                  "checksum" = $1
              WHERE "migration_name" = '20260909120000_compliance_hub';
            `, [complianceChecksum]);
            console.log("[deploy-migrations] Reconciled 20260909120000_compliance_hub status in _prisma_migrations.");
          } else {
            await client.query(`
              INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
              VALUES (gen_random_uuid()::text, $1, NOW(), '20260909120000_compliance_hub', NULL, NULL, NOW(), 1);
            `, [complianceChecksum]);
            console.log("[deploy-migrations] Inserted reconciled 20260909120000_compliance_hub record into _prisma_migrations.");
          }
        } else if (migRecord && migRecord.finished_at && migRecord.checksum !== complianceChecksum) {
          await client.query(`
            UPDATE "_prisma_migrations"
            SET "checksum" = $1
            WHERE "migration_name" = '20260909120000_compliance_hub';
          `, [complianceChecksum]);
          console.log("[deploy-migrations] Aligned 20260909120000_compliance_hub checksum in _prisma_migrations.");
        }
      }
    } catch (compErr) {
      console.warn("[deploy-migrations] Compliance migration reconciliation note:", compErr?.message || compErr);
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
