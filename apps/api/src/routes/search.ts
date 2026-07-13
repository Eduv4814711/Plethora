import type { FastifyInstance } from "fastify";
import { authProtect } from "../middleware/auth-protect.js";
import { requireRole } from "../middleware/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { hasPermission } from "../services/user-access.service.js";
import { prisma } from "../lib/prisma.js";

export async function searchRoutes(app: FastifyInstance) {
  const protect = [
    ...authProtect,
    requireRole(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"], {
      anyOfModules: ["/employees", "/sites", "/tasks"],
    }),
  ];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const query = (q.q ?? q.search ?? "").trim();

    if (!query || query.length < 2) {
      return reply.send({ employees: [], sites: [] });
    }

    const canSearchId = hasPermission(request.access, PERMISSIONS.EMPLOYEES_READ_PRIVATE);
    const employeeOr = [
      { firstName: { contains: query, mode: "insensitive" as const } },
      { lastName: { contains: query, mode: "insensitive" as const } },
      { employeeNumber: { contains: query, mode: "insensitive" as const } },
      { psiraNumber: { contains: query, mode: "insensitive" as const } },
      ...(canSearchId ? [{ idNumber: { contains: query, mode: "insensitive" as const } }] : []),
    ];

    const [employees, sites] = await Promise.all([
      prisma.employee.findMany({
        where: { companyId: user.companyId, OR: employeeOr },
        select: {
          id: true,
          employeeNumber: true,
          firstName: true,
          lastName: true,
          status: true,
        },
        take: 8,
        orderBy: { lastName: "asc" },
      }),
      prisma.site.findMany({
        where: {
          companyId: user.companyId,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { location: { contains: query, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, location: true },
        take: 5,
        orderBy: { name: "asc" },
      }),
    ]);

    return reply.send({ employees, sites });
  });
}
