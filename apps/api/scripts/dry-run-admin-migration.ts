import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

const owners = await prisma.user.findMany({
  where: { isSystemOwner: true },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  select: { id: true, name: true, email: true, createdAt: true, company: { select: { id: true, name: true } } },
});

const quickBophaOwners = owners.filter(({ company }) => {
  const name = company.name.toLowerCase();
  return name.includes("quick") && name.includes("bopha") && !/(test|fixture|demo)/.test(name);
});
const initialRoot = quickBophaOwners[0];

console.log("Root/System Admin migration dry run");
console.log(`Existing system owners: ${owners.length}`);
console.log(`Eligible Quick Bopha owners: ${quickBophaOwners.length}`);
if (!initialRoot) {
  console.error("BLOCKED: no eligible Quick Bopha system owner was found. The migration would create no Root Admin.");
  process.exitCode = 1;
} else {
  console.log("Initial Root Admin candidate:");
  console.table([{ name: initialRoot.name, email: initialRoot.email, company: initialRoot.company.name, createdAt: initialRoot.createdAt.toISOString() }]);
  console.log(`${Math.max(owners.length - 1, 0)} other owner account(s) will become System Admins without implicit access.`);
}

await prisma.$disconnect();
