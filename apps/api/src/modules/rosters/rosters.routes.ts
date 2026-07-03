import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import {
  activatePatternSchema,
  addPlaceholderGuardSchema,
  approveSiteTimesheetSchema,
  bulkManualOverridesSchema,
  createPatternSchema,
  generateRosterSchema,
  liveRosterQuerySchema,
  manualOverrideSchema,
  patternGridQuerySchema,
  publishRosterSchema,
  siteTimesheetQuerySchema,
  siteTimesheetRowCreateSchema,
  siteTimesheetRowUpdateSchema,
  unlockSiteTimesheetSchema,
  updatePatternSchema,
} from "./rosters.schemas.js";
import {
  activatePattern,
  addPlaceholderGuardToSite,
  applyManualOverride,
  applyManualOverridesBulk,
  createPattern,
  generateRosterFromPattern,
  getLiveRoster,
  getPatternGrid,
  getSiteRosterConfig,
  publishRoster,
  updatePattern,
} from "./rosters.service.js";
import {
  addSiteTimesheetRow,
  approveSiteTimesheet,
  buildSiteTimesheetCsv,
  getSiteTimesheet,
  resyncSiteTimesheet,
  unlockSiteTimesheet,
  updateSiteTimesheetRow,
} from "./site-timesheets.service.js";

const protect = [
  authMiddleware,
  requireRole(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"], {
    module: "/rostering",
  }),
];

export async function rostersRoutes(app: FastifyInstance) {
  app.get("/sites/:siteId/config", { preHandler: protect }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const config = await getSiteRosterConfig(request.user!.companyId, siteId);
    if (!config) return reply.code(404).send({ error: "Site not found" });
    return reply.send(config);
  });

  app.post("/sites/:siteId/placeholder-guards", { preHandler: protect }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const parsed = addPlaceholderGuardSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await addPlaceholderGuardToSite(
      request.user!.companyId,
      siteId,
      parsed.data.type
    );
    if (!result) return reply.code(404).send({ error: "Site not found" });
    if ("error" in result) return reply.code(400).send({ error: result.error });
    return reply.code(201).send(result);
  });

  app.get("/pattern-grid", { preHandler: protect }, async (request, reply) => {
    const parsed = patternGridQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const grid = await getPatternGrid(
      request.user!.companyId,
      parsed.data.siteId,
      parsed.data.patternId,
      {
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        cycleLengthDays: parsed.data.cycleLengthDays,
        anchorDate: parsed.data.anchorDate,
      }
    );
    if (!grid) return reply.code(404).send({ error: "Site not found" });
    return reply.send(grid);
  });

  app.get("/live-roster", { preHandler: protect }, async (request, reply) => {
    const parsed = liveRosterQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const grid = await getLiveRoster(
      request.user!.companyId,
      parsed.data.siteId,
      parsed.data.startDate,
      parsed.data.endDate,
      parsed.data.fillFromPattern ?? false
    );
    if (!grid) return reply.code(404).send({ error: "Site not found" });
    return reply.send(grid);
  });

  app.get("/site-timesheets", { preHandler: protect }, async (request, reply) => {
    const parsed = siteTimesheetQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const sheet = await getSiteTimesheet(
      request.user!.companyId,
      parsed.data.siteId,
      parsed.data.startDate,
      parsed.data.endDate
    );
    if (!sheet) return reply.code(404).send({ error: "Site not found" });
    return reply.send(sheet);
  });

  app.get("/site-timesheets/export.csv", { preHandler: protect }, async (request, reply) => {
    const parsed = siteTimesheetQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const sheet = await getSiteTimesheet(
      request.user!.companyId,
      parsed.data.siteId,
      parsed.data.startDate,
      parsed.data.endDate
    );
    if (!sheet) return reply.code(404).send({ error: "Site not found" });
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="site-timesheet-${sheet.siteName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${sheet.periodStart}.csv"`
    );
    return reply.send(buildSiteTimesheetCsv(sheet));
  });

  app.post("/site-timesheets/resync", { preHandler: protect }, async (request, reply) => {
    const parsed = siteTimesheetQuerySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await resyncSiteTimesheet(
      request.user!.companyId,
      parsed.data.siteId,
      parsed.data.startDate,
      parsed.data.endDate
    );
    if (!result) return reply.code(404).send({ error: "Site not found" });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    return reply.send(result.timesheet);
  });

  app.put("/site-timesheets/rows/:rowId", { preHandler: protect }, async (request, reply) => {
    const { rowId } = request.params as { rowId: string };
    const parsed = siteTimesheetRowUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await updateSiteTimesheetRow(request.user!.companyId, rowId, parsed.data);
    if (!result) return reply.code(404).send({ error: "Timesheet row not found" });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    return reply.send(result);
  });

  app.post("/site-timesheets/:timesheetId/rows", { preHandler: protect }, async (request, reply) => {
    const { timesheetId } = request.params as { timesheetId: string };
    const parsed = siteTimesheetRowCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await addSiteTimesheetRow(request.user!.companyId, timesheetId, parsed.data);
    if (!result) return reply.code(404).send({ error: "Timesheet not found" });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    return reply.code(201).send(result);
  });

  app.post("/site-timesheets/:timesheetId/approve", { preHandler: protect }, async (request, reply) => {
    const { timesheetId } = request.params as { timesheetId: string };
    const parsed = approveSiteTimesheetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await approveSiteTimesheet(
      request.user!.companyId,
      timesheetId,
      request.user!.sub,
      parsed.data.notes
    );
    if (!result) return reply.code(404).send({ error: "Timesheet not found" });
    return reply.send(result);
  });

  app.post("/site-timesheets/:timesheetId/unlock", { preHandler: protect }, async (request, reply) => {
    const { timesheetId } = request.params as { timesheetId: string };
    const parsed = unlockSiteTimesheetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    if (request.user!.role !== "admin") {
      return reply.code(403).send({ error: "Only an admin can unlock an approved timesheet" });
    }
    const result = await unlockSiteTimesheet(
      request.user!.companyId,
      timesheetId,
      request.user!.sub,
      parsed.data.reason
    );
    if (!result) return reply.code(404).send({ error: "Timesheet not found" });
    return reply.send(result);
  });

  app.post("/patterns", { preHandler: protect }, async (request, reply) => {
    const parsed = createPatternSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const created = await createPattern(request.user!.companyId, request.user!.sub, parsed.data);
    if (!created) return reply.code(404).send({ error: "Site not found" });
    return reply.code(201).send(created);
  });

  app.put("/patterns/:patternId", { preHandler: protect }, async (request, reply) => {
    const { patternId } = request.params as { patternId: string };
    const parsed = updatePatternSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const updated = await updatePattern(request.user!.companyId, patternId, parsed.data);
    if (!updated) return reply.code(404).send({ error: "Pattern not found" });
    return reply.send(updated);
  });

  app.post("/patterns/:patternId/activate", { preHandler: protect }, async (request, reply) => {
    const { patternId } = request.params as { patternId: string };
    const parsed = activatePatternSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const activated = await activatePattern(
      request.user!.companyId,
      patternId,
      parsed.data.effectiveFrom
    );
    if (!activated) return reply.code(404).send({ error: "Pattern not found" });
    return reply.send(activated);
  });

  app.post("/generate", { preHandler: protect }, async (request, reply) => {
    const parsed = generateRosterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await generateRosterFromPattern(
      request.user!.companyId,
      parsed.data.siteId,
      parsed.data.startDate,
      parsed.data.endDate,
      parsed.data.persist ?? true
    );
    if (!result) return reply.code(404).send({ error: "Site not found" });
    return reply.send(result);
  });

  app.post("/overrides", { preHandler: protect }, async (request, reply) => {
    const parsed = manualOverrideSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await applyManualOverride(request.user!.companyId, request.user!.sub, parsed.data);
    if (!result) return reply.code(404).send({ error: "Site not found" });
    return reply.send(result);
  });

  app.post("/overrides/bulk", { preHandler: protect }, async (request, reply) => {
    const parsed = bulkManualOverridesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await applyManualOverridesBulk(request.user!.companyId, request.user!.sub, parsed.data);
    if (!result) return reply.code(404).send({ error: "Site not found" });
    return reply.send(result);
  });

  app.post("/publish", { preHandler: protect }, async (request, reply) => {
    const parsed = publishRosterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await publishRoster(request.user!.companyId, parsed.data);
    if (!result) return reply.code(404).send({ error: "Site not found" });
    return reply.send(result);
  });
}
