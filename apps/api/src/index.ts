import "dotenv/config";
import Fastify from "fastify";
import { buildApp } from "./create-app.js";

void Fastify.version;

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
