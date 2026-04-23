import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";

const schema = z.object({
  learnerId: z.string().min(1),
  courseId: z.string().min(1),
  instructorId: z.string().optional().nullable(),
  assessmentType: z.string().min(1),
  assessmentDate: z.string().min(1),
  venue: z.string().optional().nullable(),
  attemptNumber: z.number().int().min(1).optional(),
  mark: z.union([z.number(), z.string()]).optional(),
  result: z.enum(["pass", "fail", "competent", "not_yet_competent"]).optional().nullable(),
  moderationStatus: z.string().optional().nullable(),
  reassessmentDate: z.string().optional().nullable(),
});

const patchSchema = schema.partial();

function parseDate(v?: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function academyAssessmentsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 100, 200);
    const offset = Number(q.offset) || 0;
    const where = {
      companyId,
      ...(q.learnerId ? { learnerId: q.learnerId } : {}),
      ...(q.courseId ? { courseId: q.courseId } : {}),
      ...(q.result ? { result: q.result as "pass" | "fail" | "competent" | "not_yet_competent" } : {}),
    };
    const [assessments, total] = await Promise.all([
      prisma.academyAssessment.findMany({ where, include: { learner: true, course: true, instructor: true }, orderBy: { assessmentDate: "desc" }, take: limit, skip: offset }),
      prisma.academyAssessment.count({ where }),
    ]);
    return { assessments, total, limit, offset };
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const assessment = await prisma.academyAssessment.findFirst({ where: { id, companyId }, include: { learner: true, course: true, instructor: true } });
    if (!assessment) return reply.code(404).send({ error: "Not found", message: "Assessment not found" });
    return { assessment };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const d = parsed.data;
    const assessment = await prisma.academyAssessment.create({
      data: {
        companyId,
        learnerId: d.learnerId,
        courseId: d.courseId,
        instructorId: d.instructorId,
        assessmentType: d.assessmentType,
        assessmentDate: new Date(d.assessmentDate),
        venue: d.venue,
        attemptNumber: d.attemptNumber ?? 1,
        mark: d.mark == null ? undefined : String(d.mark),
        result: d.result ?? undefined,
        moderationStatus: d.moderationStatus,
        reassessmentDate: parseDate(d.reassessmentDate),
      },
    });
    await createAuditLog({ userId, companyId, action: "academy.assessment.create", entityType: "AcademyAssessment", entityId: assessment.id });
    return reply.code(201).send({ assessment });
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const exists = await prisma.academyAssessment.findFirst({ where: { id, companyId } });
    if (!exists) return reply.code(404).send({ error: "Not found", message: "Assessment not found" });
    const d = parsed.data;
    const assessment = await prisma.academyAssessment.update({
      where: { id },
      data: {
        ...d,
        assessmentDate: d.assessmentDate ? new Date(d.assessmentDate) : undefined,
        reassessmentDate: parseDate(d.reassessmentDate),
        mark: d.mark == null ? undefined : String(d.mark),
      },
    });
    await createAuditLog({ userId, companyId, action: "academy.assessment.update", entityType: "AcademyAssessment", entityId: assessment.id });
    return { assessment };
  });

  app.delete("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const exists = await prisma.academyAssessment.findFirst({ where: { id, companyId } });
    if (!exists) return reply.code(404).send({ error: "Not found", message: "Assessment not found" });
    await prisma.academyAssessment.delete({ where: { id } });
    await createAuditLog({ userId, companyId, action: "academy.assessment.delete", entityType: "AcademyAssessment", entityId: id });
    return reply.code(204).send();
  });
}
