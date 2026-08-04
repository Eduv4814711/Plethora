import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { auditFromRequest } from "../lib/audit.js";
import { toCsv } from "../lib/csv.js";

const MAX_PAGE = 200;
const MAX_EXPORT_ROWS = 10000;

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function buildWhere(companyId: string, q: Record<string, string | undefined>): Prisma.AuditLogWhereInput {
  const from = parseDate(q.from);
  const to = parseDate(q.to);
  const search = q.search?.trim();

  return {
    companyId,
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.outcome ? { outcome: q.outcome } : {}),
    // Action is a dotted namespace ("auth.login", "user.access.update"), so a
    // prefix filter lets the UI ask for a whole family at once.
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(from || to
      ? { timestamp: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
    ...(search
      ? {
          OR: [
            { entityId: { contains: search, mode: "insensitive" as const } },
            { action: { contains: search, mode: "insensitive" as const } },
            { actorLabel: { contains: search, mode: "insensitive" as const } },
            { user: { name: { contains: search, mode: "insensitive" as const } } },
            { user: { email: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

const rowSelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  outcome: true,
  ipAddress: true,
  userAgent: true,
  requestId: true,
  actorLabel: true,
  timestamp: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

export async function auditRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireCapability("/audit", "view")];
  const exportProtect = [authMiddleware, requireCapability("/audit", "export")];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), MAX_PAGE);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const where = buildWhere(request.user!.companyId, q);

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        select: rowSelect,
        take: limit,
        skip: offset,
        orderBy: { timestamp: "desc" },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return reply.send({ data: logs, total, limit, offset });
  });

  /** Distinct actors and actions in this company's trail, to populate the filters. */
  app.get("/filters", { preHandler: protect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const [actors, actions] = await Promise.all([
      prisma.user.findMany({
        where: { companyId, auditLogs: { some: {} } },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      }),
      prisma.auditLog.groupBy({
        by: ["action"],
        where: { companyId },
        _count: { action: true },
        orderBy: { action: "asc" },
      }),
    ]);
    return reply.send({
      actors,
      actions: actions.map((row) => ({ action: row.action, count: row._count.action })),
    });
  });

  app.get("/export.csv", { preHandler: exportProtect }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const where = buildWhere(request.user!.companyId, q);

    const logs = await prisma.auditLog.findMany({
      where,
      select: rowSelect,
      take: MAX_EXPORT_ROWS,
      orderBy: { timestamp: "desc" },
    });

    const csv = toCsv(
      [
        "Timestamp",
        "Actor",
        "Actor email",
        "Action",
        "Outcome",
        "Entity type",
        "Entity id",
        "IP address",
        "User agent",
        "Request id",
        "Details",
      ],
      logs.map((log) => [
        log.timestamp.toISOString(),
        log.user?.name ?? log.actorLabel ?? "",
        log.user?.email ?? "",
        log.action,
        log.outcome,
        log.entityType,
        log.entityId ?? "",
        log.ipAddress ?? "",
        log.userAgent ?? "",
        log.requestId ?? "",
        log.metadata ? JSON.stringify(log.metadata) : "",
      ])
    );

    // Exporting the audit trail is itself an auditable act.
    await auditFromRequest(request, {
      action: "audit.export",
      entityType: "audit_log",
      metadata: { rowCount: logs.length, filters: q, truncated: logs.length === MAX_EXPORT_ROWS },
    });

    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`
      )
      .send(csv);
  });
}
