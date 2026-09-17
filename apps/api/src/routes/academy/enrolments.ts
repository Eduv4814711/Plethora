import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  AcademyEnrolmentFinancialStatus,
  AcademyEnrolmentAttendanceStatus,
  AcademyEnrolmentCompletionStatus,
  AcademyReportingReadinessStatus,
  AcademyPsiraSubmissionStatus,
} from "@prisma/client";
import { academyProtect } from "./constants.js";
import * as enrolmentService from "../../services/academy-enrolment.service.js";
import { AcademyServiceError } from "../../services/academy-student.service.js";

const financialSchema = z.enum(["unpaid", "partial", "paid"]) satisfies z.ZodType<AcademyEnrolmentFinancialStatus>;
const attendanceSchema = z.enum(["pending", "in_progress", "compliant", "non_compliant"]) satisfies z.ZodType<
  AcademyEnrolmentAttendanceStatus
>;
const completionSchema = z.enum(["pending", "in_progress", "completed", "failed"]) satisfies z.ZodType<
  AcademyEnrolmentCompletionStatus
>;
const readinessSchema = z.enum(["not_started", "incomplete", "ready", "blocked"]) satisfies z.ZodType<
  AcademyReportingReadinessStatus
>;
const psiraSubmissionSchema = z.enum([
  "not_applicable",
  "not_started",
  "pending",
  "submitted",
  "approved",
  "rejected",
]) satisfies z.ZodType<AcademyPsiraSubmissionStatus>;

const createEnrolmentSchema = z.object({
  studentId: z.string().min(1),
  courseRunId: z.string().min(1),
  enrolmentDate: z.string().optional(),
  feePlanId: z.string().optional().nullable(),
  financialStatus: financialSchema.optional(),
  attendanceStatus: attendanceSchema.optional(),
  completionStatus: completionSchema.optional(),
  reportingReadinessStatus: readinessSchema.optional(),
  psiraSubmissionStatus: psiraSubmissionSchema.optional(),
  remarks: z.string().optional().nullable(),
  createInvoice: z.boolean().optional(),
  invoiceStatus: z.enum(["draft", "issued"]).optional(),
  invoiceDueDate: z.string().optional(),
  discountAmount: z.union([z.number(), z.string()]).optional(),
});

const updateEnrolmentSchema = createEnrolmentSchema.partial().omit({ studentId: true, courseRunId: true });

const batchEnrolmentSchema = z.object({
  studentId: z.string().min(1),
  courseRunIds: z.array(z.string().min(1)).min(1).max(25),
  createInvoice: z.boolean().optional(),
  invoiceDueDate: z.string().optional(),
  discountAmount: z.union([z.number(), z.string()]).optional(),
});

export async function academyEnrolmentsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;

    return enrolmentService.listEnrolments({
      companyId,
      courseRunId: q.courseRunId,
      studentId: q.studentId,
      limit: Number(q.limit) || 100,
      offset: Number(q.offset) || 0,
    });
  });

  app.post("/batch", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const body = batchEnrolmentSchema.safeParse(request.body);
    if (!body.success) {
      const flattened = body.error.flatten();
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
      const enrolments = await enrolmentService.batchEnrolLearners(companyId, userId, body.data);
      return reply.code(201).send({ enrolments });
    } catch (err) {
      if (err instanceof AcademyServiceError) {
        return reply.code(err.statusCode).send({
          error: err.error,
          message: err.message,
          statusCode: err.statusCode,
          ...(err.details !== undefined ? { details: err.details } : {}),
          ...(err.blockers !== undefined ? { blockers: err.blockers } : {}),
        });
      }
      throw err;
    }
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const body = createEnrolmentSchema.safeParse(request.body);
    if (!body.success) {
      const flattened = body.error.flatten();
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
      const result = await enrolmentService.createEnrolment(companyId, userId, body.data);
      return reply.code(201).send({
        enrolment: result.enrolment,
        invoice: result.invoice ?? undefined,
      });
    } catch (err) {
      if (err instanceof AcademyServiceError) {
        return reply.code(err.statusCode).send({
          error: err.error,
          message: err.message,
          statusCode: err.statusCode,
          ...(err.details !== undefined ? { details: err.details } : {}),
          ...(err.blockers !== undefined ? { blockers: err.blockers } : {}),
        });
      }
      throw err;
    }
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };

    try {
      const enrolment = await enrolmentService.getEnrolmentById(companyId, id);
      return { enrolment };
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

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    const body = updateEnrolmentSchema.safeParse(request.body);
    if (!body.success) {
      const flattened = body.error.flatten();
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
      const enrolment = await enrolmentService.updateEnrolment(companyId, id, userId, body.data);
      return { enrolment };
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
      await enrolmentService.cancelOrDeleteEnrolment(companyId, id, userId);
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
