import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { hasCapability } from "../lib/capabilities.js";

export async function searchRoutes(app: FastifyInstance) {
  // Global search legitimately spans modules, so the route guard is the union.
  // Each result set is then filtered by its own module capability below, so a
  // user with only /tasks never sees employee or site records here.
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

    const canSearchEmployees = hasCapability(user, "/employees", "view");
    const canSearchSites = hasCapability(user, "/sites", "view");
    // ID numbers are restricted data; only match on them for users who may see them.
    const canMatchIdNumber = hasCapability(user, "/employees", "view_sensitive");

    const [employees, sites] = await Promise.all([
      canSearchEmployees
        ? prisma.employee.findMany({
            where: {
              companyId: user.companyId,
              OR: [
                { firstName: { contains: query, mode: "insensitive" } },
                { lastName: { contains: query, mode: "insensitive" } },
                { employeeNumber: { contains: query, mode: "insensitive" } },
                ...(canMatchIdNumber
                  ? [{ idNumber: { contains: query, mode: "insensitive" as const } }]
                  : []),
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
          })
        : Promise.resolve([]),
      canSearchSites
        ? prisma.site.findMany({
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
          })
        : Promise.resolve([]),
    ]);

    return reply.send({ employees, sites });
  });
}
