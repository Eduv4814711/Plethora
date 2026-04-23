import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";

const schema = z.object({
  policyType: z.string().min(1),
  version: z.string().min(1),
  effectiveDate: z.string().optional().nullable(),
  nextReviewDate: z.string().optional().nullable(),
  approvedBy: z.string().optional().nullable(),
  filePath: z.string().optional().nullable(),
});
const patchSchema = schema.partial();

function parseDate(v?: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function academyPoliciesRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 100, 200);
    const offset = Number(q.offset) || 0;
    const where = { companyId, ...(q.policyType ? { policyType: q.policyType } : {}) };
    const [policies, total] = await Promise.all([
      prisma.academyPolicyDocument.findMany({ where, orderBy: [{ policyType: "asc" }, { version: "desc" }], take: limit, skip: offset }),
      prisma.academyPolicyDocument.count({ where }),
    ]);
    return { policies, total, limit, offset };
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const policy = await prisma.academyPolicyDocument.findFirst({ where: { id, companyId } });
    if (!policy) return reply.code(404).send({ error: "Not found", message: "Policy not found" });
    return { policy };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const d = parsed.data;
    const policy = await prisma.academyPolicyDocument.create({
      data: {
        companyId,
        policyType: d.policyType,
        version: d.version,
        effectiveDate: parseDate(d.effectiveDate),
        nextReviewDate: parseDate(d.nextReviewDate),
        approvedBy: d.approvedBy,
        filePath: d.filePath,
      },
    });
    await createAuditLog({ userId, companyId, action: "academy.policy.create", entityType: "AcademyPolicyDocument", entityId: policy.id });
    return reply.code(201).send({ policy });
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const exists = await prisma.academyPolicyDocument.findFirst({ where: { id, companyId } });
    if (!exists) return reply.code(404).send({ error: "Not found", message: "Policy not found" });
    const d = parsed.data;
    const policy = await prisma.academyPolicyDocument.update({ where: { id }, data: { ...d, effectiveDate: d.effectiveDate === undefined ? undefined : parseDate(d.effectiveDate), nextReviewDate: d.nextReviewDate === undefined ? undefined : parseDate(d.nextReviewDate) } });
    await createAuditLog({ userId, companyId, action: "academy.policy.update", entityType: "AcademyPolicyDocument", entityId: id });
    return { policy };
  });

  app.delete("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const exists = await prisma.academyPolicyDocument.findFirst({ where: { id, companyId } });
    if (!exists) return reply.code(404).send({ error: "Not found", message: "Policy not found" });
    await prisma.academyPolicyDocument.delete({ where: { id } });
    await createAuditLog({ userId, companyId, action: "academy.policy.delete", entityType: "AcademyPolicyDocument", entityId: id });
    return reply.code(204).send();
  });
}
