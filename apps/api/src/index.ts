import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastify from "fastify";
import { buildApp } from "./create-app.js";

/** Keeps a direct `fastify` import for Vercel's Fastify entry detection. */
void fastify;

/** True only when this file is the Node entrypoint (`node dist/index.js`), not when Vercel imports it as a side module. */
function isPrimaryNodeEntry(): boolean {
  const entry = process.argv[1];
  if (entry == null) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(entry);
}

async function main(): Promise<void> {
  const app = await buildApp();
  const port = Number(process.env.PORT) || 3001;
  const host = process.env.HOST ?? "0.0.0.0";
  try {
    await app.listen({ port, host });
    console.log(`Plethora API running at http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (isPrimaryNodeEntry()) {
  void main();
}
