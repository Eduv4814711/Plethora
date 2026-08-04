import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { requireAnyCapability, requireCapability } from "../../middleware/authorization.js";
import { SITE_TIMESHEET_MODULES } from "../rosters/site-timesheet-access.js";
import { registerClientReportRoutes } from "./client-reports.routes.js";
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

/** Billing details used on quotes, invoices and statements. Shared by create and update. */
const billingFields = {
  billingEmail: z.string().email().optional().nullable(),
  billingAddress: z.string().max(1000).optional().nullable(),
  vatNumber: z.string().max(50).optional().nullable(),
  registrationNumber: z.string().max(50).optional().nullable(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
} as const;

type BillingFieldInput = {
  billingEmail?: string | null;
  billingAddress?: string | null;
  vatNumber?: string | null;
  registrationNumber?: string | null;
  paymentTermsDays?: number;
};

/** Only includes keys the caller actually supplied, so PATCH stays partial. */
function pickBillingFields(data: BillingFieldInput) {
  return {
    ...(data.billingEmail !== undefined ? { billingEmail: data.billingEmail } : {}),
    ...(data.billingAddress !== undefined ? { billingAddress: data.billingAddress } : {}),
    ...(data.vatNumber !== undefined ? { vatNumber: data.vatNumber } : {}),
    ...(data.registrationNumber !== undefined ? { registrationNumber: data.registrationNumber } : {}),
    ...(data.paymentTermsDays !== undefined ? { paymentTermsDays: data.paymentTermsDays } : {}),
  };
}

/** Operational contact and month-end reporting details. Shared by create and update. */
const contactFields = {
  contactPersonName: z.string().max(150).optional().nullable(),
  contactPersonRole: z.string().max(150).optional().nullable(),
  contactPersonMobile: z.string().max(40).optional().nullable(),
  physicalAddress: z.string().max(1000).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  /** Replace semantics on PATCH — callers send the whole list, `[]` clears it. */
  reportRecipients: z.array(z.string().email()).max(20).optional(),
} as const;

type ContactFieldInput = {
  contactPersonName?: string | null;
  contactPersonRole?: string | null;
  contactPersonMobile?: string | null;
  physicalAddress?: string | null;
  notes?: string | null;
  reportRecipients?: string[];
};

function pickContactFields(data: ContactFieldInput) {
  return {
    ...(data.contactPersonName !== undefined ? { contactPersonName: data.contactPersonName } : {}),
    ...(data.contactPersonRole !== undefined ? { contactPersonRole: data.contactPersonRole } : {}),
    ...(data.contactPersonMobile !== undefined ? { contactPersonMobile: data.contactPersonMobile } : {}),
    ...(data.physicalAddress !== undefined ? { physicalAddress: data.physicalAddress } : {}),
    ...(data.notes !== undefined ? { notes: data.notes } : {}),
    ...(data.reportRecipients !== undefined ? { reportRecipients: data.reportRecipients } : {}),
  };
}

export async function clientsRoutes(app: FastifyInstance) {
  // `/clients` is the new home for client records; `/settings` and `/sites` stay accepted so
  // existing capability grants (which predate `/clients`) do not silently lose access.
  const clientViewProtect = [
    authMiddleware,
    requireAnyCapability(["/clients", "/settings", "/sites"], "view"),
  ];
  const clientCreateProtect = [authMiddleware, requireAnyCapability(["/clients", "/sites"], "create")];
  const clientEditProtect = [authMiddleware, requireAnyCapability(["/clients", "/sites"], "edit")];
  const clientExportProtect = [
    authMiddleware,
    requireAnyCapability(["/clients", ...SITE_TIMESHEET_MODULES], "export"),
  ];

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

  app.get("/:id", { preHandler: clientViewProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const client = await prisma.client.findFirst({
      where: { id, companyId: request.user!.companyId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        sites: {
          select: {
            id: true,
            name: true,
            siteStatus: true,
            monthlyRevenue: true,
            physicalAddress: true,
            serviceType: true,
            contractStartDate: true,
            contractEndDate: true,
            contactPersonName: true,
          },
          orderBy: { name: "asc" },
        },
      },
    });
    if (!client) {
      return reply.code(404).send({ error: "Not found", message: "Client not found" });
    }
    return reply.send({
      ...client,
      sites: client.sites.map((site) => ({
        ...site,
        monthlyRevenue: site.monthlyRevenue?.toString() ?? null,
      })),
    });
  });

  app.post("/", { preHandler: clientCreateProtect }, async (request, reply) => {
    const user = request.user!;
    const schema = z.object({
      name: z.string().min(1),
      email: z.string().email().optional().nullable(),
      phone: z.string().optional().nullable(),
      userId: z.string().optional().nullable(),
      ...billingFields,
      ...contactFields,
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
        ...pickBillingFields(parsed.data),
        ...pickContactFields(parsed.data),
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
      ...billingFields,
      ...contactFields,
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
        ...pickBillingFields(parsed.data),
        ...pickContactFields(parsed.data),
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

  /** Attach sites to a client in bulk. Only writes `Site.clientId`. */
  app.post("/:id/sites", { preHandler: clientEditProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const schema = z.object({ siteIds: z.array(z.string().min(1)).min(1).max(100) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      });
    }
    const client = await prisma.client.findFirst({ where: { id, companyId: user.companyId } });
    if (!client) {
      return reply.code(404).send({ error: "Not found", message: "Client not found" });
    }
    const siteIds = [...new Set(parsed.data.siteIds)];
    const sites = await prisma.site.findMany({
      where: { id: { in: siteIds }, companyId: user.companyId },
      select: { id: true },
    });
    if (sites.length !== siteIds.length) {
      return reply.code(400).send({
        error: "Validation error",
        message: "One or more sites do not belong to your company",
      });
    }
    await prisma.site.updateMany({
      where: { id: { in: siteIds }, companyId: user.companyId },
      data: { clientId: id },
    });
    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "client.sites.link",
      entityType: "Client",
      entityId: id,
      metadata: { siteIds },
    });
    const linked = await prisma.site.findMany({
      where: { clientId: id, companyId: user.companyId },
      select: { id: true, name: true, siteStatus: true },
      orderBy: { name: "asc" },
    });
    return reply.send({ data: linked });
  });

  app.delete("/:id/sites/:siteId", { preHandler: clientEditProtect }, async (request, reply) => {
    const user = request.user!;
    const { id, siteId } = request.params as { id: string; siteId: string };
    const site = await prisma.site.findFirst({
      where: { id: siteId, companyId: user.companyId, clientId: id },
      select: { id: true },
    });
    if (!site) {
      return reply
        .code(404)
        .send({ error: "Not found", message: "Site is not linked to this client" });
    }
    await prisma.site.update({ where: { id: siteId }, data: { clientId: null } });
    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "client.sites.unlink",
      entityType: "Client",
      entityId: id,
      metadata: { siteId },
    });
    return reply.send({ success: true });
  });

  await registerClientReportRoutes(app, clientViewProtect, clientExportProtect);
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
