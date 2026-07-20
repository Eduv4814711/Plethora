import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function hostFromUrl(databaseUrl) {
  if (!databaseUrl?.trim()) return "(not set)";
  try {
    return new URL(databaseUrl.replace(/^postgresql:/i, "postgres:")).hostname;
  } catch {
    return "(invalid)";
  }
}

const host = hostFromUrl(process.env.DATABASE_URL);
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/plethora",
  }),
});

try {
  await prisma.$queryRaw`SELECT 1`;
  console.log(`OK: connected to PostgreSQL at ${host}`);
  process.exit(0);
} catch (err) {
  console.error(`FAIL: cannot reach PostgreSQL at ${host}`);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
