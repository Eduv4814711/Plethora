import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { prisma } from "../../lib/prisma.js";

export async function contactsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireRole(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"]),
  ];

  app.get("/contacts", { preHandler: protect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 100);
    const offset = Number(q.offset) || 0;

    const [contacts, total] = await Promise.all([
      prisma.employee.findMany({
        where: { companyId, status: "active", phone: { not: null } },
        select: { id: true, firstName: true, lastName: true, phone: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: limit,
        skip: offset,
      }),
      prisma.employee.count({
        where: { companyId, status: "active", phone: { not: null } },
      }),
    ]);

    const data = contacts.map((e) => ({
      id: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      phone: e.phone,
      whatsappUrl: e.phone ? `https://wa.me/${e.phone.replace(/\D/g, "")}` : null,
    }));

    return reply.send({ data, total, limit, offset });
  });
}
