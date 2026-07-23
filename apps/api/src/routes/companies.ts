import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const updateCompanySchema = z.object({
  name: z.string().min(1),
});

export async function companiesRoutes(app: FastifyInstance) {
  const settingsViewProtect = [authMiddleware, requireCapability("/settings", "view")];
  const settingsEditProtect = [authMiddleware, requireCapability("/settings", "edit")];
  const publicCompanySelect = { id: true, name: true, createdAt: true, updatedAt: true } as const;

  // Only return the caller's company (tenant isolation; no cross-company bypass)
  app.get("/", { preHandler: settingsViewProtect }, async (request, reply) => {
    const user = request.user!;
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: publicCompanySelect,
    });
    if (!company) {
      return reply.code(404).send({ error: "Company not found" });
    }
    return reply.send({ data: [company], total: 1, limit: 1, offset: 0 });
  });

  // Only allow access to the caller's company
  app.get("/:id", { preHandler: settingsViewProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    if (id !== user.companyId) {
      return reply.code(403).send({ error: "Forbidden", message: "You can only access your own company." });
    }
    const company = await prisma.company.findUnique({
      where: { id },
      select: publicCompanySelect,
    });
    if (!company) {
      return reply.code(404).send({ error: "Company not found" });
    }
    return reply.send(company);
  });

  // Company rename is controlled by the explicit settings edit capability.
  app.put("/:id", { preHandler: settingsEditProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    if (id !== user.companyId) {
      return reply.code(403).send({ error: "Forbidden", message: "You can only update your own company." });
    }
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
      userId: user.sub,
      companyId: company.id,
      action: "company.update",
      entityType: "company",
      entityId: id,
    });
    return reply.send(company);
  });
}
