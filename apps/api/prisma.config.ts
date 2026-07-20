import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Keep generation/builds independent of local secrets. Database commands
    // still fail naturally unless a reachable DATABASE_URL is supplied.
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/plethora",
  },
});
