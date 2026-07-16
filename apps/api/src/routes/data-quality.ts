import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authProtect } from "../middleware/auth-protect.js";
import { requirePermission } from "../middleware/permissions.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { createApprovalRequest } from "../modules/approvals/approvals.service.js";
import { createAuditLog, auditContextFromRequest } from "../lib/audit.js";
import { scanDataQuality } from "../services/data-quality.service.js";

const reviewSchema = z.object({
  reason: z.string().min(5).max(2000),
  proposedResolution: z.record(z.unknown()),
  approverId: z.string().min(1).optional(),
});

export async function dataQualityRoutes(app: FastifyInstance) {
  app.post("/scan", { preHandler: [...authProtect, requirePermission(PERMISSIONS.DATA_QUALITY_MANAGE)] }, async (request, reply) => {
    const result = await scanDataQuality(request.user!.companyId);
    await createAuditLog({ ...auditContextFromRequest(request), userId: request.user!.sub, companyId: request.user!.companyId, action: "data_quality.scan", entityType: "DataQualityIssue", metadata: result });
    return reply.send(result);
  });

  app.get("/", { preHandler: [...authProtect, requirePermission(PERMISSIONS.DATA_QUALITY_READ)] }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 100, 200);
    const where = { companyId: request.user!.companyId, ...(q.status ? { status: q.status as never } : {}), ...(q.severity ? { severity: q.severity as never } : {}) };
    const [data, total] = await Promise.all([
      prisma.dataQualityIssue.findMany({ where, orderBy: [{ severity: "asc" }, { createdAt: "desc" }], take: limit }),
      prisma.dataQualityIssue.count({ where }),
    ]);
    return reply.send({ data, total });
  });

  app.post("/:id/resolution-requests", { preHandler: [...authProtect, requirePermission(PERMISSIONS.DATA_QUALITY_MANAGE)] }, async (request, reply) => {
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const issue = await prisma.dataQualityIssue.findFirst({ where: { id: (request.params as { id: string }).id, companyId: request.user!.companyId } });
    if (!issue) return reply.code(404).send({ error: "Data quality issue not found" });
    const approval = await createApprovalRequest({
      companyId: request.user!.companyId,
      approvalType: "DATA_QUALITY_RESOLUTION",
      entityType: "DataQualityIssue",
      entityId: issue.id,
      requestedById: request.user!.sub,
      approverId: parsed.data.approverId,
      reason: parsed.data.reason,
      riskLevel: issue.severity,
      payload: { proposedResolution: parsed.data.proposedResolution },
    });
    await prisma.dataQualityIssue.update({ where: { id: issue.id }, data: { status: "UNDER_REVIEW", proposedResolution: parsed.data.proposedResolution as object, reviewedById: request.user!.sub, reviewReason: parsed.data.reason } });
    return reply.code(202).send({ approval, message: "Resolution submitted for independent review" });
  });
}
