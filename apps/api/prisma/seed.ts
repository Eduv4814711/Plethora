import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  let company = await prisma.company.findFirst({
    where: { name: "Quick Bopha Security" },
  });

  if (!company) {
    company = await prisma.company.create({
      data: { name: "Quick Bopha Security" },
    });
  }

  const existingUser = await prisma.user.findFirst({
    where: { email: "admin@quickbopha.com", companyId: company.id },
  });

  if (!existingUser) {
    const passwordHash = await bcrypt.hash("admin123", 12);
    await prisma.user.create({
      data: {
        companyId: company.id,
        name: "Admin User",
        email: "admin@quickbopha.com",
        passwordHash,
        role: "admin",
      },
    });
  }

  console.log("Seed completed: company and admin user created");
  console.log("Login: admin@quickbopha.com / admin123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
