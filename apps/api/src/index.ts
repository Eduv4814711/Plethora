import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./lib/env.js";
import { databaseHostFromUrl, verifyDatabaseConnection } from "./lib/db-connectivity.js";

let app;
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
      "[WhatsApp] Not configured — set WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, and WHATSAPP_VERIFY_TOKEN to enable inbound replies"
    );
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
