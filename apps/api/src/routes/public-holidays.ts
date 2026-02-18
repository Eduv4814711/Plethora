import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const createPublicHolidaySchema = z.object({
  date: z.string(),
  name: z.string().optional(),
});

export async function publicHolidaysRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "hr_payroll"])];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const year = q.year ? parseInt(q.year, 10) : new Date().getFullYear();

    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);

    const holidays = await prisma.publicHoliday.findMany({
      where: {
        companyId: user.companyId,
        date: { gte: startOfYear, lte: endOfYear },
      },
      orderBy: { date: "asc" },
    });
    return reply.send({ data: holidays });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createPublicHolidaySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const date = new Date(parsed.data.date);
    date.setHours(0, 0, 0, 0);

    const holiday = await prisma.publicHoliday.upsert({
      where: {
        companyId_date: { companyId, date },
      },
      create: {
        companyId,
        date,
        name: parsed.data.name ?? null,
      },
      update: { name: parsed.data.name ?? undefined },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "public_holiday.create",
      entityType: "public_holiday",
      entityId: holiday.id,
    });

    return reply.code(201).send(holiday);
  });

  app.delete("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.user!.companyId;

    const existing = await prisma.publicHoliday.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Public holiday not found" });
    }

    await prisma.publicHoliday.delete({ where: { id } });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "public_holiday.delete",
      entityType: "public_holiday",
      entityId: id,
    });

    return reply.code(204).send();
  });
}
