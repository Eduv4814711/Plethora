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
      anyOfModules: [
        "/employees",
        "/sites",
        "/clients",
        "/tasks",
        "/incidents",
        "/payroll/billing",
        "/payroll",
      ],
    }),
  ];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const query = (q.q ?? q.search ?? "").trim();

    if (!query || query.length < 2) {
      return reply.send({
        employees: [],
        sites: [],
        clients: [],
        tasks: [],
        incidents: [],
        invoices: [],
      });
    }

    const canSearchEmployees = hasCapability(user, "/employees", "view");
    const canSearchSites = hasCapability(user, "/sites", "view");
    const canSearchClients = hasCapability(user, "/clients", "view");
    const canSearchTasks = hasCapability(user, "/tasks", "view");
    const canSearchIncidents = hasCapability(user, "/incidents", "view");
    const canSearchInvoices =
      hasCapability(user, "/payroll/billing", "view") ||
      hasCapability(user, "/payroll", "view");
    // ID numbers are restricted data; only match on them for users who may see them.
    const canMatchIdNumber = hasCapability(user, "/employees", "view_sensitive");

    const [employees, sites, rawClients, tasks, incidents, rawInvoices] = await Promise.all([
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
      canSearchClients
        ? prisma.client.findMany({
            where: {
              companyId: user.companyId,
              isActive: true,
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { tradingName: { contains: query, mode: "insensitive" } },
                { contactPersonName: { contains: query, mode: "insensitive" } },
                { email: { contains: query, mode: "insensitive" } },
                { phone: { contains: query, mode: "insensitive" } },
              ],
            },
            select: {
              id: true,
              name: true,
              contactPersonName: true,
              phone: true,
            },
            take: 5,
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      canSearchTasks
        ? prisma.task.findMany({
            where: {
              companyId: user.companyId,
              OR: [
                { title: { contains: query, mode: "insensitive" } },
                { description: { contains: query, mode: "insensitive" } },
              ],
            },
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              dueDate: true,
            },
            take: 5,
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      canSearchIncidents
        ? prisma.incident.findMany({
            where: {
              companyId: user.companyId,
              OR: [
                { incidentNumber: { contains: query, mode: "insensitive" } },
                { title: { contains: query, mode: "insensitive" } },
                { description: { contains: query, mode: "insensitive" } },
              ],
            },
            select: {
              id: true,
              incidentNumber: true,
              title: true,
              incidentType: true,
              severity: true,
              status: true,
            },
            take: 5,
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      canSearchInvoices
        ? prisma.clientInvoice.findMany({
            where: {
              companyId: user.companyId,
              OR: [
                { invoiceNumber: { contains: query, mode: "insensitive" } },
                { reference: { contains: query, mode: "insensitive" } },
              ],
            },
            select: {
              id: true,
              invoiceNumber: true,
              totalAmount: true,
              status: true,
              dueDate: true,
              client: { select: { id: true, name: true } },
            },
            take: 5,
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
    ]);

    const clients = rawClients.map((c) => ({
      id: c.id,
      name: c.name,
      contactPerson: c.contactPersonName ?? null,
      phone: c.phone ?? null,
    }));

    const invoices = rawInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      totalAmount: Number(inv.totalAmount),
      status: inv.status,
      dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
      client: inv.client,
    }));

    return reply.send({
      employees,
      sites,
      clients,
      tasks,
      incidents,
      invoices,
    });
  });
}
