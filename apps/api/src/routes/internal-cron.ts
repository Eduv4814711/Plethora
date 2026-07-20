import type { FastifyInstance } from "fastify";
import { env } from "../lib/env.js";
import { runGlobalAutoRoster } from "../services/auto-roster.service.js";
import { reconcileContinuousRosters } from "../modules/rosters/roster-continuity.service.js";
import { prisma } from "../lib/prisma.js";
import { detectAndPersistExceptions } from "../modules/attendance-exceptions/exceptions.service.js";
import { syncContractExpiryAlerts, syncDocumentExpiryAlerts } from "../modules/documents/documents.service.js";

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

    const [legacy, continuous] = await Promise.all([
      runGlobalAutoRoster(),
      reconcileContinuousRosters(),
    ]);
    return reply.send({
      ok: true,
      companiesProcessed: legacy.companies.length,
      result: { legacy, continuous },
    });
  });

  app.post("/cron/msr-sync", async (request, reply) => {
    if (!authorizeCron(request)) {
      return reply.code(env.cronSecret ? 401 : 503).send({
        error: env.cronSecret ? "Unauthorized" : "Cron not configured",
        message: env.cronSecret
          ? "Invalid or missing Authorization bearer token"
          : "Set CRON_SECRET on the API service to enable scheduled MSR sync",
      });
    }

    const companies = await prisma.company.findMany({ select: { id: true } });
    const results: {
      companyId: string;
      exceptions: { created: number; scanned: number };
      contractAlerts: number;
      documentAlerts: number;
    }[] = [];

    for (const { id: companyId } of companies) {
      const [exceptions, contractAlerts, documentAlerts] = await Promise.all([
        detectAndPersistExceptions({ companyId, lookbackHours: 48 }),
        syncContractExpiryAlerts(companyId).then((r) => r.created).catch(() => 0),
        syncDocumentExpiryAlerts(companyId).then((r) => r.created).catch(() => 0),
      ]);
      results.push({
        companyId,
        exceptions: { created: exceptions.created, scanned: exceptions.scanned },
        contractAlerts,
        documentAlerts,
      });
    }

    return reply.send({
      ok: true,
      companiesProcessed: companies.length,
      results,
    });
  });
}
