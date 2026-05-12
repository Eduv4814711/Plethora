import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const monoRoot = join(apiRoot, "..", "..");

function bin(name) {
  const local = join(apiRoot, "node_modules", ".bin", name);
  if (existsSync(local)) return local;
  const hoisted = join(monoRoot, "node_modules", ".bin", name);
  if (existsSync(hoisted)) return hoisted;
  return name;
}

function run(cmd) {
  execSync(cmd, { stdio: "inherit", env: process.env, cwd: apiRoot });
}

const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal =
  !dbUrl ||
  /localhost|127\.0\.0\.1/i.test(dbUrl) ||
  /\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(dbUrl);

const prisma = bin("prisma");
const tsc = bin("tsc");

run(`"${prisma}" generate`);

if (dbUrl && !isLocal) {
  if (process.env.VERCEL_PRISMA_REPAIR_HISTORY === "1") {
    console.warn(
      "[vercel-build] VERCEL_PRISMA_REPAIR_HISTORY=1: clearing stuck _prisma_migrations " +
        "(remove this env var after one successful deploy)."
    );
    run(`node "${join(apiRoot, "scripts/repair-prisma-migration-history.mjs")}"`);
  }
  run(`"${prisma}" migrate deploy`);
} else {
  console.warn(
    "[vercel-build] Skipping prisma migrate deploy: DATABASE_URL is unset or targets localhost. " +
      "Use a hosted Postgres URL (e.g. Neon) in Vercel env, then redeploy—or run migrate from your machine: npm run db:migrate:deploy --workspace=api"
  );
}

run(`"${tsc}"`);
run("node scripts/copy-templates.mjs");
