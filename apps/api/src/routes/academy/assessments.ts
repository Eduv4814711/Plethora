import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { academyProtect } from "./constants.js";
import * as assessmentService from "../../services/academy-assessment.service.js";
import { AcademyServiceError } from "../../services/academy-student.service.js";

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

function getForensics(req: FastifyRequest): assessmentService.AttendanceForensics {
  return {
    ipAddress: req.ip ?? null,
    userAgent: (req.headers["user-agent"] as string) ?? null,
    requestId: req.id ?? null,
  };
}

export async function academyAssessmentsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;

    return assessmentService.listAssessments(companyId, {
      learnerId: q.learnerId,
      courseId: q.courseId,
      result: q.result as "pass" | "fail" | "competent" | "not_yet_competent" | undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };

    const assessment = await assessmentService.getAssessmentById(companyId, id);
    if (!assessment) {
      return reply.code(404).send({
        error: "Not found",
        message: "Assessment not found",
        statusCode: 404,
      });
    }

    return { assessment };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      const firstError =
        Object.values(flattened.fieldErrors).flat()[0] ||
        flattened.formErrors[0] ||
        "Validation failed";
      return reply.code(400).send({
        error: "Validation error",
        message: firstError,
        statusCode: 400,
        details: flattened,
      });
    }

    try {
      const { assessment } = await assessmentService.recordAssessment(
        companyId,
        userId,
        parsed.data,
        getForensics(request)
      );
      return reply.code(201).send({ assessment });
    } catch (err) {
      if (err instanceof AcademyServiceError) {
        return reply.code(err.statusCode).send({
          error: err.error,
          message: err.message,
          statusCode: err.statusCode,
          ...(err.details !== undefined ? { details: err.details } : {}),
        });
      }
      throw err;
    }
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) {
      const flattened = parsed.error.flatten();
      const firstError =
        Object.values(flattened.fieldErrors).flat()[0] ||
        flattened.formErrors[0] ||
        "Validation failed";
      return reply.code(400).send({
        error: "Validation error",
        message: firstError,
        statusCode: 400,
        details: flattened,
      });
    }

    try {
      const assessment = await assessmentService.updateAssessment(
        companyId,
        userId,
        id,
        parsed.data,
        getForensics(request)
      );
      return { assessment };
    } catch (err) {
      if (err instanceof AcademyServiceError) {
        return reply.code(err.statusCode).send({
          error: err.error,
          message: err.message,
          statusCode: err.statusCode,
          ...(err.details !== undefined ? { details: err.details } : {}),
        });
      }
      throw err;
    }
  });

  app.delete("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    try {
      await assessmentService.deleteAssessment(companyId, userId, id, getForensics(request));
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof AcademyServiceError) {
        return reply.code(err.statusCode).send({
          error: err.error,
          message: err.message,
          statusCode: err.statusCode,
        });
      }
      throw err;
    }
  });
}
