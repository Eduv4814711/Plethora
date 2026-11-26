import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCrudCapability } from "../../middleware/authorization.js";
import { prisma } from "../../lib/prisma.js";
import { formatPhoneForWaMe } from "../../lib/phone.js";

export async function contactsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({
      module: "/whatsapp",
    }),
  ];

  app.get("/contacts", { preHandler: protect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 100);
    const offset = Number(q.offset) || 0;
    const search = q.search?.trim();

    const where: Prisma.EmployeeWhereInput = {
      companyId,
      status: "active",
      phone: { not: null },
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { jobRole: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [contacts, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          jobRole: true,
          employeeType: true,
          whatsappMessages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              text: true,
              direction: true,
              createdAt: true,
            },
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: limit,
        skip: offset,
      }),
      prisma.employee.count({ where }),
    ]);

    const mapped = contacts.map((e) => {
      const lastMsg = (
        e as typeof e & {
          whatsappMessages?: Array<{
            text: string | null;
            direction: string;
            createdAt: Date | string;
          }>;
        }
      ).whatsappMessages?.[0];

      return {
        id: e.id,
        firstName: e.firstName,
        lastName: e.lastName,
        phone: e.phone,
        whatsappUrl: formatPhoneForWaMe(e.phone),
        jobRole: (e as { jobRole?: string | null }).jobRole ?? null,
        employeeType: (e as { employeeType?: string | null }).employeeType ?? null,
        lastMessageText: lastMsg?.text ?? null,
        lastMessageDirection:
          lastMsg?.direction === "inbound" || lastMsg?.direction === "outbound"
            ? lastMsg.direction
            : null,
        lastMessageAt: lastMsg?.createdAt ? new Date(lastMsg.createdAt).toISOString() : null,
      };
    });

    mapped.sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt) {
        return b.lastMessageAt.localeCompare(a.lastMessageAt);
      }
      if (a.lastMessageAt) return -1;
      if (b.lastMessageAt) return 1;
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    });

    return reply.send({ data: mapped, total, limit, offset });
  });
}
