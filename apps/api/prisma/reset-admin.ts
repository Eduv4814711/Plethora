/**
 * Reset an admin password using explicit environment variables.
 * Run: npx tsx prisma/reset-admin.ts
 * Or: npm run db:reset-admin (from api workspace)
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
import { validatePassword } from "../src/lib/password-policy.js";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/plethora",
  }),
});

async function main() {
  const email = process.env.RESET_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const newPassword = process.env.RESET_ADMIN_PASSWORD ?? "";

  if (!email || !newPassword) {
    throw new Error("RESET_ADMIN_EMAIL and RESET_ADMIN_PASSWORD are required.");
  }

  if (!z.string().email().safeParse(email).success) {
    throw new Error("RESET_ADMIN_EMAIL must be a valid email address.");
  }

  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.valid) {
    throw new Error(`RESET_ADMIN_PASSWORD is not safe: ${passwordCheck.message}`);
  }

  const user = await prisma.user.findFirst({
    where: { email },
  });

  if (!user) {
    console.error("Admin user not found. Create an admin user through the app first.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordSetupRequired: false,
        passwordSetupTokenHash: null,
        passwordSetupTokenExpiresAt: null,
        passwordSetupTokenConsumedAt: new Date(),
      },
    }),
    prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
  ]);

  console.log(`Password reset for ${email}`);
  console.log("Existing refresh sessions were revoked. The new password was not printed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
