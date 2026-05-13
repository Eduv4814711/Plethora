import type { PrismaClient } from "@prisma/client";

/** Site / location labels used as employee groups (assign employees in the app). */
export const SITE_EMPLOYEE_GROUP_NAMES = [
  "Donkervleit Recreation Centre",
  "Engen Garage",
  "Gontse Primary School",
  "JB Mark Recreation Centre",
  "Kgakala Library",
  "Klerksdorp Library",
  "Lakenvallei Farm",
  "Lebaleng Library",
  "Leedoring Library",
  "Lichenry Construction",
  "Lufhereng Social Housing",
  "Makwassie Library",
  "Noyons Recreation Centre",
  "Tswelelang Library",
] as const;

/**
 * Create missing EmployeeGroup rows for the standard site list (idempotent per name + company).
 */
export async function ensureSiteEmployeeGroups(
  prisma: Pick<PrismaClient, "employeeGroup">,
  companyId: string,
  options?: { verbose?: boolean }
): Promise<{ created: number; skipped: number }> {
  const verbose = options?.verbose ?? false;
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < SITE_EMPLOYEE_GROUP_NAMES.length; i++) {
    const name = SITE_EMPLOYEE_GROUP_NAMES[i];
    const existing = await prisma.employeeGroup.findFirst({
      where: { companyId, name },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      if (verbose) console.log(`  skip (exists): ${name}`);
      continue;
    }
    await prisma.employeeGroup.create({
      data: {
        companyId,
        name,
        description: null,
        sortOrder: i,
      },
    });
    created++;
    if (verbose) console.log(`  created: ${name}`);
  }

  return { created, skipped };
}
