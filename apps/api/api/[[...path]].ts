import type { IncomingMessage, ServerResponse } from "node:http";
import Fastify from "fastify";
import { buildApp } from "../dist/create-app.js";

/** Referenced so Vercel's Fastify build step sees a direct `fastify` import on this entry. */
void Fastify.version;

let appPromise: ReturnType<typeof buildApp> | undefined;

/**
 * Vercel optional catch-all adds a `[...path]` query param; the function is mounted under `/api`.
 * Fastify routes expect `/health`, `/auth/...`, etc. Normalize before dispatch.
 */
function normalizeVercelRequestUrl(full: string): string {
  const q0 = full.indexOf("?");
  const path0 = q0 === -1 ? full : full.slice(0, q0);
  const query0 = q0 === -1 ? "" : full.slice(q0 + 1);

  let pathAndQuery: string;
  if (query0) {
    const sp = new URLSearchParams(query0);
    sp.delete("[...path]");
    const rest = sp.toString();
    pathAndQuery = rest ? `${path0}?${rest}` : path0;
  } else {
    pathAndQuery = path0;
  }

  const q = pathAndQuery.indexOf("?");
  const pathPart = q === -1 ? pathAndQuery : pathAndQuery.slice(0, q);
  const searchPart = q === -1 ? "" : pathAndQuery.slice(q);

  let next: string;
  if (pathPart === "/api") next = "/";
  else if (pathPart.startsWith("/api/")) next = pathPart.slice(4) || "/";
  else next = pathPart;

  if (!next.startsWith("/")) next = `/${next}`;
  return next + searchPart;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  req.url = normalizeVercelRequestUrl(req.url ?? "/");

  if (!appPromise) appPromise = buildApp();
  const app = await appPromise;
  await app.ready();
  app.server.emit("request", req, res);
}
