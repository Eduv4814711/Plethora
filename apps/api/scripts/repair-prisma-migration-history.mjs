/**
 * One-time recovery when `_prisma_migrations` lists failed or obsolete migration
 * names (e.g. after squashing to 20240101000000_baseline).
 *
 * Enable via VERCEL_PRISMA_REPAIR_HISTORY=1 on Vercel for a single deploy, then remove it.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const monoRoot = join(apiRoot, "..", "..");

function bin(name) {
  const local = join(apiRoot, "node_modules", ".bin", name);
  if (existsSync(local)) return local;
  const hoisted = join(monoRoot, "node_modules", ".bin", name);
  if (existsSync(hoisted)) return hoisted;
  return name;
}

const prismaBin = bin("prisma");
const prisma = new PrismaClient();

try {
  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "_prisma_migrations"`);
    console.warn("[repair-migrations] Truncated _prisma_migrations.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/does not exist|42P01|undefined_table/i.test(msg)) throw e;
    console.warn("[repair-migrations] _prisma_migrations missing (fresh DB); continuing.");
  }

  const rows = await prisma.$queryRaw`SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'User'
  ) AS "exists"`;
  const hasUser = Boolean(rows[0]?.exists);

  if (hasUser) {
    console.warn(
      "[repair-migrations] Existing schema detected; marking 20240101000000_baseline as applied."
    );
    execSync(`"${prismaBin}" migrate resolve --applied 20240101000000_baseline`, {
      stdio: "inherit",
      env: process.env,
      cwd: apiRoot,
    });
  } else {
    console.warn(
      "[repair-migrations] No User table yet; next migrate deploy will apply the baseline DDL."
    );
  }
} finally {
  await prisma.$disconnect();
}
