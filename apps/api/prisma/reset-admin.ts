/**
 * Reset the admin user password to admin123.
 * Run: npx tsx prisma/reset-admin.ts
 * Or: npm run db:reset-admin (from api workspace)
 */
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const email = "admin@quickbopha.com";
  const newPassword = "admin123";

  const user = await prisma.user.findFirst({
    where: { email },
  });

  if (!user) {
    console.error("Admin user not found. Create an admin user through the app first.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  console.log(`Password reset for ${email}`);
  console.log(`Login with: ${email} / ${newPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
