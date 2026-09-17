import type { FastifyInstance } from "fastify";
import { env } from "../lib/env.js";
import { runGlobalAutoRoster } from "../services/auto-roster.service.js";
import { reconcileContinuousRosters } from "../modules/rosters/roster-continuity.service.js";
import { prisma } from "../lib/prisma.js";
import { detectAndPersistExceptions } from "../modules/attendance-exceptions/exceptions.service.js";
import { syncContractExpiryAlerts, syncDocumentExpiryAlerts } from "../modules/documents/documents.service.js";

/**
 * Audit actions that survive retention pruning. These are the accountability
 * record itself — who was granted what, who signed in, and what was refused.
 */
const PERMANENT_AUDIT_ACTION_PREFIXES = ["access.", "auth.", "user.", "company."] as const;

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

  /**
   * Prunes operational audit history past the retention window. Access and
   * authentication history is never pruned: "who could do what, and when did
   * that change" has to stay answerable for as long as the company exists.
   */
  app.post("/cron/audit-retention", async (request, reply) => {
    if (!authorizeCron(request)) {
      return reply.code(env.cronSecret ? 401 : 503).send({
        error: env.cronSecret ? "Unauthorized" : "Cron not configured",
        message: env.cronSecret
          ? "Invalid or missing Authorization bearer token"
          : "Set CRON_SECRET on the API service to enable audit retention",
      });
    }

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - env.auditRetentionMonths);

    const deleted = await prisma.auditLog.deleteMany({
      where: {
        timestamp: { lt: cutoff },
        NOT: PERMANENT_AUDIT_ACTION_PREFIXES.map((prefix) => ({ action: { startsWith: prefix } })),
      },
    });

    request.log.info(
      { deleted: deleted.count, cutoff, retentionMonths: env.auditRetentionMonths },
      "audit retention sweep"
    );

    return reply.send({
      ok: true,
      deleted: deleted.count,
      cutoff,
      retentionMonths: env.auditRetentionMonths,
      retainedIndefinitely: PERMANENT_AUDIT_ACTION_PREFIXES,
    });
  });

  app.post("/cron/compliance-sync", async (request, reply) => {
    if (!authorizeCron(request)) {
      return reply.code(env.cronSecret ? 401 : 503).send({
        error: env.cronSecret ? "Unauthorized" : "Cron not configured",
        message: env.cronSecret
          ? "Invalid or missing Authorization bearer token"
          : "Set CRON_SECRET on the API service to enable compliance sync",
      });
    }

    const { syncComplianceAlerts } = await import("../modules/compliance/compliance-alerts.service.js");
    const companies = await prisma.company.findMany({ select: { id: true } });
    const results: Array<{ companyId: string; createdCount: number; scannedCount: number }> = [];

    for (const company of companies) {
      try {
        const res = await syncComplianceAlerts(company.id);
        results.push({ companyId: company.id, ...res });
      } catch (err) {
        request.log.error({ err, companyId: company.id }, "compliance-sync failed for company");
      }
    }

    return reply.send({
      ok: true,
      companiesProcessed: companies.length,
      results,
    });
  });
}
