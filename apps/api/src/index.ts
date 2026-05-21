import "dotenv/config";
import { buildApp } from "./app.js";
import { env } from "./lib/env.js";

let app;
try {
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
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
