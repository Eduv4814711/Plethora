import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const createPublicHolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  name: z.string().optional(),
});

function parseStrictUtcDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

export async function publicHolidaysRoutes(app: FastifyInstance) {
  const readProtect = [
    authMiddleware,
    requireCrudCapability({
      anyOfModules: ["/settings", "/attendance", "/rostering", "/payroll-exports"],
    }),
  ];
  const writeProtect = [
    authMiddleware,
    requireCrudCapability({
      anyOfModules: ["/settings", "/attendance"],
    }),
  ];

  app.get("/", { preHandler: readProtect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const year = q.year ? parseInt(q.year, 10) : new Date().getUTCFullYear();
    if (!Number.isInteger(year) || year < 1970 || year > 2100) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid year" });
    }

    const startOfYear = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const endOfYear = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const holidays = await prisma.publicHoliday.findMany({
      where: {
        companyId: user.companyId,
        date: { gte: startOfYear, lte: endOfYear },
      },
      orderBy: { date: "asc" },
    });
    return reply.send({ data: holidays });
  });

  app.post("/", { preHandler: writeProtect }, async (request, reply) => {
    const parsed = createPublicHolidaySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const date = parseStrictUtcDate(parsed.data.date);
    if (!date) {
      return reply.code(400).send({
        error: "Validation error",
        message: "Invalid calendar date",
      });
    }

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

  app.delete("/:id", { preHandler: writeProtect }, async (request, reply) => {
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
