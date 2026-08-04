import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { createAuditLog } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { safeFilenamePart } from "../../services/company-branding.js";
import {
  generateSiteMonthReportPDF,
  generateSiteTimesheetPDF,
} from "../../services/client-report-pdf.service.js";
import { getSiteTimesheet } from "../rosters/site-timesheets.service.js";
import {
  buildMonthEndPackPdf,
  buildMonthEndTimesheetsCsv,
  loadPackContext,
  siteReportTemplateData,
  siteTimesheetTemplateData,
} from "./month-end-pack.service.js";
import {
  getClientMonthEndSummary,
  getSiteMonthReport,
  resolvePeriod,
  type MonthPeriod,
} from "./site-report.service.js";

const periodQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  siteIds: z.string().optional(),
  includeUnapproved: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

type ParsedPeriodQuery = { period: MonthPeriod; siteIds?: string[]; includeUnapproved: boolean };

function parsePeriodQuery(
  query: unknown,
  reply: FastifyReply
): ParsedPeriodQuery | null {
  const parsed = periodQuerySchema.safeParse(query);
  if (!parsed.success) {
    reply.code(400).send({
      error: "Validation error",
      message: parsed.error.issues[0]?.message ?? "Invalid query",
    });
    return null;
  }
  let period: MonthPeriod;
  try {
    period = resolvePeriod(parsed.data);
  } catch (error) {
    reply.code(400).send({
      error: "Validation error",
      message: error instanceof Error ? error.message : "Invalid period",
    });
    return null;
  }
  const siteIds = parsed.data.siteIds
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return { period, siteIds, includeUnapproved: parsed.data.includeUnapproved };
}

function generatedAtLabel(): string {
  return `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function periodFilenamePart(period: MonthPeriod): string {
  return period.month ?? `${period.periodStart} to ${period.periodEnd}`;
}

/**
 * Month-end reporting for a client's sites. Registered inside `clientsRoutes`, so every
 * path here sits under the `/clients` prefix.
 */
export async function registerClientReportRoutes(
  app: FastifyInstance,
  viewProtect: preHandlerHookHandler[],
  exportProtect: preHandlerHookHandler[]
) {
  app.get("/:id/month-end/summary", { preHandler: viewProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = parsePeriodQuery(request.query, reply);
    if (!parsed) return reply;

    const summary = await getClientMonthEndSummary(
      user.companyId,
      id,
      parsed.period,
      parsed.siteIds
    );
    if (!summary) {
      return reply.code(404).send({ error: "Not found", message: "Client not found" });
    }
    return reply.send(summary);
  });

  app.get("/:id/sites/:siteId/report.pdf", { preHandler: exportProtect }, async (request, reply) => {
    const user = request.user!;
    const { id, siteId } = request.params as { id: string; siteId: string };
    const parsed = parsePeriodQuery(request.query, reply);
    if (!parsed) return reply;

    const context = await loadPackContext(user.companyId, id);
    if (!context) {
      return reply.code(404).send({ error: "Not found", message: "Client not found" });
    }
    // getSiteMonthReport scopes the site by companyId AND clientId, so one client's
    // URL cannot render another client's site.
    const report = await getSiteMonthReport(user.companyId, id, siteId, parsed.period);
    if (!report) {
      return reply
        .code(404)
        .send({ error: "Not found", message: "Site is not linked to this client" });
    }

    const pdf = await generateSiteMonthReportPDF(
      siteReportTemplateData(report, context.issuer, context.party, generatedAtLabel())
    );
    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "client.report.export",
      entityType: "Client",
      entityId: id,
      metadata: { kind: "site_report", siteId, period: parsed.period },
    });
    const filename = `Site report ${safeFilenamePart(report.site.name, "site")} ${periodFilenamePart(parsed.period)}.pdf`;
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(pdf);
  });

  app.get(
    "/:id/sites/:siteId/timesheet.pdf",
    { preHandler: exportProtect },
    async (request, reply) => {
      const user = request.user!;
      const { id, siteId } = request.params as { id: string; siteId: string };
      const parsed = parsePeriodQuery(request.query, reply);
      if (!parsed) return reply;

      const context = await loadPackContext(user.companyId, id);
      if (!context) {
        return reply.code(404).send({ error: "Not found", message: "Client not found" });
      }
      const site = await prisma.site.findFirst({
        where: { id: siteId, companyId: user.companyId, clientId: id },
        select: { id: true },
      });
      if (!site) {
        return reply
          .code(404)
          .send({ error: "Not found", message: "Site is not linked to this client" });
      }
      const sheet = await getSiteTimesheet(
        user.companyId,
        siteId,
        parsed.period.periodStart,
        parsed.period.periodEnd
      );
      if (!sheet) {
        return reply.code(404).send({ error: "Not found", message: "Timesheet not found" });
      }

      const pdf = await generateSiteTimesheetPDF(
        siteTimesheetTemplateData(
          sheet,
          parsed.period,
          context.issuer,
          context.party,
          generatedAtLabel()
        )
      );
      await createAuditLog({
        userId: user.sub,
        companyId: user.companyId,
        action: "client.report.export",
        entityType: "Client",
        entityId: id,
        metadata: { kind: "timesheet", siteId, period: parsed.period },
      });
      const filename = `Timesheet ${safeFilenamePart(sheet.siteName, "site")} ${periodFilenamePart(parsed.period)}.pdf`;
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(pdf);
    }
  );

  app.get("/:id/month-end/pack.pdf", { preHandler: exportProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = parsePeriodQuery(request.query, reply);
    if (!parsed) return reply;

    const result = await buildMonthEndPackPdf(user.companyId, id, parsed.period, {
      siteIds: parsed.siteIds,
      includeUnapproved: parsed.includeUnapproved,
    });
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        error: result.statusCode === 404 ? "Not found" : "Validation error",
        message: result.message,
      });
    }
    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "client.report.export",
      entityType: "Client",
      entityId: id,
      metadata: {
        kind: "pack",
        siteIds: parsed.siteIds ?? null,
        includeUnapproved: parsed.includeUnapproved,
        period: parsed.period,
      },
    });
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${result.filename}"`)
      .send(result.buffer);
  });

  app.get("/:id/month-end/timesheets.csv", { preHandler: exportProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = parsePeriodQuery(request.query, reply);
    if (!parsed) return reply;

    const result = await buildMonthEndTimesheetsCsv(
      user.companyId,
      id,
      parsed.period,
      parsed.siteIds
    );
    if (!result.ok) {
      return reply.code(result.statusCode).send({
        error: result.statusCode === 404 ? "Not found" : "Validation error",
        message: result.message,
      });
    }
    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "client.report.export",
      entityType: "Client",
      entityId: id,
      metadata: { kind: "csv", siteIds: parsed.siteIds ?? null, period: parsed.period },
    });
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${result.filename}"`)
      .send(result.csv);
  });
}
