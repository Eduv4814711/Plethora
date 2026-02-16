/**
 * Backfill employeeNumber for existing employees that have null.
 * Run once after adding the employeeNumber column.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const employees = await prisma.employee.findMany({
    where: { employeeNumber: null },
    orderBy: [{ companyId: "asc" }, { createdAt: "asc" }],
    select: { id: true, companyId: true },
  });

  if (employees.length === 0) {
    console.log("No employees need backfilling.");
    return;
  }

  const byCompany = new Map<string, typeof employees>();
  for (const e of employees) {
    const list = byCompany.get(e.companyId) ?? [];
    list.push(e);
    byCompany.set(e.companyId, list);
  }

  let updated = 0;
  for (const [companyId, list] of byCompany) {
    const existing = await prisma.employee.findMany({
      where: { companyId, employeeNumber: { not: null } },
      select: { employeeNumber: true },
    });
    let maxNum = 0;
    for (const e of existing) {
      const m = (e.employeeNumber ?? "").match(/^EMP-(\d+)$/i);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    for (let i = 0; i < list.length; i++) {
      const emp = list[i];
      const employeeNumber = `EMP-${String(maxNum + i + 1).padStart(4, "0")}`;
      await prisma.employee.update({
        where: { id: emp.id },
        data: { employeeNumber },
      });
      updated++;
    }
  }

  console.log(`Backfilled employeeNumber for ${updated} employees.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
