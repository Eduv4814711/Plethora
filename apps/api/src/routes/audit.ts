import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { authProtect } from "../middleware/auth-protect.js";
import { requirePermission } from "../middleware/permissions.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { hasPermission } from "../services/user-access.service.js";
import { prisma } from "../lib/prisma.js";

const SENSITIVE_AUDIT_ACTIONS = new Set([
  "employee.private.view", "employee.private.update", "employee.compensation.view",
  "employee.compensation.update", "payroll.items.view", "payslip.view", "payslip.download",
  "payroll.export", "document.confidential.view", "document.confidential.download",
  "sick_note.view", "permission.sensitive.grant", "permission.sensitive.revoke",
  "access.permissions.changed",
]);

const ACTION_LABELS: Record<string, string> = {
  "access.permissions.changed": "User access changed",
  "authorization.denied": "Access denied",
  "approval.request": "Approval requested",
  "approval.approve": "Approval approved",
  "approval.reject": "Approval rejected",
  "approval.query": "Approval query raised",
  "payroll_run.approve": "Payroll approved",
  "roster.publish": "Roster published",
  "site_timesheet.approve": "Site timesheet approved",
  "settings.factory_reset": "Factory reset performed",
  "user.create": "User account created",
  "user.update": "User account updated",
  "user.delete": "User account deleted",
};

function humanizeAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function redactMetadata(action: string, metadata: unknown, canReadSensitive: boolean) {
  if (canReadSensitive || !SENSITIVE_AUDIT_ACTIONS.has(action)) return metadata;
  return metadata ? { redacted: true } : null;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function queryWhere(companyId: string, q: Record<string, string | undefined>, canReadSensitive: boolean): Prisma.AuditLogWhereInput {
  const start = q.startDate ? new Date(q.startDate) : undefined;
  const end = q.endDate ? new Date(q.endDate) : undefined;
  return {
    companyId,
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.riskLevel ? { riskLevel: q.riskLevel } : {}),
    ...(q.result ? { result: q.result } : {}),
    ...((start && !Number.isNaN(start.getTime())) || (end && !Number.isNaN(end.getTime()))
      ? { timestamp: { ...(start && !Number.isNaN(start.getTime()) ? { gte: start } : {}), ...(end && !Number.isNaN(end.getTime()) ? { lte: end } : {}) } }
      : {}),
    ...(!canReadSensitive ? { action: { notIn: [...SENSITIVE_AUDIT_ACTIONS] } } : {}),
    ...(q.search ? {
      OR: [
        { action: { contains: q.search, mode: "insensitive" } },
        { entityType: { contains: q.search, mode: "insensitive" } },
        { reason: { contains: q.search, mode: "insensitive" } },
        { user: { name: { contains: q.search, mode: "insensitive" } } },
      ],
    } : {}),
  };
}

function present(log: Record<string, unknown>, canReadSensitive: boolean) {
  const action = String(log.action);
  return {
    ...log,
    actionLabel: humanizeAction(action),
    metadata: redactMetadata(action, log.metadata, canReadSensitive),
    beforeState: redactMetadata(action, log.beforeState, canReadSensitive),
    afterState: redactMetadata(action, log.afterState, canReadSensitive),
    integrityProtected: typeof log.eventHash === "string" && log.eventHash.length > 0,
  };
}

export async function auditRoutes(app: FastifyInstance) {
  const readProtect = [...authProtect, requirePermission(PERMISSIONS.AUDIT_READ)];

  app.get("/export", {
    preHandler: [...authProtect, requirePermission(PERMISSIONS.AUDIT_EXPORT)],
  }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const canReadSensitive = hasPermission(request.access, PERMISSIONS.AUDIT_READ_SENSITIVE);
    const logs = await prisma.auditLog.findMany({
      where: queryWhere(user.companyId, q, canReadSensitive),
      include: { user: { select: { name: true, email: true } } },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: Math.min(Number(q.limit) || 10_000, 25_000),
    });
    if (q.format === "json") return reply.send({ exportedAt: new Date().toISOString(), data: logs.map((log) => present(log as unknown as Record<string, unknown>, canReadSensitive)) });
    const header = ["Date and time", "User", "Action", "Record type", "Record ID", "Result", "Risk", "Reason", "Request ID", "Integrity hash"];
    const rows = logs.map((log) => [log.timestamp.toISOString(), log.user?.name ?? "System", humanizeAction(log.action), log.entityType, log.entityId, log.result, log.riskLevel, log.reason, log.requestId, log.eventHash]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="plethora-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(csv);
  });

  app.get("/integrity", { preHandler: readProtect }, async (request, reply) => {
    const logs = await prisma.auditLog.findMany({
      where: { companyId: request.user!.companyId, eventHash: { not: null } },
      select: { id: true, previousHash: true, eventHash: true, timestamp: true },
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    });
    const brokenLinks: string[] = [];
    let previousHash: string | null = null;
    for (const log of logs) {
      if (log.previousHash !== previousHash) brokenLinks.push(log.id);
      previousHash = log.eventHash;
    }
    return reply.send({ protectedEvents: logs.length, valid: brokenLinks.length === 0, brokenLinks });
  });

  app.get("/", { preHandler: readProtect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const canReadSensitive = hasPermission(request.access, PERMISSIONS.AUDIT_READ_SENSITIVE);
    const where = queryWhere(user.companyId, q, canReadSensitive);
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        take: limit,
        skip: offset,
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      }),
      prisma.auditLog.count({ where }),
    ]);
    return reply.send({ data: logs.map((log) => present(log as unknown as Record<string, unknown>, canReadSensitive)), total, limit, offset });
  });
}
