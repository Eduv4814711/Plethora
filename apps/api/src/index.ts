import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { env } from "./lib/env.js";
import { databaseHostFromUrl, verifyDatabaseConnection } from "./lib/db-connectivity.js";
import { prisma } from "./lib/prisma.js";

let app: FastifyInstance;
try {
  await verifyDatabaseConnection();
  console.log(`Database connected (${databaseHostFromUrl(process.env.DATABASE_URL)})`);
  app = await buildApp();
} catch (err) {
  console.error("FATAL: API failed to initialize (check environment variables, logs above):", err);
  process.exit(1);
}

const port = env.port;
const host = env.host;

try {
  await app.listen({ port, host });
  console.log(`Plethora API running at http://${host}:${port}`);
  if (env.whatsapp.enabled) {
    console.log(
      `[WhatsApp] Enabled (phone number ID ${env.whatsapp.phoneNumberId}, API ${env.whatsapp.apiVersion})`
    );
  } else if (env.isProduction) {
    console.warn(
      "[WhatsApp] Disabled (WHATSAPP_ENABLED is not true)"
    );
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "graceful shutdown started");

  try {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    app.log.error({ err, signal }, "graceful shutdown failed");
    process.exit(1);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
