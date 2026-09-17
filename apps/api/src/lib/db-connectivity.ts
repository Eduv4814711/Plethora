import { prisma } from "./prisma.js";

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
 * Verify the database is reachable and its schema is compatible with this
 * application release.
 *
 * Each check uses `LIMIT 0` so PostgreSQL resolves every referenced
 * table/column without reading any company data.
 *
 * IMPORTANT: When adding a new production-critical model, add a corresponding
 * LIMIT 0 check here so Railway's health endpoint blocks traffic until the
 * schema is confirmed.
 */
export async function verifyDatabaseReadiness(): Promise<void> {
  await withTimeout(verifyDatabaseConnection());

  // ── Core auth tables ────────────────────────────────────────────────────────
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

  // ── ManagedDocument compliance columns (added in 20260902120000) ────────────
  try {
    await withTimeout(prisma.$queryRaw`
      SELECT
        d."documentCategory",
        d."verificationStatus",
        d."doesNotExpire",
        d."isSensitive"
      FROM "ManagedDocument" d
      LIMIT 0
    `);
  } catch (colErr) {
    throw new Error(
      `Database schema migrations are incomplete for this application release: ManagedDocument columns missing (${colErr instanceof Error ? colErr.message : String(colErr)})`
    );
  }

  // ── SiteBillingRate (added in 20260911120000) ───────────────────────────────
  // This table is required by the Client Billing module. If it is missing,
  // every GET /payroll/billing/clients request will throw Prisma P2021 and
  // return HTTP 500 to users. Blocking here ensures Railway does not route
  // traffic to a deployment that cannot serve billing data.
  try {
    await withTimeout(prisma.$queryRaw`
      SELECT
        sbr."id",
        sbr."companyId",
        sbr."clientId",
        sbr."siteId",
        sbr."ratePerGuard",
        sbr."effectiveFrom",
        sbr."effectiveTo",
        sbr."isActive"
      FROM "SiteBillingRate" sbr
      LIMIT 0
    `);
  } catch (rateErr) {
    throw new Error(
      `Database schema migrations are incomplete for this application release: SiteBillingRate table missing (${rateErr instanceof Error ? rateErr.message : String(rateErr)}). ` +
      `Run: prisma migrate deploy (or resolve any stuck migrations first).`
    );
  }

  // ── Unfinished migration check (informational, does not auto-heal) ──────────
  // We log a warning when unfinished migrations are detected so they appear in
  // Railway logs, but we do NOT automatically delete or mark them. Any stuck
  // migration must be resolved explicitly via:
  //   prisma migrate resolve --rolled-back <migration_name>
  try {
    const unfinished = await withTimeout(prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "finished_at" IS NULL
        AND "rolled_back_at" IS NULL
    `);
    if (unfinished.length > 0) {
      const names = unfinished.map((r) => r.migration_name).join(", ");
      console.warn(
        `[db-readiness] WARNING: ${unfinished.length} unfinished migration(s) detected in _prisma_migrations: ${names}. ` +
        `These must be resolved manually with: prisma migrate resolve --rolled-back <migration_name>`
      );
    }
  } catch {
    // _prisma_migrations may not exist in very early bootstrap — non-fatal here.
  }
}

export { databaseHostFromUrl };
