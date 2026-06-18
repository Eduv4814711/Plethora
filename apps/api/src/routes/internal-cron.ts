import type { FastifyInstance } from "fastify";
import { env } from "../lib/env.js";
import { runGlobalAutoRoster } from "../services/auto-roster.service.js";

function authorizeCron(request: { headers: { authorization?: string } }): boolean {
  const secret = env.cronSecret?.trim();
  if (!secret) return false;
  const auth = request.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token.length > 0 && token === secret;
}

export async function internalCronRoutes(app: FastifyInstance) {
  app.post("/cron/auto-roster", async (request, reply) => {
    if (!authorizeCron(request)) {
      return reply.code(env.cronSecret ? 401 : 503).send({
        error: env.cronSecret ? "Unauthorized" : "Cron not configured",
        message: env.cronSecret
          ? "Invalid or missing Authorization bearer token"
          : "Set CRON_SECRET on the API service to enable scheduled auto-roster",
      });
    }

    const result = await runGlobalAutoRoster();
    return reply.send({
      ok: true,
      companiesProcessed: result.companies.length,
      result,
    });
  });
}
