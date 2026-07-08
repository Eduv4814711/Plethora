import { prisma } from "./prisma.js";

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

export { databaseHostFromUrl };
