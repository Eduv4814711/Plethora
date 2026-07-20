/**
 * Run before applying the migration that adds User.email @unique.
 * Exits with code 1 if any duplicate emails exist across companies.
 *
 * Usage: npx tsx prisma/check-duplicate-emails.ts
 * Or: npm run db:check-email-unique (from apps/api)
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/plethora",
  }),
});

async function main() {
  const duplicates = await prisma.$queryRaw<
    { email: string; count: bigint }[]
  >`
    SELECT email, COUNT(*) as count
    FROM "User"
    GROUP BY email
    HAVING COUNT(*) > 1
  `;

  if (duplicates.length > 0) {
    console.error(
      "Duplicate user emails found. Resolve these before applying the unique email migration:"
    );
    for (const row of duplicates) {
      console.error(`  - ${row.email} (${row.count} users)`);
    }
    process.exit(1);
  }
  console.log("No duplicate emails found. Safe to run prisma migrate.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
