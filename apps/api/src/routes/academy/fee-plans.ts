import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";

const createFeePlanSchema = z.object({
  name: z.string().min(1),
  notes: z.string().optional().nullable(),
});

const updateFeePlanSchema = createFeePlanSchema.partial();

export async function academyFeePlansRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const feePlans = await prisma.feePlan.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
    });
    return { feePlans };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const body = createFeePlanSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const feePlan = await prisma.feePlan.create({
      data: { companyId, name: body.data.name, notes: body.data.notes ?? undefined },
    });
    await createAuditLog({
      userId,
      companyId,
      action: "academy.fee_plan.create",
      entityType: "FeePlan",
      entityId: feePlan.id,
      metadata: { name: feePlan.name },
    });
    return reply.code(201).send({ feePlan });
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const body = updateFeePlanSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const existing = await prisma.feePlan.findFirst({ where: { id, companyId } });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Fee plan not found" });
    }
    const feePlan = await prisma.feePlan.update({
      where: { id },
      data: body.data,
    });
    await createAuditLog({
      userId,
      companyId,
      action: "academy.fee_plan.update",
      entityType: "FeePlan",
      entityId: feePlan.id,
      metadata: body.data as Record<string, unknown>,
    });
    return { feePlan };
  });
}
