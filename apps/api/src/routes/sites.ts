import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import {
  rosterShiftGenderPolicyZod,
  type RosterShiftGenderPolicy,
} from "../services/site-roster-policy.service.js";

const rosterShiftGenderPolicyField = rosterShiftGenderPolicyZod.optional().nullable();

function normalizeRosterShiftGenderPolicyForDb(
  p: RosterShiftGenderPolicy | null | undefined
): Prisma.InputJsonValue | null | undefined {
  if (p === undefined) return undefined;
  if (p === null) return null;
  const next: RosterShiftGenderPolicy = {};
  if (p.day !== undefined) next.day = p.day;
  if (p.night !== undefined) next.night = p.night;
  if (next.day === undefined && next.night === undefined) return null;
  return next as Prisma.InputJsonValue;
}

const SERVICE_TYPES = [
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
    rosterSiteRules: z.string().optional(),
    rosterShiftGenderPolicy: rosterShiftGenderPolicyField,
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    geofenceRadiusMeters: z.number().int().positive().max(100_000).optional(),
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
    rosterSiteRules: z.string().optional().nullable(),
    rosterShiftGenderPolicy: rosterShiftGenderPolicyField,
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    geofenceRadiusMeters: z.number().int().positive().max(100_000).nullable().optional(),
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
        rosterSiteRules: d.rosterSiteRules,
        ...((): Record<string, unknown> => {
          const p = normalizeRosterShiftGenderPolicyForDb(d.rosterShiftGenderPolicy);
          if (p === undefined || p === null) return {};
          return { rosterShiftGenderPolicy: p };
        })(),
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
    const { assignedGuardIds, latitude, longitude, geofenceRadiusMeters, rosterShiftGenderPolicy, ...rest } = d;

    const geoPatch: Record<string, unknown> = {};
    if (latitude !== undefined) geoPatch.latitude = latitude;
    if (longitude !== undefined) geoPatch.longitude = longitude;
    if (geofenceRadiusMeters !== undefined) geoPatch.geofenceRadiusMeters = geofenceRadiusMeters;

    const policyPatch: Record<string, unknown> = {};
    if (rosterShiftGenderPolicy !== undefined) {
      const p = normalizeRosterShiftGenderPolicyForDb(rosterShiftGenderPolicy);
      policyPatch.rosterShiftGenderPolicy = p === null ? Prisma.JsonNull : p;
    }

    const site = await prisma.site.update({
      where: { id },
      data: { ...rest, ...geoPatch, ...policyPatch },
    });

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

    const siteWithAssigned = await prisma.site.findUnique({
      where: { id },
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
              },
            },
          },
        },
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "site.update",
      entityType: "site",
      entityId: id,
    });

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

    await prisma.site.delete({ where: { id } });

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
      where: { id: postId, siteId },
    });

    if (!post) {
      return reply.code(404).send({ error: "Post not found" });
    }

    const updated = await prisma.post.update({
      where: { id: postId },
      data: parsed.data,
    });

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
      where: { id: postId, siteId },
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

    await prisma.post.delete({ where: { id: postId } });

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
