import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authProtect } from "../middleware/auth-protect.js";
import { requireSystemOwner, canViewSensitiveCompanyFields } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const updateCompanySchema = z.object({
  name: z.string().min(1),
});

const SENSITIVE_COMPANY_KEYS = [
  "taxNumber",
  "uifReference",
  "payeReference",
  "sdlReference",
  "sdlLiableFrom",
  "monthlyPayrollTotals",
] as const;

function redactCompany(company: Record<string, unknown>, canViewSensitive: boolean) {
  if (canViewSensitive) return company;
  const out = { ...company };
  for (const key of SENSITIVE_COMPANY_KEYS) {
    delete out[key];
  }
  return out;
}

export async function companiesRoutes(app: FastifyInstance) {
  const protect = [...authProtect];
  const adminProtect = [...authProtect, requireSystemOwner()];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
    });
    if (!company) {
      return reply.code(404).send({ error: "Company not found" });
    }
    const safe = redactCompany(
      company as unknown as Record<string, unknown>,
      canViewSensitiveCompanyFields(request.access)
    );
    return reply.send({ data: [safe], total: 1, limit: 1, offset: 0 });
  });

  app.get("/:id", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    if (id !== user.companyId) {
      return reply.code(403).send({ error: "Forbidden", message: "You can only access your own company." });
    }
    const company = await prisma.company.findUnique({
      where: { id },
    });
    if (!company) {
      return reply.code(404).send({ error: "Company not found" });
    }
    return reply.send(
      redactCompany(
        company as unknown as Record<string, unknown>,
        canViewSensitiveCompanyFields(request.access)
      )
    );
  });

  app.post("/", { preHandler: protect }, async (_request, reply) => {
    return reply.code(403).send({
      error: "Forbidden",
      message: "New companies are created via the sign-up page. Use the Register link on the login page.",
    });
  });

  app.put("/:id", { preHandler: adminProtect }, async (request, reply) => {
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
