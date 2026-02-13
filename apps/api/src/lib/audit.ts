import { prisma } from "./prisma.js";

export async function createAuditLog(params: {
  userId?: string;
  companyId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      companyId: params.companyId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: (params.metadata ?? undefined) as object | undefined,
    },
  });
}
