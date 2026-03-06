/**
 * Seed the database with initial company and admin user.
 * Run: npm run db:seed (from api workspace) or npx prisma db seed
 */
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const ADMIN_EMAIL = "admin@quickbopha.com";
const ADMIN_PASSWORD = "admin123";
const COMPANY_NAME = "Quick Bopha Security";

async function main() {
  // Create company if it doesn't exist
  let company = await prisma.company.findFirst({
    where: { name: COMPANY_NAME },
  });

  if (!company) {
    company = await prisma.company.create({
      data: {
        name: COMPANY_NAME,
        settings: {
          currency: "ZAR",
          dateFormat: "DD/MM/YYYY",
          timezone: "Africa/Johannesburg",
          payrollPeriod: "monthly",
          employeeIdPrefix: "EMP",
        },
      },
    });
    console.log(`Created company: ${company.name}`);
  }

  // Create admin user if it doesn't exist
  const existingUser = await prisma.user.findFirst({
    where: {
      companyId: company.id,
      email: ADMIN_EMAIL,
    },
  });

  if (!existingUser) {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await prisma.user.create({
      data: {
        companyId: company.id,
        name: "Admin",
        email: ADMIN_EMAIL,
        passwordHash,
        role: "admin",
      },
    });
    console.log(`Created admin user: ${ADMIN_EMAIL}`);
    console.log(`Login with: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  } else {
    console.log(`Admin user already exists: ${ADMIN_EMAIL}`);
    console.log(`If you forgot the password, run: npx tsx prisma/reset-admin.ts`);
  }
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
