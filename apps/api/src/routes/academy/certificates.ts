import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability } from "../../middleware/authorization.js";
import { academyProtect } from "./constants.js";
import * as certificateService from "../../services/academy-certificate.service.js";
import { AcademyServiceError } from "../../services/academy-student.service.js";

const createSchema = z.object({
  learnerId: z.string().min(1),
  courseId: z.string().min(1),
  enrolmentId: z.string().optional().nullable(),
  completionDate: z.string().optional().nullable(),
  issueDate: z.string().min(1),
  certificateNumber: z.string().optional().nullable(),
  pdfPath: z.string().optional().nullable(),
  validityMonths: z.number().int().optional().nullable(),
});

const updateSchema = z.object({
  completionDate: z.string().optional().nullable(),
  issueDate: z.string().optional(),
  pdfPath: z.string().optional().nullable(),
  status: z.enum(["active", "reprinted", "revoked", "void"]).optional(),
});

const reprintRevokeSchema = z.object({
  reason: z.string().optional(),
});

function getForensics(req: FastifyRequest): certificateService.AttendanceForensics {
  return {
    ipAddress: req.ip ?? null,
    userAgent: (req.headers["user-agent"] as string) ?? null,
    requestId: req.id ?? null,
  };
}

export async function academyCertificatesRoutes(app: FastifyInstance) {
  const approveProtect = [
    authMiddleware,
    requireCapability("/academy", "approve"),
  ];

  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;

    return certificateService.listCertificates(companyId, {
      learnerId: q.learnerId,
      courseId: q.courseId,
      status: q.status as "active" | "reprinted" | "revoked" | "void" | undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };

    const certificate = await certificateService.getCertificateById(companyId, id);
    if (!certificate) {
      return reply.code(404).send({
        error: "Not found",
        message: "Certificate not found",
        statusCode: 404,
      });
    }

    return { certificate };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const parsed = createSchema.safeParse(request.body);
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
      const { certificate } = await certificateService.issueCertificate(
        companyId,
        userId,
        parsed.data,
        getForensics(request)
      );
      return reply.code(201).send({ certificate });
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

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    const parsed = updateSchema.safeParse(request.body);
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
      const certificate = await certificateService.updateCertificate(
        companyId,
        userId,
        id,
        parsed.data,
        getForensics(request)
      );
      return { certificate };
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
      await certificateService.deleteCertificate(companyId, userId, id, getForensics(request));
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

  app.post("/:id/reprint", { preHandler: approveProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const body = reprintRevokeSchema.safeParse(request.body ?? {});

    try {
      const certificate = await certificateService.reprintCertificate(
        companyId,
        userId,
        id,
        body.success ? body.data.reason : undefined,
        getForensics(request)
      );
      return { certificate };
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

  app.post("/:id/revoke", { preHandler: approveProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const body = reprintRevokeSchema.safeParse(request.body ?? {});

    try {
      const certificate = await certificateService.revokeCertificate(
        companyId,
        userId,
        id,
        body.success ? body.data.reason : undefined,
        getForensics(request)
      );
      return { certificate };
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

  app.get("/verify/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const res = await certificateService.verifyCertificatePublic(code);
    if (!res.certificate) {
      return reply.code(404).send({
        error: "Not found",
        message: "Certificate verification failed",
        statusCode: 404,
      });
    }
    return res;
  });
}
