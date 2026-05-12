/**
 * Import employees from a Plethora-compatible CSV (same columns as Settings → Migrate / export).
 *
 * Usage (from apps/api):
 *   npx tsx scripts/import-employees-csv.ts <path-to.csv> --company-id <cuid>
 *   npx tsx scripts/import-employees-csv.ts <path-to.csv> --dry-run
 *
 * By default, rows may omit PSIRA / pay rates (same as other optional fields); complete them in the app.
 * Use --strict to enforce the same PSIRA and pay rules as Settings → Migrate.
 *
 * Env: DATABASE_URL in .env. Optional: IMPORT_COMPANY_ID if you omit --company-id.
 *
 * Optional flags (after successful import only; skipped on --dry-run):
 *   --default-group-id <cuid>   Set groupId on imported rows (matched by employee number from CSV)
 *   --default-grade-id <cuid>   Set gradeId on those rows
 */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "..", ".env") });

import { prisma } from "../src/lib/prisma.js";
import {
  executeSelfImport,
  parseAndValidateEmployees,
  type ValidatedEmployee,
} from "../src/services/migration.service.js";

function parseArgs(argv: string[]) {
  let dryRun = false;
  /** When true, require PSIRA + pay for security and pay for office (same as migration UI). */
  let strictValidation = false;
  let csvPath: string | undefined;
  let companyId = process.env.IMPORT_COMPANY_ID?.trim() || undefined;
  let defaultGroupId: string | undefined;
  let defaultGradeId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--strict") {
      strictValidation = true;
      continue;
    }
    if (a === "--company-id" && argv[i + 1]) {
      companyId = argv[++i].trim();
      continue;
    }
    if (a === "--default-group-id" && argv[i + 1]) {
      defaultGroupId = argv[++i].trim();
      continue;
    }
    if (a === "--default-grade-id" && argv[i + 1]) {
      defaultGradeId = argv[++i].trim();
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown flag: ${a}`);
    }
    csvPath = resolve(process.cwd(), a);
  }

  return { dryRun, strictValidation, csvPath, companyId, defaultGroupId, defaultGradeId };
}

function employeeNumbersFromValid(valid: ValidatedEmployee[]): string[] {
  const out: string[] = [];
  for (const e of valid) {
    const n = e.employeeNumber?.trim();
    if (n) out.push(n);
  }
  return out;
}

async function main() {
  const { dryRun, strictValidation, csvPath, companyId, defaultGroupId, defaultGradeId } = parseArgs(
    process.argv.slice(2)
  );

  async function exitWith(code: number, message?: string): Promise<never> {
    if (message) {
      if (code === 0) console.log(message);
      else console.error(message);
    }
    await prisma.$disconnect().catch(() => {});
    process.exit(code);
  }

  if (!csvPath) {
    await exitWith(
      1,
      "Usage: npx tsx scripts/import-employees-csv.ts <path-to.csv> [--company-id <cuid>] [--dry-run] [--strict] [--default-group-id <id>] [--default-grade-id <id>]\n" +
        "Env: DATABASE_URL, optional IMPORT_COMPANY_ID. Default: relaxed row rules (omit --strict)."
    );
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(csvPath);
  } catch (e) {
    console.error(`Cannot read CSV: ${csvPath}`, e);
    await exitWith(1);
  }

  const allowIncompleteRows = !strictValidation;
  if (!strictValidation) {
    console.log("Using relaxed validation (missing PSIRA/pay allowed). Use --strict for migration UI rules.");
  }

  const { valid, errors } = parseAndValidateEmployees(buffer, {
    requireCompanyName: false,
    allowIncompleteRows,
  });

  if (errors.length > 0) {
    console.error(`Validation failed: ${errors.length} issue(s)`);
    for (const err of errors) {
      console.error(`  Row ${err.row} [${err.field}]: ${err.message} (value: ${JSON.stringify(err.value)})`);
    }
    await exitWith(1);
  }

  console.log(`Valid rows: ${valid.length}`);

  if (dryRun) {
    await exitWith(0, "Dry run: no database writes.");
  }

  if (!companyId) {
    await exitWith(1, "Missing --company-id or IMPORT_COMPANY_ID (not required for --dry-run).");
  }

  const company = await prisma.company.findFirst({
    where: { id: companyId },
    select: { id: true, name: true },
  });
  if (!company) {
    await exitWith(1, `No company found for id: ${companyId}`);
  }
  console.log(`Company: ${company.name} (${company.id})`);

  if (defaultGroupId) {
    const g = await prisma.employeeGroup.findFirst({
      where: { id: defaultGroupId, companyId },
      select: { id: true },
    });
    if (!g) {
      await exitWith(1, `--default-group-id not found or wrong company: ${defaultGroupId}`);
    }
  }

  if (defaultGradeId) {
    const gr = await prisma.payGrade.findFirst({
      where: { id: defaultGradeId, companyId },
      select: { id: true },
    });
    if (!gr) {
      await exitWith(1, `--default-grade-id not found or wrong company: ${defaultGradeId}`);
    }
  }

  const result = await executeSelfImport(companyId, valid, []);

  console.log(`Employees created: ${result.employeesCreated}`);
  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.warn(`  [${err.entity}] ${err.message}`);
    }
  }

  const numbers = employeeNumbersFromValid(valid);
  if ((defaultGroupId || defaultGradeId) && numbers.length > 0) {
    const update: { groupId?: string; gradeId?: string } = {};
    if (defaultGroupId) update.groupId = defaultGroupId;
    if (defaultGradeId) update.gradeId = defaultGradeId;

    const res = await prisma.employee.updateMany({
      where: {
        companyId,
        employeeNumber: { in: numbers },
      },
      data: update,
    });
    console.log(`Updated group/grade on ${res.count} employee row(s) (matched by employee number from CSV).`);
  } else if (defaultGroupId || defaultGradeId) {
    console.warn("No explicit employee numbers in CSV; skipped --default-group-id / --default-grade-id update.");
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
