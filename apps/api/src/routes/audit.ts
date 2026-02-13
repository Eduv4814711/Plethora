import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";

export async function auditRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin"])];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const entityType = request.query.entityType as string | undefined;
    const entityId = request.query.entityId as string | undefined;
    const limit = Math.min(Number(request.query.limit) || 50, 100);
    const offset = Number(request.query.offset) || 0;

    const where = {
      companyId: user.companyId,
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
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

    return reply.send({ data: logs, total, limit, offset });
  });
}
