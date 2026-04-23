import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";

const createBranchSchema = z.object({
  name: z.string().min(1),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  province: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
});

const updateBranchSchema = createBranchSchema.partial();

export async function academyBranchesRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const branches = await prisma.academyBranch.findMany({
      where: { companyId },
      orderBy: { name: "asc" },
    });
    return { branches };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const body = createBranchSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const branch = await prisma.academyBranch.create({
      data: { companyId, ...body.data },
    });
    await createAuditLog({
      userId,
      companyId,
      action: "academy.branch.create",
      entityType: "AcademyBranch",
      entityId: branch.id,
      metadata: { name: branch.name },
    });
    return reply.code(201).send({ branch });
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const branch = await prisma.academyBranch.findFirst({
      where: { id, companyId },
    });
    if (!branch) {
      return reply.code(404).send({ error: "Not found", message: "Branch not found" });
    }
    return { branch };
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const body = updateBranchSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const existing = await prisma.academyBranch.findFirst({ where: { id, companyId } });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Branch not found" });
    }
    const branch = await prisma.academyBranch.update({
      where: { id },
      data: body.data,
    });
    await createAuditLog({
      userId,
      companyId,
      action: "academy.branch.update",
      entityType: "AcademyBranch",
      entityId: branch.id,
      metadata: body.data as Record<string, unknown>,
    });
    return { branch };
  });

  app.delete("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const existing = await prisma.academyBranch.findFirst({ where: { id, companyId } });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Branch not found" });
    }
    const runCount = await prisma.courseRun.count({
      where: { academyBranchId: id, companyId },
    });
    if (runCount > 0) {
      return reply.code(409).send({
        error: "Conflict",
        message: "Cannot delete a branch that has course runs. Reassign or remove runs first.",
      });
    }
    await prisma.academyBranch.delete({ where: { id } });
    await createAuditLog({
      userId,
      companyId,
      action: "academy.branch.delete",
      entityType: "AcademyBranch",
      entityId: id,
      metadata: { name: existing.name },
    });
    return reply.code(204).send();
  });
}
