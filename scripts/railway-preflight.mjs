import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const errors = [];

function requireFile(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) errors.push(`Missing required file: ${path}`);
  return absolute;
}

for (const path of [
  "package-lock.json",
  "apps/api/railway.toml",
  "apps/web/railway.toml",
  "apps/api/prisma/schema.prisma",
  ".env.railway.api.example",
  ".env.railway.web.example",
  ".railwayignore",
]) requireFile(path);

const apiRailway = readFileSync(requireFile("apps/api/railway.toml"), "utf8");
if (!apiRailway.includes('startCommand = "cd apps/api && npm start"')) {
  errors.push("API Railway start command must use the migration-safe npm start path");
}
if (!apiRailway.includes('healthcheckPath = "/health"')) {
  errors.push("API Railway healthcheck must use /health");
}

const webRailway = readFileSync(requireFile("apps/web/railway.toml"), "utf8");
if (!webRailway.includes('startCommand = "cd apps/web && npm run start"')) {
  errors.push("Web Railway start command is missing or invalid");
}

const migrationRoot = requireFile("apps/api/prisma/migrations");
if (existsSync(migrationRoot)) {
  for (const entry of readdirSync(migrationRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !existsSync(join(migrationRoot, entry.name, "migration.sql"))) {
      errors.push(`Migration has no migration.sql: ${entry.name}`);
    }
  }
}

const ignore = readFileSync(requireFile(".gitignore"), "utf8");
for (const required of [".env", "node_modules", "pgsql/", "tools-postgresql*.zip"]) {
  if (!ignore.includes(required)) errors.push(`.gitignore must exclude ${required}`);
}

if (errors.length) {
  console.error(`Railway preflight failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exit(1);
}

console.log("Railway preflight passed: configs, migrations, lockfile, and ignore rules are present.");
