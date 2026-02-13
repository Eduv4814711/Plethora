import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const createCompanySchema = z.object({
  name: z.string().min(1),
});

const updateCompanySchema = z.object({
  name: z.string().min(1),
});

export async function companiesRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireAdmin()];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 100);
    const offset = Number(q.offset) || 0;

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        take: limit,
        skip: offset,
        orderBy: { name: "asc" },
      }),
      prisma.company.count(),
    ]);

    return reply.send({ data: companies, total, limit, offset });
  });

  app.get("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const company = await prisma.company.findUnique({
      where: { id },
    });

    if (!company) {
      return reply.code(404).send({ error: "Company not found" });
    }

    return reply.send(company);
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createCompanySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const company = await prisma.company.create({
      data: { name: parsed.data.name },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId: company.id,
      action: "company.create",
      entityType: "company",
      entityId: company.id,
    });

    return reply.code(201).send(company);
  });

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateCompanySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const company = await prisma.company.update({
      where: { id },
      data: { name: parsed.data.name },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId: company.id,
      action: "company.update",
      entityType: "company",
      entityId: id,
    });

    return reply.send(company);
  });
}
