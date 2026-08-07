import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { requireAnyCapability, requireCapability, requireCrudCapability } from "../../middleware/authorization.js";
import { hasCapability } from "../../lib/capabilities.js";
import {
  activatePatternSchema,
  addPlaceholderGuardSchema,
  activateContinuitySchema,
  approveSiteTimesheetRowSchema,
  approveSiteTimesheetSchema,
  bulkConfirmSiteTimesheetRowsSchema,
  bulkManualOverridesSchema,
  createPatternSchema,
  generateRosterSchema,
  liveRosterQuerySchema,
  manualOverrideSchema,
  patternGridQuerySchema,
  publishRosterSchema,
  siteTimesheetCaptureOverviewQuerySchema,
  siteTimesheetQuerySchema,
  siteTimesheetRowCreateSchema,
  siteTimesheetRowUpdateSchema,
  unlockSiteTimesheetSchema,
  updatePatternSchema,
  continuityPauseSchema,
  confirmReplacementSchema,
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
  RosterGuardValidationError,
  updatePattern,
} from "./rosters.service.js";
import {
  activateRosterContinuity,
  confirmReplacement,
  getContinuityOverview,
  getContinuitySetupSuggestion,
  getContinuityStatus,
  getReplacementSuggestions,
  reconcileRosterContinuityForSite,
  setContinuityPaused,
} from "./roster-continuity.service.js";
import {
  addSiteTimesheetRow,
  approveSiteTimesheet,
  buildSiteTimesheetCsv,
  bulkConfirmSiteTimesheetRows,
  confirmSiteTimesheetRow,
  getSiteTimesheet,
  getSiteTimesheetCaptureOverview,
  reopenSiteTimesheetRow,
  resyncSiteTimesheet,
  unlockSiteTimesheet,
  updateSiteTimesheetRow,
} from "./site-timesheets.service.js";
import { SITE_TIMESHEET_MODULES } from "./site-timesheet-access.js";

const protect = [
  authMiddleware,
  requireCrudCapability({
    anyOfModules: [...SITE_TIMESHEET_MODULES],
  }),
];

const rosterReadProtect = [
  authMiddleware,
  requireCrudCapability({ module: "/rostering" }),
];

const rosterManagerProtect = [
  authMiddleware,
  requireCapability("/rostering", "edit"),
];

const rosterCreateProtect = [
  authMiddleware,
  requireCapability("/rostering", "create"),
];

const rosterExceptionProtect = [
  authMiddleware,
  requireCapability("/rostering", "approve"),
];

const timesheetApproveProtect = [
  authMiddleware,
  requireAnyCapability(["/attendance", "/rostering"], "approve"),
];

const timesheetExportProtect = [
  authMiddleware,
  requireAnyCapability(["/attendance", "/rostering"], "export"),
];

const timesheetEditProtect = [
  authMiddleware,
  requireAnyCapability(["/attendance", "/rostering"], "edit"),
];

const rosterApproveProtect = [
  authMiddleware,
  requireCapability("/rostering", "approve"),
];

export async function rostersRoutes(app: FastifyInstance) {
  app.get("/continuity-overview", { preHandler: rosterReadProtect }, async (request, reply) => {
    return reply.send(
      await getContinuityOverview(request.user!.companyId, request.user!)
    );
  });

  app.get("/sites/:siteId/setup-suggestion", { preHandler: rosterReadProtect }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const suggestion = await getContinuitySetupSuggestion(request.user!.companyId, siteId);
    if (!suggestion) return reply.code(404).send({ error: "Site not found" });
    return reply.send(suggestion);
  });

  app.post("/sites/:siteId/activate-continuity", { preHandler: rosterManagerProtect }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const parsed = activateContinuitySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    try {
      const result = await activateRosterContinuity(
        request.user!.companyId,
        request.user!.sub,
        siteId,
        parsed.data
      );
      if (!result) return reply.code(404).send({ error: "Site not found" });
      if ("error" in result) return reply.code(409).send(result);
      return reply.send(result);
    } catch (error) {
      if (error instanceof Error && error.message === "ROSTER_CALENDAR_NOT_FOUND") {
        return reply.code(400).send({ error: "Selected roster calendar was not found" });
      }
      if (error instanceof Error && error.message === "PATTERN_GUARD_NOT_ASSIGNED") {
        return reply.code(400).send({ error: "Every pattern guard must be assigned to this site" });
      }
      if (error instanceof Error && error.message === "DUPLICATE_PATTERN_CELL") {
        return reply.code(400).send({ error: "The pattern contains duplicate guard days" });
      }
      throw error;
    }
  });

  app.get("/sites/:siteId/continuity-status", { preHandler: rosterReadProtect }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const status = await getContinuityStatus(request.user!.companyId, siteId, request.user!);
    if (!status) return reply.code(404).send({ error: "Site not found" });
    return reply.send(status);
  });

  app.post("/sites/:siteId/reconcile", { preHandler: rosterManagerProtect }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    try {
      const result = await reconcileRosterContinuityForSite(request.user!.companyId, siteId, {
        userId: request.user!.sub,
        trigger: "manual",
      });
      return reply.send(result);
    } catch (error) {
      if (error instanceof Error && error.message === "SITE_NOT_FOUND") {
        return reply.code(404).send({ error: "Site not found" });
      }
      throw error;
    }
  });

  app.post("/sites/:siteId/continuity-pause", { preHandler: rosterManagerProtect }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const parsed = continuityPauseSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const site = await setContinuityPaused(
      request.user!.companyId,
      siteId,
      parsed.data.paused,
      parsed.data.reason
    );
    if (!site) return reply.code(404).send({ error: "Site not found" });
    if (!parsed.data.paused) {
      await reconcileRosterContinuityForSite(request.user!.companyId, siteId, {
        userId: request.user!.sub,
        trigger: "resumed",
      });
    }
    return reply.send({ ok: true, state: parsed.data.paused ? "paused" : "running" });
  });

  app.get("/continuity/issues/:alertId/replacements", { preHandler: rosterExceptionProtect }, async (request, reply) => {
    const { alertId } = request.params as { alertId: string };
    const result = await getReplacementSuggestions(request.user!.companyId, alertId);
    if (!result) return reply.code(404).send({ error: "Roster issue not found" });
    return reply.send(result);
  });

  app.post("/continuity/issues/:alertId/replacements", { preHandler: rosterExceptionProtect }, async (request, reply) => {
    const { alertId } = request.params as { alertId: string };
    const parsed = confirmReplacementSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await confirmReplacement(
      request.user!.companyId,
      request.user!.sub,
      alertId,
      parsed.data.employeeId
    );
    if (!result) return reply.code(409).send({ error: "Replacement is no longer available" });
    return reply.send(result);
  });

  app.get("/sites/:siteId/config", { preHandler: rosterReadProtect }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const config = await getSiteRosterConfig(request.user!.companyId, siteId);
    if (!config) return reply.code(404).send({ error: "Site not found" });
    return reply.send(config);
  });

  app.post("/sites/:siteId/placeholder-guards", { preHandler: rosterCreateProtect }, async (request, reply) => {
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

  app.get("/pattern-grid", { preHandler: rosterReadProtect }, async (request, reply) => {
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

  app.get("/live-roster", { preHandler: rosterReadProtect }, async (request, reply) => {
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

  app.get("/site-timesheets/capture-overview", { preHandler: protect }, async (request, reply) => {
    const parsed = siteTimesheetCaptureOverviewQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const overview = await getSiteTimesheetCaptureOverview(
      request.user!.companyId,
      parsed.data.startDate,
      parsed.data.endDate,
      parsed.data.shiftType
    );
    return reply.send(overview);
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

  app.get("/site-timesheets/export.csv", { preHandler: timesheetExportProtect }, async (request, reply) => {
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
    const shiftSuffix =
      parsed.data.shiftType && parsed.data.shiftType !== "all" ? `-${parsed.data.shiftType}` : "";
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="site-timesheet-${sheet.siteName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${sheet.periodStart}${shiftSuffix}.csv"`
    );
    return reply.send(buildSiteTimesheetCsv(sheet, parsed.data.shiftType));
  });

  app.post("/site-timesheets/resync", { preHandler: timesheetEditProtect }, async (request, reply) => {
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

  app.put("/site-timesheets/rows/:rowId", { preHandler: timesheetEditProtect }, async (request, reply) => {
    const { rowId } = request.params as { rowId: string };
    const parsed = siteTimesheetRowUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await updateSiteTimesheetRow(
      request.user!.companyId,
      rowId,
      parsed.data,
      {
        canOverrideObNumbers: hasCapability(request.user!, "/attendance", "approve"),
        userId: request.user!.sub,
      }
    );
    if (!result) return reply.code(404).send({ error: "Timesheet row not found" });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    return reply.send(result);
  });

  app.post("/site-timesheets/rows/:rowId/confirm", { preHandler: timesheetEditProtect }, async (request, reply) => {
    const { rowId } = request.params as { rowId: string };
    const parsed = approveSiteTimesheetRowSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await confirmSiteTimesheetRow(
      request.user!.companyId,
      rowId,
      parsed.data,
      {
        canOverrideObNumbers: hasCapability(request.user!, "/attendance", "approve"),
        userId: request.user!.sub,
      }
    );
    if (!result) return reply.code(404).send({ error: "Timesheet row not found" });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    return reply.send(result);
  });

  app.post(
    "/site-timesheets/:timesheetId/rows/bulk-confirm",
    { preHandler: timesheetEditProtect },
    async (request, reply) => {
      const { timesheetId } = request.params as { timesheetId: string };
      const parsed = bulkConfirmSiteTimesheetRowsSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
      }
      const result = await bulkConfirmSiteTimesheetRows(
        request.user!.companyId,
        timesheetId,
        parsed.data.rows,
        {
          canOverrideObNumbers: hasCapability(request.user!, "/attendance", "approve"),
          userId: request.user!.sub,
        }
      );
      if (!result) return reply.code(404).send({ error: "Timesheet not found" });
      // A locked sheet blocks the whole request; individual row problems come back as
      // `failed` entries alongside whatever succeeded.
      if ("error" in result) return reply.code(409).send({ error: result.error });
      return reply.send(result);
    }
  );

  app.post("/site-timesheets/rows/:rowId/reopen", { preHandler: timesheetEditProtect }, async (request, reply) => {
    const { rowId } = request.params as { rowId: string };
    const result = await reopenSiteTimesheetRow(
      request.user!.companyId,
      rowId,
      request.user!.sub
    );
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

  app.post("/site-timesheets/:timesheetId/approve", { preHandler: timesheetApproveProtect }, async (request, reply) => {
    const { timesheetId } = request.params as { timesheetId: string };
    const parsed = approveSiteTimesheetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await approveSiteTimesheet(
      request.user!.companyId,
      timesheetId,
      request.user!.sub,
      { notes: parsed.data.notes, shiftType: parsed.data.shiftType }
    );
    if (!result) return reply.code(404).send({ error: "Timesheet not found" });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    return reply.send(result);
  });

  app.post("/site-timesheets/:timesheetId/unlock", { preHandler: timesheetApproveProtect }, async (request, reply) => {
    const { timesheetId } = request.params as { timesheetId: string };
    const parsed = unlockSiteTimesheetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    if (!hasCapability(request.user!, "/attendance", "approve")) {
      return reply.code(403).send({ error: "Attendance approval access is required to unlock a timesheet" });
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

  app.post("/patterns", { preHandler: rosterCreateProtect }, async (request, reply) => {
    const parsed = createPatternSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    try {
      const created = await createPattern(request.user!.companyId, request.user!.sub, parsed.data);
      if (!created) return reply.code(404).send({ error: "Site not found" });
      return reply.code(201).send(created);
    } catch (error) {
      if (error instanceof RosterGuardValidationError) {
        return reply.code(400).send({ error: "Every roster guard must belong to this company" });
      }
      throw error;
    }
  });

  app.put("/patterns/:patternId", { preHandler: rosterManagerProtect }, async (request, reply) => {
    const { patternId } = request.params as { patternId: string };
    const parsed = updatePatternSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    try {
      const updated = await updatePattern(request.user!.companyId, patternId, parsed.data);
      if (!updated) return reply.code(404).send({ error: "Pattern not found" });
      return reply.send(updated);
    } catch (error) {
      if (error instanceof RosterGuardValidationError) {
        return reply.code(400).send({ error: "Every roster guard must belong to this company" });
      }
      throw error;
    }
  });

  app.post("/patterns/:patternId/activate", { preHandler: rosterApproveProtect }, async (request, reply) => {
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

  app.post("/generate", { preHandler: rosterCreateProtect }, async (request, reply) => {
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

  app.post("/overrides", { preHandler: rosterExceptionProtect }, async (request, reply) => {
    const parsed = manualOverrideSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    if (
      parsed.data.doesChangeBasePattern &&
      !hasCapability(request.user!, "/rostering", "edit")
    ) {
      return reply.code(403).send({ error: "Rostering edit access is required to change the ongoing schedule" });
    }
    try {
      const result = await applyManualOverride(request.user!.companyId, request.user!.sub, parsed.data);
      if (!result) return reply.code(404).send({ error: "Site not found" });
      return reply.send(result);
    } catch (error) {
      if (error instanceof RosterGuardValidationError) {
        return reply.code(400).send({ error: "Roster guard not found" });
      }
      throw error;
    }
  });

  app.post("/overrides/bulk", { preHandler: rosterManagerProtect }, async (request, reply) => {
    const parsed = bulkManualOverridesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    try {
      const result = await applyManualOverridesBulk(request.user!.companyId, request.user!.sub, parsed.data);
      if (!result) return reply.code(404).send({ error: "Site not found" });
      return reply.send(result);
    } catch (error) {
      if (error instanceof RosterGuardValidationError) {
        return reply.code(400).send({ error: "Every roster guard must belong to this company" });
      }
      throw error;
    }
  });

  app.post("/publish", { preHandler: rosterApproveProtect }, async (request, reply) => {
    const parsed = publishRosterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await publishRoster(request.user!.companyId, parsed.data);
    if (!result) return reply.code(404).send({ error: "Site not found" });
    return reply.send(result);
  });
}
