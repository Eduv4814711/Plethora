import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import { runAutoRosterForSite } from "../services/auto-roster.service.js";
import { mapSiteForApi, siteDetailInclude } from "../lib/site-post-api.js";
import { syncContractExpiryAlerts } from "../modules/documents/documents.service.js";
import { reconcileRosterContinuityForSite } from "../modules/rosters/roster-continuity.service.js";
import { ALL_WEEK_DAYS, normalizeCoverageDays } from "../lib/site-coverage-days.js";

const SERVICE_TYPES = [
  "guarding",
  "access_control",
  "patrols",
  "close_protection",
  "reaction",
  "control_room",
  "monitoring",
  "other",
] as const;

/** Statuses a guard must have to be assignable to a site / rosterable. Mirrors the roster engine. */
const ROSTERABLE_STATUSES = ["active", "training", "hired", "reliever"] as const;

function refineSiteGeofenceThreeOrNone(data: {
  latitude?: number | null;
  longitude?: number | null;
  geofenceRadiusMeters?: number | null;
}) {
  const lat = data.latitude;
  const lng = data.longitude;
  const r = data.geofenceRadiusMeters;
  const touched = [lat !== undefined, lng !== undefined, r !== undefined].filter(Boolean).length;
  if (touched === 0) return { ok: true as const };
  const allNull = lat === null && lng === null && r === null;
  if (allNull) return { ok: true as const };
  const allSet = lat != null && lng != null && r != null;
  if (allSet) return { ok: true as const };
  return {
    ok: false as const,
    message: "Geofence requires latitude, longitude, and radius together (or omit all three / set all to null to clear).",
  };
}

const ROSTER_SHIFT_GENDER = z.enum(["male", "female", "any"]).nullable().optional();
const ROSTER_SHIFT_GUARDS_REQUIRED = z.number().int().min(0).max(50).optional();
/** Weekdays a shift needs cover, as JS day-of-week numbers (0=Sunday … 6=Saturday). */
const ROSTER_SHIFT_DAYS = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .optional()
  .transform((v) => (v === undefined ? undefined : normalizeCoverageDays(v)));

/**
 * A shift only runs when it needs guards *and* has at least one weekday to cover.
 * Undefined fields fall back to `existing`, so this works for both create (schema
 * defaults) and update (the site's current values).
 */
function shiftRunsWith(
  guardsRequired: number | undefined,
  days: number[] | undefined,
  existing: { guardsRequired: number; days: number[] }
): boolean {
  const guards = guardsRequired ?? existing.guardsRequired;
  const coveredDays = days ?? existing.days;
  return guards > 0 && coveredDays.length > 0;
}

const DEFAULT_SHIFT_STATE = { guardsRequired: 1, days: [...ALL_WEEK_DAYS] };

function refineShiftGuardsNotBothZero(
  data: {
    rosterDayShiftGuardsRequired?: number;
    rosterNightShiftGuardsRequired?: number;
    rosterDayShiftDays?: number[];
    rosterNightShiftDays?: number[];
  },
  ctx: z.RefinementCtx
) {
  const dayRuns = shiftRunsWith(
    data.rosterDayShiftGuardsRequired,
    data.rosterDayShiftDays,
    DEFAULT_SHIFT_STATE
  );
  const nightRuns = shiftRunsWith(
    data.rosterNightShiftGuardsRequired,
    data.rosterNightShiftDays,
    DEFAULT_SHIFT_STATE
  );
  if (!dayRuns && !nightRuns) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "At least one shift must require at least 1 guard on at least one day of the week.",
      path: ["rosterDayShiftGuardsRequired"],
    });
  }
}
const createSiteSchema = z
  .object({
    name: z.string().min(1),
    location: z.string().optional(),
    physicalAddress: z.string().optional(),
    contactPersonName: z.string().optional(),
    contactPersonPhone: z.string().optional(),
    clientContactEmail: z.string().email().optional().nullable(),
    contractOrServiceAgreement: z.string().optional(),
    contractStartDate: z.string().optional().nullable(),
    contractEndDate: z.string().optional().nullable(),
    supervisorId: z.string().optional().nullable(),
    riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    siteStatus: z.enum(["ACTIVE", "INACTIVE", "PENDING", "SUSPENDED"]).optional(),
    siteInstructions: z.string().max(10000).optional().nullable(),
    clientId: z.string().optional().nullable(),
    serviceType: z
      .union([z.enum(SERVICE_TYPES), z.literal("")])
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
    monthlyRevenue: z.number().positive().optional(),
    assignedGuardIds: z.array(z.string()).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    geofenceRadiusMeters: z.number().int().positive().max(100_000).optional(),
    rosterSiteRules: z.string().max(8000).optional(),
    rosterSheetNotes: z.string().max(8000).optional(),
    rosterDayShiftGender: ROSTER_SHIFT_GENDER,
    rosterNightShiftGender: ROSTER_SHIFT_GENDER,
    rosterDayShiftGuardsRequired: ROSTER_SHIFT_GUARDS_REQUIRED,
    rosterNightShiftGuardsRequired: ROSTER_SHIFT_GUARDS_REQUIRED,
    rosterDayShiftDays: ROSTER_SHIFT_DAYS,
    rosterNightShiftDays: ROSTER_SHIFT_DAYS,
    autoRosterEnabled: z.boolean().optional(),
    autoRosterMinCoveragePercent: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    const g = refineSiteGeofenceThreeOrNone(data);
    if (!g.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: g.message, path: ["latitude"] });
    }
    refineShiftGuardsNotBothZero(data, ctx);
  });

const updateSiteSchema = z
  .object({
    name: z.string().min(1).optional(),
    location: z.string().optional(),
    physicalAddress: z.string().optional(),
    contactPersonName: z.string().optional(),
    contactPersonPhone: z.string().optional(),
    clientContactEmail: z.string().email().optional().nullable(),
    contractOrServiceAgreement: z.string().optional(),
    contractStartDate: z.string().optional().nullable(),
    contractEndDate: z.string().optional().nullable(),
    supervisorId: z.string().optional().nullable(),
    riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    siteStatus: z.enum(["ACTIVE", "INACTIVE", "PENDING", "SUSPENDED"]).optional(),
    siteInstructions: z.string().max(10000).optional().nullable(),
    clientId: z.string().optional().nullable(),
    serviceType: z
      .union([z.enum(SERVICE_TYPES), z.literal("")])
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
    monthlyRevenue: z.number().positive().optional().nullable(),
    assignedGuardIds: z.array(z.string()).optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    geofenceRadiusMeters: z.number().int().positive().max(100_000).nullable().optional(),
    rosterSiteRules: z.string().max(8000).optional(),
    rosterSheetNotes: z.string().max(8000).optional(),
    rosterDayShiftGender: ROSTER_SHIFT_GENDER,
    rosterNightShiftGender: ROSTER_SHIFT_GENDER,
    rosterDayShiftGuardsRequired: ROSTER_SHIFT_GUARDS_REQUIRED,
    rosterNightShiftGuardsRequired: ROSTER_SHIFT_GUARDS_REQUIRED,
    rosterDayShiftDays: ROSTER_SHIFT_DAYS,
    rosterNightShiftDays: ROSTER_SHIFT_DAYS,
    autoRosterEnabled: z.boolean().optional(),
    autoRosterMinCoveragePercent: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    const g = refineSiteGeofenceThreeOrNone(data);
    if (!g.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: g.message, path: ["latitude"] });
    }
    refineShiftGuardsNotBothZero(data, ctx);
  });

function parseOptionalDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const POST_SHIFT_TYPES = ["day", "night"] as const;

const createPostSchema = z.object({
  name: z.string().min(1),
  shiftType: z.enum(POST_SHIFT_TYPES).default("day"),
});

const updatePostSchema = z.object({
  name: z.string().min(1).optional(),
  shiftType: z.enum(POST_SHIFT_TYPES).optional(),
});

const assignGuardSchema = z.object({
  employeeId: z.string().min(1),
});

export async function sitesRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({ module: "/sites" }),
  ];
  const readProtect = [
    authMiddleware,
    requireCrudCapability({
      // Attendance work queues and exception filters need site names, while
      // create/update permissions remain restricted to the Sites module.
      anyOfModules: ["/sites", "/rostering", "/attendance"],
    }),
  ];
  const manageSites = [
    authMiddleware,
    requireCrudCapability({ module: "/sites" }),
  ];

  app.get("/", { preHandler: readProtect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 100);
    const offset = Number(q.offset) || 0;

    const [sitesRaw, total] = await Promise.all([
      prisma.site.findMany({
        where: { companyId: user.companyId },
        include: siteDetailInclude,
        take: limit,
        skip: offset,
        orderBy: { name: "asc" },
      }),
      prisma.site.count({ where: { companyId: user.companyId } }),
    ]);
    const sites = sitesRaw.map(mapSiteForApi);

    return reply.send({ data: sites, total, limit, offset });
  });

  app.post("/", { preHandler: manageSites }, async (request, reply) => {
    const parsed = createSiteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const d = parsed.data;

    const site = await prisma.site.create({
      data: {
        companyId,
        name: d.name,
        location: d.location,
        physicalAddress: d.physicalAddress,
        contactPersonName: d.contactPersonName,
        contactPersonPhone: d.contactPersonPhone,
        clientContactEmail: d.clientContactEmail ?? undefined,
        contractOrServiceAgreement: d.contractOrServiceAgreement,
        contractStartDate: parseOptionalDate(d.contractStartDate ?? undefined) ?? undefined,
        contractEndDate: parseOptionalDate(d.contractEndDate ?? undefined) ?? undefined,
        supervisorId: d.supervisorId ?? undefined,
        riskLevel: d.riskLevel ?? undefined,
        siteStatus: d.siteStatus ?? undefined,
        siteInstructions: d.siteInstructions ?? undefined,
        clientId: d.clientId ?? undefined,
        serviceType: d.serviceType,
        monthlyRevenue: d.monthlyRevenue,
        latitude:
          d.latitude !== undefined && d.longitude !== undefined && d.geofenceRadiusMeters !== undefined
            ? d.latitude
            : undefined,
        longitude:
          d.latitude !== undefined && d.longitude !== undefined && d.geofenceRadiusMeters !== undefined
            ? d.longitude
            : undefined,
        geofenceRadiusMeters:
          d.latitude !== undefined && d.longitude !== undefined && d.geofenceRadiusMeters !== undefined
            ? d.geofenceRadiusMeters
            : undefined,
        rosterSiteRules: d.rosterSiteRules?.trim() ? d.rosterSiteRules : undefined,
        rosterSheetNotes: d.rosterSheetNotes?.trim() ? d.rosterSheetNotes : undefined,
        rosterDayShiftGender: d.rosterDayShiftGender ?? undefined,
        rosterNightShiftGender: d.rosterNightShiftGender ?? undefined,
        rosterDayShiftGuardsRequired: d.rosterDayShiftGuardsRequired ?? undefined,
        rosterNightShiftGuardsRequired: d.rosterNightShiftGuardsRequired ?? undefined,
        rosterDayShiftDays: d.rosterDayShiftDays ?? undefined,
        rosterNightShiftDays: d.rosterNightShiftDays ?? undefined,
        autoRosterEnabled: d.autoRosterEnabled ?? undefined,
        autoRosterMinCoveragePercent: d.autoRosterMinCoveragePercent ?? undefined,
      },
    });

    if (d.assignedGuardIds && d.assignedGuardIds.length > 0) {
      const guards = await prisma.employee.findMany({
        where: {
          id: { in: d.assignedGuardIds },
          companyId,
          employeeType: "security_officer",
          status: { in: [...ROSTERABLE_STATUSES] },
        },
      });
      await prisma.siteAssignment.createMany({
        data: guards.map((g: { id: string }) => ({ siteId: site.id, employeeId: g.id })),
        skipDuplicates: true,
      });
    }

    const siteWithAssignedRaw = await prisma.site.findUnique({
      where: { id: site.id },
      include: siteDetailInclude,
    });
    const siteWithAssigned = siteWithAssignedRaw ? mapSiteForApi(siteWithAssignedRaw) : null;

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "site.create",
      entityType: "site",
      entityId: site.id,
    });

    if (d.contractEndDate) {
      await syncContractExpiryAlerts(companyId, site.id).catch(() => undefined);
    }

    if (siteWithAssigned?.autoRosterEnabled) {
      void runAutoRosterForSite({
        companyId,
        siteId: site.id,
        triggeredBy: "site_enabled",
        userId: request.user!.sub,
      }).catch((err) => {
        request.log.error({ err }, "auto-roster after site create failed");
      });
    }

    return reply.code(201).send(siteWithAssigned);
  });

  app.get("/:id", { preHandler: readProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const siteRaw = await prisma.site.findFirst({
      where: { id, companyId: user.companyId },
      include: siteDetailInclude,
    });

    if (!siteRaw) {
      return reply.code(404).send({ error: "Site not found" });
    }

    return reply.send(mapSiteForApi(siteRaw));
  });

  app.put("/:id", { preHandler: manageSites }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSiteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const existing = await prisma.site.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Site not found" });
    }

    const d = parsed.data;
    const {
      assignedGuardIds,
      latitude,
      longitude,
      geofenceRadiusMeters,
      rosterSiteRules,
      rosterSheetNotes,
      rosterDayShiftGender,
      rosterNightShiftGender,
      rosterDayShiftGuardsRequired,
      rosterNightShiftGuardsRequired,
      rosterDayShiftDays,
      rosterNightShiftDays,
      autoRosterEnabled,
      autoRosterMinCoveragePercent,
      ...rest
    } = d;

    const geoPatch: Record<string, unknown> = {};
    if (latitude !== undefined) geoPatch.latitude = latitude;
    if (longitude !== undefined) geoPatch.longitude = longitude;
    if (geofenceRadiusMeters !== undefined) geoPatch.geofenceRadiusMeters = geofenceRadiusMeters;

    const rosterPatch: Record<string, unknown> = {};
    if (rosterSiteRules !== undefined) {
      rosterPatch.rosterSiteRules = rosterSiteRules.trim() === "" ? null : rosterSiteRules;
    }
    if (rosterSheetNotes !== undefined) {
      rosterPatch.rosterSheetNotes = rosterSheetNotes.trim() === "" ? null : rosterSheetNotes;
    }
    if (rosterDayShiftGender !== undefined) {
      rosterPatch.rosterDayShiftGender = rosterDayShiftGender;
    }
    if (rosterNightShiftGender !== undefined) {
      rosterPatch.rosterNightShiftGender = rosterNightShiftGender;
    }
    if (rosterDayShiftGuardsRequired !== undefined) {
      rosterPatch.rosterDayShiftGuardsRequired = rosterDayShiftGuardsRequired;
    }
    if (rosterNightShiftGuardsRequired !== undefined) {
      rosterPatch.rosterNightShiftGuardsRequired = rosterNightShiftGuardsRequired;
    }
    if (rosterDayShiftDays !== undefined) {
      rosterPatch.rosterDayShiftDays = rosterDayShiftDays;
    }
    if (rosterNightShiftDays !== undefined) {
      rosterPatch.rosterNightShiftDays = rosterNightShiftDays;
    }
    const dayShiftRuns = shiftRunsWith(rosterDayShiftGuardsRequired, rosterDayShiftDays, {
      guardsRequired: existing.rosterDayShiftGuardsRequired,
      days: existing.rosterDayShiftDays,
    });
    const nightShiftRuns = shiftRunsWith(rosterNightShiftGuardsRequired, rosterNightShiftDays, {
      guardsRequired: existing.rosterNightShiftGuardsRequired,
      days: existing.rosterNightShiftDays,
    });
    if (!dayShiftRuns && !nightShiftRuns) {
      return reply.code(400).send({
        error: "Invalid shift staffing",
        message:
          "At least one shift must require at least 1 guard on at least one day of the week.",
      });
    }
    if (
      autoRosterEnabled === true &&
      ["running", "needs_attention"].includes(existing.rosterContinuityState)
    ) {
      return reply.code(409).send({
        error: "Continuous rostering is already active",
        message: "Manage the ongoing roster from the Rostering page instead of enabling the legacy auto-roster.",
      });
    }
    if (autoRosterEnabled !== undefined) rosterPatch.autoRosterEnabled = autoRosterEnabled;
    if (autoRosterMinCoveragePercent !== undefined) {
      rosterPatch.autoRosterMinCoveragePercent = autoRosterMinCoveragePercent;
    }

    const wasAutoEnabled = existing.autoRosterEnabled;

    const {
      contractStartDate,
      contractEndDate,
      siteInstructions,
      ...restFields
    } = rest as typeof rest & {
      contractStartDate?: string | null;
      contractEndDate?: string | null;
      siteInstructions?: string | null;
    };

    const updateData: Record<string, unknown> = {
      ...restFields,
      ...geoPatch,
      ...rosterPatch,
    };
    if (contractStartDate !== undefined) {
      updateData.contractStartDate = parseOptionalDate(contractStartDate);
    }
    if (contractEndDate !== undefined) {
      updateData.contractEndDate = parseOptionalDate(contractEndDate);
    }
    if (siteInstructions !== undefined) {
      updateData.siteInstructions =
        siteInstructions && siteInstructions.trim() ? siteInstructions : null;
    }
    const hasSiteFieldUpdates = Object.keys(updateData).length > 0;

    if (hasSiteFieldUpdates) {
      const siteUpdate = await prisma.site.updateMany({
        where: { id, companyId },
        data: updateData,
      });
      if (siteUpdate.count === 0) {
        return reply.code(404).send({ error: "Site not found" });
      }
    }

    if (assignedGuardIds !== undefined) {
      await prisma.siteAssignment.deleteMany({ where: { siteId: id } });
      if (assignedGuardIds.length > 0) {
        const guards = await prisma.employee.findMany({
          where: {
            id: { in: assignedGuardIds },
            companyId,
            employeeType: "security_officer",
            status: { in: [...ROSTERABLE_STATUSES] },
          },
        });
        await prisma.siteAssignment.createMany({
          data: guards.map((g: { id: string }) => ({ siteId: id, employeeId: g.id })),
          skipDuplicates: true,
        });
      }
    }

    const siteWithAssignedRaw = await prisma.site.findFirst({
      where: { id, companyId },
      include: siteDetailInclude,
    });
    const siteWithAssigned = siteWithAssignedRaw ? mapSiteForApi(siteWithAssignedRaw) : null;

    if (!siteWithAssigned) {
      return reply.code(404).send({ error: "Site not found" });
    }

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "site.update",
      entityType: "site",
      entityId: id,
    });

    if (contractEndDate !== undefined) {
      await syncContractExpiryAlerts(companyId, id).catch(() => undefined);
    }

    const nowEnabled = siteWithAssigned.autoRosterEnabled;
    const autoConfigChanged =
      autoRosterEnabled !== undefined ||
      autoRosterMinCoveragePercent !== undefined;
    if (nowEnabled && (!wasAutoEnabled || autoConfigChanged)) {
      void runAutoRosterForSite({
        companyId,
        siteId: id,
        triggeredBy: wasAutoEnabled ? "manual" : "site_enabled",
        userId: request.user!.sub,
      }).catch((err) => {
        request.log.error({ err }, "auto-roster after site update failed");
      });
    }
    if (["running", "needs_attention"].includes(siteWithAssigned.rosterContinuityState)) {
      void reconcileRosterContinuityForSite(companyId, id, {
        userId: request.user!.sub,
        trigger: "site_updated",
      }).catch((err) => {
        request.log.error({ err }, "continuous roster after site update failed");
      });
    }

    return reply.send(siteWithAssigned);
  });

  app.delete("/:id", { preHandler: manageSites }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.user!.companyId;

    const existing = await prisma.site.findFirst({
      where: { id, companyId },
      include: { posts: true },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Site not found" });
    }

    const shiftCount = await prisma.shift.count({
      where: { siteId: id },
    });

    if (shiftCount > 0) {
      return reply.code(400).send({
        error: "Cannot delete site",
        message: "Site has posts with shifts. Remove or reassign shifts first.",
      });
    }

    const deleted = await prisma.site.deleteMany({ where: { id, companyId } });
    if (deleted.count === 0) {
      return reply.code(404).send({ error: "Site not found" });
    }

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "site.delete",
      entityType: "site",
      entityId: id,
    });

    return reply.code(204).send();
  });

  app.get("/:siteId/posts", { preHandler: readProtect }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const user = request.user!;

    const site = await prisma.site.findFirst({
      where: { id: siteId, companyId: user.companyId },
    });

    if (!site) {
      return reply.code(404).send({ error: "Site not found" });
    }

    const posts = await prisma.sitePost.findMany({
      where: { siteId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        guardEligibilities: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                status: true,
                phone: true,
              },
            },
          },
        },
        coverageRequirements: { where: { isEnabled: true } },
      },
    });

    return reply.send({
      data: posts.map((p) => ({
        id: p.id,
        name: p.name,
        shiftType: p.coverageRequirements.find((c) => c.shiftTypeCode === "day")
          ? "day"
          : p.coverageRequirements.find((c) => c.shiftTypeCode === "night")
            ? "night"
            : null,
      })),
    });
  });

  app.post("/:siteId/posts", { preHandler: protect }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const parsed = createPostSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const site = await prisma.site.findFirst({
      where: { id: siteId, companyId: user.companyId },
    });

    if (!site) {
      return reply.code(404).send({ error: "Site not found" });
    }

    const shiftType = parsed.data.shiftType ?? "day";
    const post = await prisma.sitePost.create({
      data: {
        siteId,
        name: parsed.data.name,
      },
    });
    await prisma.coverageRequirement.create({
      data: {
        siteId,
        sitePostId: post.id,
        shiftTypeCode: shiftType,
        guardsRequired: 1,
        genderRule: "any",
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId: user.companyId,
      action: "post.create",
      entityType: "post",
      entityId: post.id,
    });

    return reply.code(201).send({
      id: post.id,
      name: post.name,
      shiftType,
    });
  });

  app.put("/:siteId/posts/:postId", { preHandler: protect }, async (request, reply) => {
    const { siteId, postId } = request.params as { siteId: string; postId: string };
    const parsed = updatePostSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const site = await prisma.site.findFirst({
      where: { id: siteId, companyId: user.companyId },
    });

    if (!site) {
      return reply.code(404).send({ error: "Site not found" });
    }

    const post = await prisma.sitePost.findFirst({
      where: { id: postId, siteId, site: { companyId: user.companyId } },
      include: { coverageRequirements: { where: { isEnabled: true } } },
    });

    if (!post) {
      return reply.code(404).send({ error: "Post not found" });
    }

    if (parsed.data.name) {
      await prisma.sitePost.updateMany({
        where: { id: postId, site: { companyId: user.companyId } },
        data: { name: parsed.data.name },
      });
    }

    if (parsed.data.shiftType) {
      const existing = post.coverageRequirements.find(
        (c) => c.shiftTypeCode === parsed.data.shiftType
      );
      if (existing) {
        await prisma.coverageRequirement.update({
          where: { id: existing.id },
          data: { isEnabled: true },
        });
      } else {
        await prisma.coverageRequirement.create({
          data: {
            siteId,
            sitePostId: postId,
            shiftTypeCode: parsed.data.shiftType,
            guardsRequired: 1,
            genderRule: "any",
          },
        });
      }
    }

    const updated = await prisma.sitePost.findFirst({
      where: { id: postId },
      include: { coverageRequirements: { where: { isEnabled: true } } },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId: user.companyId,
      action: "post.update",
      entityType: "post",
      entityId: postId,
    });

    return reply.send({
      id: updated!.id,
      name: updated!.name,
      shiftType:
        updated!.coverageRequirements.find((c) => c.shiftTypeCode === "night") &&
        !updated!.coverageRequirements.find((c) => c.shiftTypeCode === "day")
          ? "night"
          : updated!.coverageRequirements.find((c) => c.shiftTypeCode === "day")
            ? "day"
            : null,
    });
  });

  app.delete("/:siteId/posts/:postId", { preHandler: protect }, async (request, reply) => {
    const { siteId, postId } = request.params as { siteId: string; postId: string };
    const user = request.user!;

    const site = await prisma.site.findFirst({
      where: { id: siteId, companyId: user.companyId },
    });

    if (!site) {
      return reply.code(404).send({ error: "Site not found" });
    }

    const post = await prisma.sitePost.findFirst({
      where: { id: postId, siteId, site: { companyId: user.companyId } },
    });

    if (!post) {
      return reply.code(404).send({ error: "Post not found" });
    }

    const shiftCount = await prisma.shift.count({
      where: { siteId, legacyPostName: post.name },
    });

    if (post && shiftCount > 0) {
      return reply.code(400).send({
        error: "Cannot delete post",
        message: "Post has shifts. Remove shifts first.",
      });
    }

    await prisma.sitePost.deleteMany({
      where: { id: postId, site: { companyId: user.companyId } },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId: user.companyId,
      action: "post.delete",
      entityType: "post",
      entityId: postId,
    });

    return reply.code(204).send();
  });

  app.post("/:siteId/posts/:postId/guards", { preHandler: protect }, async (request, reply) => {
    const { siteId, postId } = request.params as { siteId: string; postId: string };
    const parsed = assignGuardSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const site = await prisma.site.findFirst({
      where: { id: siteId, companyId: user.companyId },
    });

    if (!site) {
      return reply.code(404).send({ error: "Site not found" });
    }

    const post = await prisma.sitePost.findFirst({
      where: { id: postId, siteId },
    });

    if (!post) {
      return reply.code(404).send({ error: "Post not found" });
    }

    const employee = await prisma.employee.findFirst({
      where: {
        id: parsed.data.employeeId,
        companyId: user.companyId,
        employeeType: "security_officer",
      },
    });

    if (!employee) {
      return reply.code(404).send({ error: "Guard not found" });
    }

    if (!ROSTERABLE_STATUSES.includes(employee.status as (typeof ROSTERABLE_STATUSES)[number])) {
      return reply.code(400).send({
        error: "Guard is not active",
        message:
          "Only active guards can be assigned to a site post. Reactivate the guard in Team first.",
      });
    }

    const existing = await prisma.guardSiteEligibility.findFirst({
      where: { sitePostId: postId, employeeId: parsed.data.employeeId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            status: true,
            phone: true,
            gender: true,
            employeeType: true,
          },
        },
      },
    });

    if (existing) {
      return reply.code(200).send({
        id: existing.id,
        employee: existing.employee,
      });
    }

    const assignment = await prisma.guardSiteEligibility.create({
      data: {
        siteId,
        sitePostId: postId,
        employeeId: parsed.data.employeeId,
        isPrimary: true,
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            status: true,
            phone: true,
            gender: true,
            employeeType: true,
          },
        },
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId: user.companyId,
      action: "post_assignment.create",
      entityType: "post_assignment",
      entityId: assignment.id,
      metadata: { postId, employeeId: parsed.data.employeeId },
    });

    return reply.code(201).send({
      id: assignment.id,
      employee: assignment.employee,
    });
  });

  app.delete("/:siteId/posts/:postId/guards/:employeeId", { preHandler: protect }, async (request, reply) => {
    const { siteId, postId, employeeId } = request.params as {
      siteId: string;
      postId: string;
      employeeId: string;
    };

    const user = request.user!;
    const site = await prisma.site.findFirst({
      where: { id: siteId, companyId: user.companyId },
    });

    if (!site) {
      return reply.code(404).send({ error: "Site not found" });
    }

    const post = await prisma.sitePost.findFirst({
      where: { id: postId, siteId },
    });

    if (!post) {
      return reply.code(404).send({ error: "Post not found" });
    }

    await prisma.guardSiteEligibility.deleteMany({
      where: {
        sitePostId: postId,
        employeeId,
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId: user.companyId,
      action: "post_assignment.delete",
      entityType: "post",
      entityId: postId,
      metadata: { employeeId },
    });

    return reply.code(204).send();
  });
}
