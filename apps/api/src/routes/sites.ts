import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import { runAutoRosterForSite } from "../services/auto-roster.service.js";

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
const ROSTER_SHIFT_GUARDS_REQUIRED = z.number().int().min(1).max(50).optional();
const AUTO_ROSTER_PATTERN = z.enum(["3_on_3_off", "custom_builder"]).nullable().optional();
const autoRosterBlockSchema = z.object({
  type: z.enum(["day", "night", "off"]),
  count: z.number().min(1).max(14),
});

const createSiteSchema = z
  .object({
    name: z.string().min(1),
    location: z.string().optional(),
    physicalAddress: z.string().optional(),
    contactPersonName: z.string().optional(),
    contactPersonPhone: z.string().optional(),
    contractOrServiceAgreement: z.string().optional(),
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
    autoRosterEnabled: z.boolean().optional(),
    autoRosterPattern: AUTO_ROSTER_PATTERN,
    autoRosterCustomBlocks: z.array(autoRosterBlockSchema).nullable().optional(),
    autoRosterMinCoveragePercent: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    const g = refineSiteGeofenceThreeOrNone(data);
    if (!g.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: g.message, path: ["latitude"] });
    }
  });

const updateSiteSchema = z
  .object({
    name: z.string().min(1).optional(),
    location: z.string().optional(),
    physicalAddress: z.string().optional(),
    contactPersonName: z.string().optional(),
    contactPersonPhone: z.string().optional(),
    contractOrServiceAgreement: z.string().optional(),
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
    autoRosterEnabled: z.boolean().optional(),
    autoRosterPattern: AUTO_ROSTER_PATTERN,
    autoRosterCustomBlocks: z.array(autoRosterBlockSchema).nullable().optional(),
    autoRosterMinCoveragePercent: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((data, ctx) => {
    const g = refineSiteGeofenceThreeOrNone(data);
    if (!g.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: g.message, path: ["latitude"] });
    }
  });

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
    requireRole(["admin", "operations_manager", "hr_payroll", "supervisor"], { module: "/sites" }),
  ];
  const readProtect = [
    authMiddleware,
    requireRole(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"], {
      anyOfModules: ["/sites", "/rostering"],
    }),
  ];
  const manageSites = [
    authMiddleware,
    requireRole(["admin", "operations_manager", "supervisor"], { module: "/sites" }),
  ];

  app.get("/", { preHandler: readProtect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 100);
    const offset = Number(q.offset) || 0;

    const [sites, total] = await Promise.all([
      prisma.site.findMany({
        where: { companyId: user.companyId },
        include: {
          posts: {
            include: {
              assignedGuards: {
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
              },
            },
          },
          assignedGuards: {
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
          },
        },
        take: limit,
        skip: offset,
        orderBy: { name: "asc" },
      }),
      prisma.site.count({ where: { companyId: user.companyId } }),
    ]);

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
        contractOrServiceAgreement: d.contractOrServiceAgreement,
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
        autoRosterEnabled: d.autoRosterEnabled ?? undefined,
        autoRosterPattern: d.autoRosterPattern ?? undefined,
        autoRosterCustomBlocks:
          d.autoRosterCustomBlocks === null
            ? Prisma.JsonNull
            : d.autoRosterCustomBlocks ?? undefined,
        autoRosterMinCoveragePercent: d.autoRosterMinCoveragePercent ?? undefined,
      },
    });

    if (d.assignedGuardIds && d.assignedGuardIds.length > 0) {
      const guards = await prisma.employee.findMany({
        where: {
          id: { in: d.assignedGuardIds },
          companyId,
          employeeType: "security",
        },
      });
      await prisma.siteAssignment.createMany({
        data: guards.map((g: { id: string }) => ({ siteId: site.id, employeeId: g.id })),
        skipDuplicates: true,
      });
    }

    const siteWithAssigned = await prisma.site.findUnique({
      where: { id: site.id },
      include: {
        posts: {
          include: {
            assignedGuards: {
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
            },
          },
        },
        assignedGuards: {
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
        },
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "site.create",
      entityType: "site",
      entityId: site.id,
    });

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

    const site = await prisma.site.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        posts: {
          include: {
            assignedGuards: {
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
            },
          },
        },
        assignedGuards: {
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
        },
      },
    });

    if (!site) {
      return reply.code(404).send({ error: "Site not found" });
    }

    return reply.send(site);
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
      autoRosterEnabled,
      autoRosterPattern,
      autoRosterCustomBlocks,
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
    if (autoRosterEnabled !== undefined) rosterPatch.autoRosterEnabled = autoRosterEnabled;
    if (autoRosterPattern !== undefined) rosterPatch.autoRosterPattern = autoRosterPattern;
    if (autoRosterCustomBlocks !== undefined) {
      rosterPatch.autoRosterCustomBlocks =
        autoRosterCustomBlocks === null ? Prisma.JsonNull : autoRosterCustomBlocks;
    }
    if (autoRosterMinCoveragePercent !== undefined) {
      rosterPatch.autoRosterMinCoveragePercent = autoRosterMinCoveragePercent;
    }

    const wasAutoEnabled = existing.autoRosterEnabled;

    const siteUpdate = await prisma.site.updateMany({
      where: { id, companyId },
      data: { ...rest, ...geoPatch, ...rosterPatch },
    });
    if (siteUpdate.count === 0) {
      return reply.code(404).send({ error: "Site not found" });
    }

    if (assignedGuardIds !== undefined) {
      await prisma.siteAssignment.deleteMany({ where: { siteId: id } });
      if (assignedGuardIds.length > 0) {
        const guards = await prisma.employee.findMany({
          where: {
            id: { in: assignedGuardIds },
            companyId,
            employeeType: "security",
          },
        });
        await prisma.siteAssignment.createMany({
          data: guards.map((g: { id: string }) => ({ siteId: id, employeeId: g.id })),
          skipDuplicates: true,
        });
      }
    }

    const siteWithAssigned = await prisma.site.findFirst({
      where: { id, companyId },
      include: {
        posts: {
          include: {
            assignedGuards: {
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
            },
          },
        },
        assignedGuards: {
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
        },
      },
    });

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

    const nowEnabled = siteWithAssigned.autoRosterEnabled;
    const autoConfigChanged =
      autoRosterEnabled !== undefined ||
      autoRosterPattern !== undefined ||
      autoRosterCustomBlocks !== undefined ||
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
      where: { post: { siteId: id } },
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

    const posts = await prisma.post.findMany({
      where: { siteId },
      orderBy: { name: "asc" },
    });

    return reply.send({ data: posts });
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

    const post = await prisma.post.create({
      data: {
        siteId,
        name: parsed.data.name,
        shiftType: parsed.data.shiftType ?? "day",
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId: user.companyId,
      action: "post.create",
      entityType: "post",
      entityId: post.id,
    });

    return reply.code(201).send(post);
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

    const post = await prisma.post.findFirst({
      where: { id: postId, siteId, site: { companyId: user.companyId } },
    });

    if (!post) {
      return reply.code(404).send({ error: "Post not found" });
    }

    const postUpdate = await prisma.post.updateMany({
      where: { id: postId, site: { companyId: user.companyId } },
      data: parsed.data,
    });
    if (postUpdate.count === 0) {
      return reply.code(404).send({ error: "Post not found" });
    }

    const updated = await prisma.post.findFirst({ where: { id: postId } });

    await createAuditLog({
      userId: request.user!.sub,
      companyId: user.companyId,
      action: "post.update",
      entityType: "post",
      entityId: postId,
    });

    return reply.send(updated);
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

    const post = await prisma.post.findFirst({
      where: { id: postId, siteId, site: { companyId: user.companyId } },
      include: { _count: { select: { shifts: true } } },
    });

    if (!post) {
      return reply.code(404).send({ error: "Post not found" });
    }

    if (post._count.shifts > 0) {
      return reply.code(400).send({
        error: "Cannot delete post",
        message: "Post has shifts. Remove shifts first.",
      });
    }

    await prisma.post.deleteMany({
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

    const post = await prisma.post.findFirst({
      where: { id: postId, siteId },
    });

    if (!post) {
      return reply.code(404).send({ error: "Post not found" });
    }

    const employee = await prisma.employee.findFirst({
      where: {
        id: parsed.data.employeeId,
        companyId: user.companyId,
        employeeType: "security",
      },
    });

    if (!employee) {
      return reply.code(404).send({ error: "Guard not found" });
    }

    const existing = await prisma.postAssignment.findUnique({
      where: {
        postId_employeeId: { postId, employeeId: parsed.data.employeeId },
      },
    });

    if (existing) {
      return reply.code(200).send(existing);
    }

    const assignment = await prisma.postAssignment.create({
      data: {
        postId,
        employeeId: parsed.data.employeeId,
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

    return reply.code(201).send(assignment);
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

    const post = await prisma.post.findFirst({
      where: { id: postId, siteId },
    });

    if (!post) {
      return reply.code(404).send({ error: "Post not found" });
    }

    await prisma.postAssignment.deleteMany({
      where: {
        postId,
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
