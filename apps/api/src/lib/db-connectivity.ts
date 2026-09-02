import { prisma } from "./prisma.js";

const REQUIRED_SCHEMA_MIGRATION = "20260902120000_employee_compliance_documents_columns";
const READINESS_TIMEOUT_MS = 5_000;

function databaseHostFromUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl?.trim()) return "(not set)";
  try {
    const normalized = databaseUrl.replace(/^postgresql:/i, "postgres:");
    return new URL(normalized).hostname || "(unknown)";
  } catch {
    return "(invalid DATABASE_URL)";
  }
}

/** Verify PostgreSQL is reachable before serving traffic. */
export async function verifyDatabaseConnection(): Promise<void> {
  const host = databaseHostFromUrl(process.env.DATABASE_URL);
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hints = [
      `Could not connect to PostgreSQL at ${host}.`,
      "For local development, use a local Postgres URL in apps/api/.env, for example:",
      '  DATABASE_URL="postgresql://YOUR_USER@localhost/plethora?host=/var/run/postgresql&schema=public"',
      "Then run: npm run db:push --workspace=api",
      "If you use Railway or Prisma Postgres, confirm DATABASE_URL is current and the database is online.",
    ];
    throw new Error(`${message}\n\n${hints.join("\n")}`);
  }
}

function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Database readiness check timed out")),
      READINESS_TIMEOUT_MS
    );
    timer.unref?.();
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Verify the database is reachable and compatible with this application
 * release. LIMIT 0 makes PostgreSQL resolve every required table/column
 * without reading company data.
 */
export async function verifyDatabaseReadiness(): Promise<void> {
  await withTimeout(verifyDatabaseConnection());
  await withTimeout(prisma.$queryRaw`
    SELECT
      u."accountType",
      u."capabilities",
      u."isActive",
      c."ownerUserId"
    FROM "User" u
    CROSS JOIN "Company" c
    LIMIT 0
  `);
  const state = await withTimeout(prisma.$queryRaw<Array<{
    required_applied: boolean;
    unfinished: boolean;
  }>>`
    SELECT
      EXISTS (
        SELECT 1
        FROM "_prisma_migrations"
        WHERE "migration_name" = ${REQUIRED_SCHEMA_MIGRATION}
          AND "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
      ) AS required_applied,
      EXISTS (
        SELECT 1
        FROM "_prisma_migrations"
        WHERE "finished_at" IS NULL
          AND "rolled_back_at" IS NULL
      ) AS unfinished
  `);
  if (!state[0]?.required_applied || state[0]?.unfinished) {
    throw new Error("Database schema migrations are incomplete for this application release");
  }
}

export { databaseHostFromUrl };
