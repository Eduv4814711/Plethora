import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";

const createSchema = z.object({
  academyBranchId: z.string().trim().min(1, "academyBranchId is required"),
  classroomName: z.string().trim().min(1, "classroomName is required"),
  capacity: z.number().int().min(0).optional(),
  approvedCapacity: z.number().int().min(0).optional().nullable(),
  equipmentChecklist: z.string().optional().nullable(),
  status: z.enum(["available", "in_use", "maintenance", "closed"]).optional(),
});
const updateSchema = createSchema.partial();

export async function academyClassroomsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 100, 200);
    const offset = Number(q.offset) || 0;
    const where = {
      companyId,
      ...(q.academyBranchId ? { academyBranchId: q.academyBranchId } : {}),
      ...(q.status ? { status: q.status as "available" | "in_use" | "maintenance" | "closed" } : {}),
    };
    const [classrooms, total] = await Promise.all([
      prisma.academyClassroom.findMany({ where, include: { branch: { select: { id: true, name: true } } }, orderBy: { classroomName: "asc" }, take: limit, skip: offset }),
      prisma.academyClassroom.count({ where }),
    ]);
    return { classrooms, total, limit, offset };
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const classroom = await prisma.academyClassroom.findFirst({ where: { id, companyId }, include: { branch: true } });
    if (!classroom) return reply.code(404).send({ error: "Not found", message: "Classroom not found" });
    return { classroom };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });

    const branch = await prisma.academyBranch.findFirst({
      where: { id: parsed.data.academyBranchId, companyId },
      select: { id: true },
    });
    if (!branch) {
      return reply.code(400).send({
        error: "Validation error",
        message: "academyBranchId not found in company",
        statusCode: 400,
      });
    }

    const row = await prisma.academyClassroom.create({ data: { companyId, ...parsed.data } });
    await createAuditLog({ userId, companyId, action: "academy.classroom.create", entityType: "AcademyClassroom", entityId: row.id });
    return reply.code(201).send({ classroom: row });
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const exists = await prisma.academyClassroom.findFirst({ where: { id, companyId } });
    if (!exists) return reply.code(404).send({ error: "Not found", message: "Classroom not found" });

    if (parsed.data.academyBranchId) {
      const branch = await prisma.academyBranch.findFirst({
        where: { id: parsed.data.academyBranchId, companyId },
        select: { id: true },
      });
      if (!branch) {
        return reply.code(400).send({
          error: "Validation error",
          message: "academyBranchId not found in company",
          statusCode: 400,
        });
      }
    }

    const classroom = await prisma.academyClassroom.update({ where: { id }, data: parsed.data });
    await createAuditLog({ userId, companyId, action: "academy.classroom.update", entityType: "AcademyClassroom", entityId: id });
    return { classroom };
  });

  app.delete("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const exists = await prisma.academyClassroom.findFirst({ where: { id, companyId } });
    if (!exists) return reply.code(404).send({ error: "Not found", message: "Classroom not found" });
    await prisma.academyClassroom.delete({ where: { id } });
    await createAuditLog({ userId, companyId, action: "academy.classroom.delete", entityType: "AcademyClassroom", entityId: id });
    return reply.code(204).send();
  });
}
