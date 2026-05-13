/**
 * Create standard site / location employee groups (EmployeeGroup) for a company.
 * Skips any group whose name already exists for that company (idempotent).
 *
 * Usage (from apps/api, with DATABASE_URL in .env):
 *   npx tsx scripts/create-site-employee-groups.ts --company-id <cuid>
 *   npx tsx scripts/create-site-employee-groups.ts --dry-run --company-id <cuid>
 *
 * Env: optional IMPORT_COMPANY_ID if you omit --company-id.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "..", ".env") });

import { prisma } from "../src/lib/prisma.js";
import { ensureSiteEmployeeGroups, SITE_EMPLOYEE_GROUP_NAMES } from "../src/lib/site-employee-groups.js";

function parseArgs(argv: string[]) {
  let dryRun = false;
  let companyId = process.env.IMPORT_COMPANY_ID?.trim() || undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--company-id" && argv[i + 1]) {
      companyId = argv[++i].trim();
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown flag: ${a}`);
    }
  }

  return { dryRun, companyId };
}

async function main() {
  const { dryRun, companyId } = parseArgs(process.argv.slice(2));

  async function exitWith(code: number, message?: string): Promise<never> {
    if (message) {
      if (code === 0) console.log(message);
      else console.error(message);
    }
    await prisma.$disconnect().catch(() => {});
    process.exit(code);
  }

  if (!companyId) {
    await exitWith(
      1,
        "Missing --company-id or IMPORT_COMPANY_ID.\n" +
        "Usage: npx tsx scripts/create-site-employee-groups.ts --company-id <cuid> [--dry-run]"
    );
  }

  const company = await prisma.company.findFirst({
    where: { id: companyId },
    select: { id: true, name: true },
  });
  if (!company) {
    await exitWith(1, `No company found for id: ${companyId}`);
  }

  console.log(`Company: ${company.name} (${company.id})`);
  if (dryRun) {
    console.log("[dry-run] Would ensure groups:", SITE_EMPLOYEE_GROUP_NAMES.join(", "));
    await exitWith(0);
  }

  const { created, skipped } = await ensureSiteEmployeeGroups(prisma, companyId, { verbose: true });
  console.log(`Done. Created ${created}, skipped ${skipped} (already present).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
