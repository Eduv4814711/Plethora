import type { FastifyInstance } from "fastify";
import { authProtect } from "../../middleware/auth-protect.js";
import { requireRole } from "../../middleware/rbac.js";
import { requirePermission } from "../../middleware/permissions.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { prisma } from "../../lib/prisma.js";
import { createApprovalRequest } from "../approvals/approvals.service.js";
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
  siteTimesheetCaptureOverviewQuerySchema,
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
  getSiteTimesheetCaptureOverview,
  resyncSiteTimesheet,
  unlockSiteTimesheet,
  updateSiteTimesheetRow,
} from "./site-timesheets.service.js";

const ROSTER_ROLES = ["admin", "operations_manager", "hr_payroll", "supervisor", "controller"] as const;

/** Pattern planning, live roster, and roster generation */
const rosterProtect = [
  ...authProtect,
  requireRole([...ROSTER_ROLES], { module: "/rostering" }),
  requirePermission(PERMISSIONS.ROSTERS_READ),
];

/** Site timesheets are used from both Rostering and Attendance screens */
const siteTimesheetProtect = [
  ...authProtect,
  requireRole([...ROSTER_ROLES], { anyOfModules: ["/rostering", "/attendance"] }),
  requirePermission(PERMISSIONS.TIMESHEETS_READ),
];

const rosterManageProtect = [...rosterProtect, requirePermission(PERMISSIONS.ROSTERS_MANAGE)];
const rosterPublishProtect = [...rosterProtect, requirePermission(PERMISSIONS.ROSTERS_PUBLISH)];
const siteTimesheetManageProtect = [...siteTimesheetProtect, requirePermission(PERMISSIONS.TIMESHEETS_MANAGE)];
const siteTimesheetApproveProtect = [...siteTimesheetProtect, requirePermission(PERMISSIONS.TIMESHEETS_APPROVE)];

export async function rostersRoutes(app: FastifyInstance) {
  app.get("/sites/:siteId/config", { preHandler: rosterProtect }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const config = await getSiteRosterConfig(request.user!.companyId, siteId);
    if (!config) return reply.code(404).send({ error: "Site not found" });
    return reply.send(config);
  });

  app.post("/sites/:siteId/placeholder-guards", { preHandler: rosterManageProtect }, async (request, reply) => {
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

  app.get("/pattern-grid", { preHandler: rosterProtect }, async (request, reply) => {
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

  app.get("/live-roster", { preHandler: rosterProtect }, async (request, reply) => {
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

  app.get("/site-timesheets/capture-overview", { preHandler: siteTimesheetProtect }, async (request, reply) => {
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

  app.get("/site-timesheets", { preHandler: siteTimesheetProtect }, async (request, reply) => {
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

  app.get("/site-timesheets/export.csv", { preHandler: siteTimesheetProtect }, async (request, reply) => {
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

  app.post("/site-timesheets/resync", { preHandler: siteTimesheetManageProtect }, async (request, reply) => {
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

  app.put("/site-timesheets/rows/:rowId", { preHandler: siteTimesheetManageProtect }, async (request, reply) => {
    const { rowId } = request.params as { rowId: string };
    const parsed = siteTimesheetRowUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await updateSiteTimesheetRow(
      request.user!.companyId,
      rowId,
      parsed.data,
      { role: request.user!.role, userId: request.user!.sub }
    );
    if (!result) return reply.code(404).send({ error: "Timesheet row not found" });
    if ("error" in result) return reply.code(409).send({ error: result.error });
    return reply.send(result);
  });

  app.post("/site-timesheets/:timesheetId/rows", { preHandler: siteTimesheetManageProtect }, async (request, reply) => {
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

  app.post("/site-timesheets/:timesheetId/approve", { preHandler: siteTimesheetApproveProtect }, async (request, reply) => {
    const { timesheetId } = request.params as { timesheetId: string };
    const parsed = approveSiteTimesheetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const timesheet = await prisma.siteTimesheet.findFirst({ where: { id: timesheetId, companyId: request.user!.companyId } });
    if (!timesheet) return reply.code(404).send({ error: "Timesheet not found" });
    const approval = await createApprovalRequest({
      companyId: request.user!.companyId,
      approvalType: "SITE_TIMESHEET",
      entityType: "SiteTimesheet",
      entityId: timesheetId,
      requestedById: request.user!.sub,
      reason: parsed.data.reason,
      comment: parsed.data.notes,
      riskLevel: "HIGH",
      payload: { notes: parsed.data.notes, shiftType: parsed.data.shiftType },
    });
    return reply.code(202).send({ approval, message: "Timesheet approval submitted for independent review" });
  });

  app.post("/site-timesheets/:timesheetId/unlock", { preHandler: siteTimesheetApproveProtect }, async (request, reply) => {
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

  app.post("/patterns", { preHandler: rosterManageProtect }, async (request, reply) => {
    const parsed = createPatternSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const created = await createPattern(request.user!.companyId, request.user!.sub, parsed.data);
    if (!created) return reply.code(404).send({ error: "Site not found" });
    return reply.code(201).send(created);
  });

  app.put("/patterns/:patternId", { preHandler: rosterManageProtect }, async (request, reply) => {
    const { patternId } = request.params as { patternId: string };
    const parsed = updatePatternSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const updated = await updatePattern(request.user!.companyId, patternId, parsed.data);
    if (!updated) return reply.code(404).send({ error: "Pattern not found" });
    return reply.send(updated);
  });

  app.post("/patterns/:patternId/activate", { preHandler: rosterManageProtect }, async (request, reply) => {
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

  app.post("/generate", { preHandler: rosterManageProtect }, async (request, reply) => {
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

  app.post("/overrides", { preHandler: rosterManageProtect }, async (request, reply) => {
    const parsed = manualOverrideSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await applyManualOverride(request.user!.companyId, request.user!.sub, parsed.data);
    if (!result) return reply.code(404).send({ error: "Site not found" });
    return reply.send(result);
  });

  app.post("/overrides/bulk", { preHandler: rosterManageProtect }, async (request, reply) => {
    const parsed = bulkManualOverridesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const result = await applyManualOverridesBulk(request.user!.companyId, request.user!.sub, parsed.data);
    if (!result) return reply.code(404).send({ error: "Site not found" });
    return reply.send(result);
  });

  app.post("/publish", { preHandler: rosterPublishProtect }, async (request, reply) => {
    const parsed = publishRosterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten() });
    }
    const companyId = request.user!.companyId;
    const site = await prisma.site.findFirst({ where: { id: parsed.data.siteId, companyId }, select: { id: true } });
    if (!site) return reply.code(404).send({ error: "Site not found" });
    const periodStart = new Date(parsed.data.startDate);
    const periodEnd = new Date(parsed.data.endDate);
    const latest = await prisma.rosterPublication.findFirst({ where: { companyId, siteId: site.id, periodStart, periodEnd }, orderBy: { version: "desc" }, select: { version: true } });
    const publication = await prisma.rosterPublication.create({
      data: {
        companyId,
        siteId: site.id,
        periodStart,
        periodEnd,
        version: (latest?.version ?? 0) + 1,
        snapshot: parsed.data,
        requestedById: request.user!.sub,
        reason: parsed.data.reason,
      },
    });
    const approval = await createApprovalRequest({
      companyId,
      approvalType: "ROSTER_PUBLICATION",
      entityType: "RosterPublication",
      entityId: publication.id,
      requestedById: request.user!.sub,
      reason: parsed.data.reason,
      riskLevel: "HIGH",
      payload: { publicationId: publication.id, publishInput: parsed.data },
    });
    await prisma.rosterPublication.update({ where: { id: publication.id }, data: { approvalRequestId: approval.id } });
    return reply.code(202).send({ publication, approval, message: "Roster publication submitted for independent approval" });
  });
}
