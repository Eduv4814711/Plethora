import { spawnSync } from "node:child_process";

if (process.env.databaseUrl || process.env.DATABASE_URL) {
  console.log("[deploy-migrations] Recovering failed migrations if present...");
  spawnSync("npx", ["prisma", "migrate", "resolve", "--rolled-back", "20260902120000_employee_compliance_documents_columns"], {
    stdio: "inherit",
    shell: true,
  });
}

console.log("[deploy-migrations] Running prisma migrate deploy...");
const deploy = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: true,
});

if (deploy.status !== 0) {
  process.exit(deploy.status ?? 1);
}
