/**
 * Migrate existing users to the new permission model.
 * Run: npx tsx scripts/migrate-user-permissions.ts
 */
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { PrismaClient } from "@prisma/client";
import {
  PERMISSION_PRESETS,
  PRESET_KEYS,
  defaultPresetForRole,
  type PresetKey,
} from "../src/lib/permissions.js";
import { resolveEffectiveModuleAccess } from "../src/lib/module-access.js";

const prisma = new PrismaClient();

interface MigrationRow {
  userId: string;
  email: string;
  companyId: string;
  oldRole: string;
  preset: PresetKey;
  isSystemOwner: boolean;
  permissionCount: number;
}

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const report: MigrationRow[] = [];

  for (const company of companies) {
    const admins = await prisma.user.findMany({
      where: { companyId: company.id, role: "admin" },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, role: true, createdAt: true },
    });
    const firstAdminId = admins[0]?.id;

    const users = await prisma.user.findMany({
      where: { companyId: company.id },
      select: { id: true, email: true, role: true, moduleAccess: true },
    });

    for (const user of users) {
      const isSystemOwner = user.id === firstAdminId && user.role === "admin";
      const presetKey = isSystemOwner
        ? PRESET_KEYS.SYSTEM_OWNER
        : defaultPresetForRole(user.role, false);
      const permissions = PERMISSION_PRESETS[presetKey].permissions;
      const moduleAccess = resolveEffectiveModuleAccess({
        role: user.role,
        moduleAccess: user.moduleAccess,
        isSystemOwner,
      });

      await prisma.$transaction(async (tx) => {
        await tx.userPermission.deleteMany({ where: { userId: user.id } });
        if (!isSystemOwner && permissions.length > 0) {
          await tx.userPermission.createMany({
            data: permissions.map((permission) => ({ userId: user.id, permission })),
          });
        }
        await tx.user.update({
          where: { id: user.id },
          data: {
            isSystemOwner,
            accessVersion: { increment: 1 },
            ...(moduleAccess ? { moduleAccess } : {}),
          },
        });
      });

      report.push({
        userId: user.id,
        email: user.email,
        companyId: company.id,
        oldRole: user.role,
        preset: presetKey,
        isSystemOwner,
        permissionCount: isSystemOwner ? permissions.length : permissions.length,
      });

      console.log(
        `${user.email} (${user.role}) → ${presetKey}${isSystemOwner ? " [SYSTEM OWNER]" : ""}`
      );
    }
  }

  // Seed permission presets
  for (const [key, preset] of Object.entries(PERMISSION_PRESETS)) {
    await prisma.permissionPreset.upsert({
      where: { key },
      create: {
        key,
        name: preset.name,
        description: preset.description,
        permissions: preset.permissions,
      },
      update: {
        name: preset.name,
        description: preset.description,
        permissions: preset.permissions,
      },
    });
  }

  const csv = [
    "userId,email,companyId,oldRole,preset,isSystemOwner,permissionCount",
    ...report.map(
      (r) =>
        `${r.userId},${r.email},${r.companyId},${r.oldRole},${r.preset},${r.isSystemOwner},${r.permissionCount}`
    ),
  ].join("\n");

  const reportPath = join(__dirname, "..", "permission-migration-report.csv");
  writeFileSync(reportPath, csv);
  console.log(`\nMigration complete. Report: ${reportPath}`);
  console.log(`Migrated ${report.length} users across ${companies.length} companies.`);
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
