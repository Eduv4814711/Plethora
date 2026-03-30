import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { prisma } from "../../lib/prisma.js";

export async function messagesRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireRole(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"], {
      module: "/whatsapp",
    }),
  ];

  app.get("/messages", { preHandler: protect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const employeeId = q.employeeId;
    const limit = Math.min(Number(q.limit) || 50, 100);
    const before = q.before ? new Date(q.before) : undefined;

    if (!employeeId) {
      return reply.code(400).send({ error: "employeeId is required" });
    }

    // Validate employee belongs to company
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true },
    });

    if (!employee) {
      return reply.code(404).send({ error: "Employee not found" });
    }

    const where =
      before && !Number.isNaN(before.getTime())
        ? { companyId, employeeId, createdAt: { lt: before } }
        : { companyId, employeeId };

    const items = await prisma.whatsAppMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, limit) : items;

    return reply.send({
      data: data.map((m) => ({
        id: m.id,
        employeeId: m.employeeId,
        direction: m.direction,
        type: m.type,
        text: m.text,
        status: m.status,
        sentByUserId: m.sentByUserId,
        createdAt: m.createdAt.toISOString(),
      })),
      hasMore,
    });
  });
}
