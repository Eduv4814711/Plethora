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
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";
import { z } from "zod";
import { ensureSiteEmployeeGroups } from "../src/lib/site-employee-groups.js";
import { validatePassword } from "../src/lib/password-policy.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database seeding.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: databaseUrl,
  }),
});

const COMPANY_NAME = "Quick Bopha Security";

function seedAdminIdentity(): { email: string; password: string } {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";

  if (!email || !password) {
    throw new Error(
      "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required for database seeding."
    );
  }

  if (!z.string().email().safeParse(email).success) {
    throw new Error("SEED_ADMIN_EMAIL must be a valid email address.");
  }

  const passwordCheck = validatePassword(password, { companyName: COMPANY_NAME });
  if (!passwordCheck.valid) {
    throw new Error(`SEED_ADMIN_PASSWORD is not safe: ${passwordCheck.message}`);
  }

  return { email, password };
}

async function main() {
  const { email: adminEmail, password: adminPassword } = seedAdminIdentity();

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
      email: adminEmail,
    },
  });

  if (!existingUser) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const createdOwner = await prisma.user.create({
      data: {
        companyId: company.id,
        name: "Admin",
        email: adminEmail,
        passwordHash,
        accountType: "staff",
      },
    });
    await prisma.company.update({
      where: { id: company.id },
      data: { ownerUserId: createdOwner.id },
    });
    console.log(`Created admin user: ${adminEmail}`);
    console.log("The seed password was read from SEED_ADMIN_PASSWORD and was not printed.");
  } else {
    if (!company.ownerUserId) {
      if (!existingUser.isActive) {
        throw new Error("The existing seed administrator is inactive and cannot become company owner.");
      }
      await prisma.company.update({
        where: { id: company.id },
        data: { ownerUserId: existingUser.id },
      });
    }
    console.log(`Admin user already exists: ${adminEmail}`);
    console.log(`If you forgot the password, run: npx tsx prisma/reset-admin.ts`);
  }

  const { created: groupsCreated, skipped: groupsSkipped } = await ensureSiteEmployeeGroups(prisma, company.id);
  if (groupsCreated > 0 || groupsSkipped > 0) {
    console.log(
      `Site employee groups: created ${groupsCreated}, already present ${groupsSkipped} (${groupsCreated + groupsSkipped} total in list).`
    );
  }

  // Ensure default external payroll export profiles exist for this company
  const defaultProfiles = [
    {
      name: "Sage Business Cloud Payroll ZA",
      provider: "SAGE_BUSINESS_CLOUD_ZA" as const,
      isDefault: true,
      splitBySite: true,
      delimiter: ",",
      dateFormat: "yyyy-MM-dd",
      codeMappingJson: {
        regularHours: "1000",
        overtimeHours: "1010",
        sundayHours: "1020",
        publicHolidayHours: "1030",
        nightShiftHours: "1040",
        annualLeaveHours: "2000",
        sickLeaveHours: "2010",
        familyLeaveHours: "2020",
        studyLeaveHours: "2030",
        unpaidLeaveHours: "2090",
      },
    },
    {
      name: "Generic Timesheet CSV",
      provider: "GENERIC_CSV" as const,
      isDefault: false,
      splitBySite: true,
      delimiter: ",",
      dateFormat: "yyyy-MM-dd",
      codeMappingJson: {},
    },
  ];
  for (const profile of defaultProfiles) {
    const existingProfile = await prisma.payrollExportProfile.findFirst({
      where: { companyId: company.id, provider: profile.provider, name: profile.name },
      select: { id: true },
    });
    if (!existingProfile) {
      await prisma.payrollExportProfile.create({
        data: {
          companyId: company.id,
          name: profile.name,
          provider: profile.provider,
          isDefault: profile.isDefault,
          splitBySite: profile.splitBySite,
          delimiter: profile.delimiter,
          dateFormat: profile.dateFormat,
          codeMappingJson: profile.codeMappingJson,
        },
      });
    }
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
