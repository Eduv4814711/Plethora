import { prisma } from "../../src/lib/prisma.js";
import { scanDataQuality } from "../../src/services/data-quality.service.js";

const companyNameIndex = process.argv.indexOf("--company-name");
const companyName = companyNameIndex >= 0 ? process.argv[companyNameIndex + 1] : undefined;

if (!companyName) {
  throw new Error("Pass --company-name to avoid scanning the wrong development tenant");
}

try {
  const company = await prisma.company.findFirst({ where: { name: companyName }, select: { id: true, name: true } });
  if (!company) throw new Error(`Company not found: ${companyName}`);
  const result = await scanDataQuality(company.id);
  console.log(JSON.stringify({ company: company.name, ...result }, null, 2));
} finally {
  await prisma.$disconnect();
}
