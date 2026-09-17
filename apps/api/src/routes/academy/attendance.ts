import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { academyProtect } from "./constants.js";
import * as attendanceService from "../../services/academy-attendance.service.js";
import { AcademyServiceError } from "../../services/academy-student.service.js";

const sessionSchema = z.object({
  courseRunId: z.string().optional().nullable(),
  classroomId: z.string().optional().nullable(),
  instructorId: z.string().optional().nullable(),
  sessionDate: z.string().min(1),
});

const markSchema = z.object({
  sessionId: z.string().min(1),
  enrolmentId: z.string().min(1),
  attendanceStatus: z.enum(["present", "absent", "late", "excused"]),
  method: z.enum(["manual", "qr_code", "otp", "biometric"]).optional(),
  checkInTime: z.string().optional().nullable(),
  checkOutTime: z.string().optional().nullable(),
});

const markBulkSchema = z.object({
  sessionId: z.string().min(1),
  rows: z.array(markSchema.omit({ sessionId: true })).min(1).max(200),
});

function getForensics(req: FastifyRequest): attendanceService.AttendanceForensics {
  return {
    ipAddress: req.ip ?? null,
    userAgent: (req.headers["user-agent"] as string) ?? null,
    requestId: req.id ?? null,
  };
}

export async function academyAttendanceRoutes(app: FastifyInstance) {
  app.get("/sessions", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;

    return attendanceService.listAttendanceSessions(companyId, {
      courseRunId: q.courseRunId,
      startDate: q.startDate,
      endDate: q.endDate,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });

  app.get("/sessions/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };

    const session = await attendanceService.getAttendanceSessionById(companyId, id);
    if (!session) {
      return reply.code(404).send({
        error: "Not found",
        message: "Session not found",
        statusCode: 404,
      });
    }

    return { session };
  });

  app.post("/sessions", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const parsed = sessionSchema.safeParse(request.body);
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
      const session = await attendanceService.createAttendanceSession(
        companyId,
        userId,
        parsed.data,
        getForensics(request)
      );
      return reply.code(201).send({ session });
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

  app.patch("/sessions/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    const parsed = sessionSchema.partial().safeParse(request.body);
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
      const session = await attendanceService.updateAttendanceSession(
        companyId,
        userId,
        id,
        parsed.data,
        getForensics(request)
      );
      return { session };
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

  app.delete("/sessions/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    try {
      await attendanceService.deleteAttendanceSession(companyId, userId, id, getForensics(request));
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

  app.post("/mark", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const parsed = markSchema.safeParse(request.body);
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
      const record = await attendanceService.markAttendance(
        companyId,
        userId,
        parsed.data,
        getForensics(request)
      );
      return { record };
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

  app.post("/mark-bulk", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const parsed = markBulkSchema.safeParse(request.body);
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
      const result = await attendanceService.markAttendanceBulk(
        companyId,
        userId,
        parsed.data.sessionId,
        parsed.data.rows,
        getForensics(request)
      );
      return { records: result.records };
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

  app.delete("/records/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    try {
      await attendanceService.unmarkAttendanceRecord(companyId, userId, id, getForensics(request));
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
