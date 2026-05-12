import "dotenv/config";
import { buildApp } from "./app.js";

let app;
try {
  app = await buildApp();
} catch (err) {
  console.error("FATAL: API failed to initialize (check JWT, DATABASE_URL, logs above):", err);
  process.exit(1);
}

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  console.log(`Plethora API running at http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
