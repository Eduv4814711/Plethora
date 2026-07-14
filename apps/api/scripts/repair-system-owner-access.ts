/**
 * One-off: ensure each company's earliest admin is system owner with full access.
 * Run: npm run db:repair-system-owner
 *   or: npx tsx scripts/repair-system-owner-access.ts
 *
 * Bumps accessVersion and revokes refresh tokens for repaired users — they must
 * sign out and sign in again before full owner access applies to their JWT.
 */
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient, Prisma } from "@prisma/client";
import { grantSystemOwner } from "../src/services/user-access.service.js";

const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  for (const company of companies) {
    const admins = await prisma.user.findMany({
      where: { companyId: company.id, role: "admin" },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, isSystemOwner: true, moduleAccess: true },
    });
    const main = admins[0];
    if (!main) {
      console.log(`${company.name}: no admin users`);
      continue;
    }
    await prisma.user.update({
      where: { id: main.id },
      data: {
        isSystemOwner: true,
        moduleAccess: Prisma.JsonNull,
        accessVersion: { increment: 1 },
      },
    });
    await grantSystemOwner(main.id);
    console.log(
      `${company.name}: ${main.email} → system owner (wasOwner=${main.isSystemOwner}, hadModules=${JSON.stringify(main.moduleAccess)})`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
