/**
 * Explicitly repair system-owner access for one user in one company.
 *
 * Usage:
 *   npx tsx scripts/repair-system-owner-access.ts --company-id <uuid> --user-id <uuid> [--dry-run]
 *   npx tsx scripts/repair-system-owner-access.ts --company-id <uuid> --email <email> [--dry-run]
 *
 * Does not auto-select users. Never prints credentials, tokens, or DATABASE_URL.
 */
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient, Prisma } from "@prisma/client";
import {
  clearUserAccessCache,
  grantSystemOwner,
  incrementAccessVersion,
} from "../src/services/user-access.service.js";

export type RepairArgs = {
  companyId: string | null;
  userId: string | null;
  email: string | null;
  dryRun: boolean;
  help: boolean;
};

export function parseRepairArgs(argv: string[]): RepairArgs {
  const out: RepairArgs = {
    companyId: null,
    userId: null,
    email: null,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--company-id") {
      out.companyId = argv[++i] ?? null;
      continue;
    }
    if (arg === "--user-id") {
      out.userId = argv[++i] ?? null;
      continue;
    }
    if (arg === "--email") {
      out.email = argv[++i] ?? null;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

export function usage(): string {
  return [
    "Usage:",
    "  npx tsx scripts/repair-system-owner-access.ts --company-id <uuid> --user-id <uuid> [--dry-run]",
    "  npx tsx scripts/repair-system-owner-access.ts --company-id <uuid> --email <email> [--dry-run]",
    "",
    "Requires an explicit company and exactly one target user (by id or email).",
  ].join("\n");
}

type RepairResult = {
  changed: boolean;
  message: string;
};

export async function repairSystemOwnerAccess(
  prisma: PrismaClient,
  args: RepairArgs
): Promise<RepairResult> {
  if (!args.companyId) {
    throw new Error("Missing required --company-id");
  }
  if (!args.userId && !args.email) {
    throw new Error("Provide exactly one of --user-id or --email");
  }
  if (args.userId && args.email) {
    throw new Error("Provide only one of --user-id or --email, not both");
  }

  const company = await prisma.company.findUnique({
    where: { id: args.companyId },
    select: { id: true, name: true },
  });
  if (!company) {
    throw new Error("Company not found for the given --company-id");
  }

  const users = await prisma.user.findMany({
    where: {
      companyId: args.companyId,
      ...(args.userId
        ? { id: args.userId }
        : { email: { equals: args.email!.trim().toLowerCase(), mode: "insensitive" as const } }),
    },
    select: {
      id: true,
      email: true,
      isSystemOwner: true,
      moduleAccess: true,
      accessVersion: true,
    },
  });

  if (users.length === 0) {
    throw new Error("No matching user in that company");
  }
  if (users.length > 1) {
    throw new Error("Ambiguous email match: more than one user found; use --user-id");
  }

  const target = users[0]!;
  const needsOwnerFlag = !target.isSystemOwner;
  const needsModuleClear = target.moduleAccess !== null;

  if (!needsOwnerFlag && !needsModuleClear) {
    return {
      changed: false,
      message: `No change required: ${target.email} is already system owner with unrestricted module access (company=${company.name}).`,
    };
  }

  if (args.dryRun) {
    return {
      changed: true,
      message: `Dry-run: would set isSystemOwner=true, clear moduleAccess, bump accessVersion once, revoke refresh tokens for ${target.email} (company=${company.name}).`,
    };
  }

  if (needsOwnerFlag) {
    // Clear restrictive modules without a separate version bump; grantSystemOwner bumps once.
    await prisma.user.update({
      where: { id: target.id },
      data: { moduleAccess: Prisma.JsonNull },
    });
    await grantSystemOwner(target.id);
  } else {
    await prisma.user.update({
      where: { id: target.id },
      data: { moduleAccess: Prisma.JsonNull },
    });
    await incrementAccessVersion(target.id);
    clearUserAccessCache(target.id);
  }

  return {
    changed: true,
    message: `Updated: ${target.email} is now system owner with unrestricted module access (company=${company.name}).`,
  };
}

async function main() {
  let args: RepairArgs;
  try {
    args = parseRepairArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    console.error(usage());
    process.exit(1);
  }

  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const prisma = new PrismaClient();
  try {
    const result = await repairSystemOwnerAccess(prisma, args);
    console.log(result.message);
    process.exit(0);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    console.error(usage());
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("repair-system-owner-access.ts") ||
    process.argv[1].endsWith("repair-system-owner-access.js"));

if (isDirectRun) {
  void main();
}
