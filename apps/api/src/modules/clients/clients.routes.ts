import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { requireAnyCapability, requireCapability } from "../../middleware/authorization.js";
import type { AuthenticatedUser } from "../../lib/types.js";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { hasCapability } from "../../lib/capabilities.js";
import { getExceptionAnalytics } from "../attendance-exceptions/exceptions.service.js";

async function resolveClientForUser(companyId: string, userId: string) {
  return prisma.client.findFirst({
    where: { companyId, userId, isActive: true },
  });
}

/** Client IDs the current user may access — empty for non-clients means no portal data. */
export function clientOwnsSite(
  clientId: string,
  siteClientId: string | null | undefined
): boolean {
  return !!siteClientId && siteClientId === clientId;
}

type PortalClientResolution =
  | { ok: true; clientId: string; clientName: string | null }
  | { ok: false; statusCode: 400 | 403; message: string };

export async function resolveClientPortalAccess(
  user: AuthenticatedUser,
  queryClientId?: string
): Promise<PortalClientResolution> {
  const client = await resolveClientForUser(user.companyId, user.sub);

  if (user.accountType === "client") {
    if (!client) {
      return {
        ok: false,
        statusCode: 403,
        message: "No client profile linked to this account",
      };
    }
    if (queryClientId && queryClientId !== client.id) {
      return { ok: false, statusCode: 403, message: "Cannot view other clients" };
    }
    return { ok: true, clientId: client.id, clientName: client.name };
  }

  if (user.accountType === "staff") {
    if (!hasCapability(user, "/client-portal", "view")) {
      return {
        ok: false,
        statusCode: 403,
        message: "Client portal view access is required for preview",
      };
    }
    if (!queryClientId) {
      return { ok: false, statusCode: 400, message: "clientId required for admin preview" };
    }
    const target = await prisma.client.findFirst({
      where: { id: queryClientId, companyId: user.companyId },
    });
    if (!target) {
      return { ok: false, statusCode: 403, message: "Client not found in your company" };
    }
    return { ok: true, clientId: target.id, clientName: target.name };
  }

  return { ok: false, statusCode: 403, message: "Client portal access only" };
}

export async function clientsRoutes(app: FastifyInstance) {
  const clientViewProtect = [
    authMiddleware,
    requireAnyCapability(["/settings", "/sites"], "view"),
  ];
  const clientCreateProtect = [authMiddleware, requireCapability("/sites", "create")];
  const clientEditProtect = [authMiddleware, requireCapability("/sites", "edit")];

  app.get("/", { preHandler: clientViewProtect }, async (request, reply) => {
    const user = request.user!;
    const clients = await prisma.client.findMany({
      where: { companyId: user.companyId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { sites: true } },
      },
      orderBy: { name: "asc" },
    });
    return reply.send(clients);
  });

  app.get("/user-candidates", { preHandler: clientViewProtect }, async (request, reply) => {
    const users = await prisma.user.findMany({
      where: {
        companyId: request.user!.companyId,
        accountType: "client",
        isActive: true,
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
    return reply.send({ data: users });
  });

  app.post("/", { preHandler: clientCreateProtect }, async (request, reply) => {
    const user = request.user!;
    const schema = z.object({
      name: z.string().min(1),
      email: z.string().email().optional().nullable(),
      phone: z.string().optional().nullable(),
      userId: z.string().optional().nullable(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      });
    }
    if (parsed.data.userId) {
      const linkUser = await prisma.user.findFirst({
        where: { id: parsed.data.userId, companyId: user.companyId, accountType: "client" },
      });
      if (!linkUser) {
        return reply.code(400).send({
          error: "Validation error",
          message: "Linked user must be a client account",
        });
      }
    }
    const client = await prisma.client.create({
      data: {
        companyId: user.companyId,
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone,
        userId: parsed.data.userId,
      },
    });
    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "client.create",
      entityType: "Client",
      entityId: client.id,
    });
    return reply.code(201).send(client);
  });

  app.patch("/:id", { preHandler: clientEditProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const schema = z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional().nullable(),
      phone: z.string().optional().nullable(),
      userId: z.string().optional().nullable(),
      isActive: z.boolean().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      });
    }
    const existing = await prisma.client.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Client not found" });
    }
    if (parsed.data.userId) {
      const linkUser = await prisma.user.findFirst({
        where: { id: parsed.data.userId, companyId: user.companyId, accountType: "client" },
      });
      if (!linkUser) {
        return reply.code(400).send({
          error: "Validation error",
          message: "Linked user must be a client account",
        });
      }
    }
    const client = await prisma.client.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
        ...(parsed.data.userId !== undefined ? { userId: parsed.data.userId } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      },
    });
    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "client.update",
      entityType: "Client",
      entityId: client.id,
    });
    return reply.send(client);
  });
}

export async function clientPortalRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCapability("/client-portal", "view"),
  ];

  app.get("/dashboard", { preHandler: protect as never }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { clientId?: string };
    const access = await resolveClientPortalAccess(user, q.clientId);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ error: access.statusCode === 400 ? "Validation error" : "Forbidden", message: access.message });
    }
    const clientId = access.clientId;

    const sites = await prisma.site.findMany({
      where: { companyId: user.companyId, clientId },
      select: {
        id: true,
        name: true,
        siteStatus: true,
        riskLevel: true,
        physicalAddress: true,
        _count: { select: { assignedGuards: { where: { isActive: true } } } },
      },
    });
    const siteIds = sites.map((s) => s.id);

    const [incidents, openIncidents] = await Promise.all([
      prisma.incident.count({
        where: { companyId: user.companyId, siteId: { in: siteIds }, clientVisible: true },
      }),
      prisma.incident.count({
        where: {
          companyId: user.companyId,
          siteId: { in: siteIds },
          clientVisible: true,
          status: { in: ["SUBMITTED", "UNDER_REVIEW", "APPROVED"] },
        },
      }),
    ]);

    return reply.send({
      client: { id: clientId, name: access.clientName ?? "Client" },
      sitesCount: sites.length,
      guardsDeployed: sites.reduce((n, s) => n + s._count.assignedGuards, 0),
      clientVisibleIncidents: incidents,
      openIncidents,
      sites,
    });
  });

  app.get("/sites", { preHandler: protect as never }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { clientId?: string };
    const access = await resolveClientPortalAccess(user, q.clientId);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ error: access.statusCode === 400 ? "Validation error" : "Forbidden", message: access.message });
    }
    const clientId = access.clientId;
    const sites = await prisma.site.findMany({
      where: { companyId: user.companyId, clientId },
      select: {
        id: true,
        name: true,
        physicalAddress: true,
        siteStatus: true,
        riskLevel: true,
        contactPersonName: true,
        contactPersonPhone: true,
        assignedGuards: {
          where: { isActive: true },
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, jobRole: true } },
          },
        },
      },
    });
    return reply.send(sites);
  });

  app.get("/incidents", { preHandler: protect as never }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { clientId?: string };
    const access = await resolveClientPortalAccess(user, q.clientId);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ error: access.statusCode === 400 ? "Validation error" : "Forbidden", message: access.message });
    }
    const clientId = access.clientId;
    const sites = await prisma.site.findMany({
      where: { companyId: user.companyId, clientId },
      select: { id: true },
    });
    const incidents = await prisma.incident.findMany({
      where: {
        companyId: user.companyId,
        siteId: { in: sites.map((s) => s.id) },
        clientVisible: true,
        status: { not: "DRAFT" },
      },
      select: {
        id: true,
        incidentNumber: true,
        title: true,
        incidentType: true,
        severity: true,
        status: true,
        incidentDateTime: true,
        description: true,
        site: { select: { id: true, name: true } },
      },
      orderBy: { incidentDateTime: "desc" },
      take: 100,
    });
    return reply.send(incidents);
  });

  app.get("/attendance-summary", { preHandler: protect as never }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as { clientId?: string; periodStart?: string; periodEnd?: string };
    const access = await resolveClientPortalAccess(user, q.clientId);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ error: access.statusCode === 400 ? "Validation error" : "Forbidden", message: access.message });
    }
    const clientId = access.clientId;
    const sites = await prisma.site.findMany({
      where: { companyId: user.companyId, clientId },
      select: { id: true, name: true },
    });
    const siteIds = sites.map((s) => s.id);
    const periodStart = q.periodStart ? new Date(q.periodStart) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const periodEnd = q.periodEnd ? new Date(q.periodEnd) : new Date();

    const [totalShifts, withClockIn] = await Promise.all([
      prisma.shift.count({
        where: {
          companyId: user.companyId,
          siteId: { in: siteIds },
          startTime: { gte: periodStart, lte: periodEnd },
        },
      }),
      prisma.shift.count({
        where: {
          companyId: user.companyId,
          siteId: { in: siteIds },
          startTime: { gte: periodStart, lte: periodEnd },
          attendances: { some: { clockIn: { not: null } } },
        },
      }),
    ]);

    // Client-safe analytics only — no payroll, no private employee docs
    const analytics = await getExceptionAnalytics(user.companyId, periodStart, periodEnd);
    const bySite = analytics.bySite.filter((s) => s.siteId && siteIds.includes(s.siteId));

    return reply.send({
      periodStart,
      periodEnd,
      sites,
      totalShifts,
      attendedShifts: withClockIn,
      completionRate: totalShifts > 0 ? Math.round((withClockIn / totalShifts) * 1000) / 10 : 100,
      exceptionsBySite: bySite,
    });
  });
}
