import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";

export async function searchRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({
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

    const [employees, sites] = await Promise.all([
      prisma.employee.findMany({
        where: {
          companyId: user.companyId,
          OR: [
            { firstName: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
            { employeeNumber: { contains: query, mode: "insensitive" } },
            { idNumber: { contains: query, mode: "insensitive" } },
          ],
        },
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
        select: {
          id: true,
          name: true,
          location: true,
        },
        take: 5,
        orderBy: { name: "asc" },
      }),
    ]);

    return reply.send({ employees, sites });
  });
}
