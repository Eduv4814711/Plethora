import type { FastifyInstance } from "fastify";
import { authProtect } from "../middleware/auth-protect.js";
import { requirePermission } from "../middleware/permissions.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { hasPermission } from "../services/user-access.service.js";
import { prisma } from "../lib/prisma.js";

const SENSITIVE_AUDIT_ACTIONS = new Set([
  "employee.private.view",
  "employee.private.update",
  "employee.compensation.view",
  "employee.compensation.update",
  "payroll.items.view",
  "payslip.view",
  "payslip.download",
  "payroll.export",
  "document.confidential.view",
  "document.confidential.download",
  "sick_note.view",
  "permission.sensitive.grant",
  "permission.sensitive.revoke",
]);

function redactAuditMetadata(action: string, metadata: unknown, canReadSensitive: boolean) {
  if (canReadSensitive || !SENSITIVE_AUDIT_ACTIONS.has(action)) return metadata;
  return metadata ? { redacted: true } : null;
}

export async function auditRoutes(app: FastifyInstance) {
  app.get("/", {
    preHandler: [...authProtect, requirePermission(PERMISSIONS.AUDIT_READ)],
  }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const entityType = q.entityType;
    const entityId = q.entityId;
    const limit = Math.min(Number(q.limit) || 50, 100);
    const offset = Number(q.offset) || 0;
    const canReadSensitive = hasPermission(request.access, PERMISSIONS.AUDIT_READ_SENSITIVE);

    const where = {
      companyId: user.companyId,
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(!canReadSensitive ? { action: { notIn: [...SENSITIVE_AUDIT_ACTIONS] } } : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        take: limit,
        skip: offset,
        orderBy: { timestamp: "desc" },
      }),
      prisma.auditLog.count({ where }),
    ]);

    const data = logs.map((log) => ({
      ...log,
      metadata: redactAuditMetadata(log.action, log.metadata, canReadSensitive),
    }));

    return reply.send({ data, total, limit, offset });
  });
}
