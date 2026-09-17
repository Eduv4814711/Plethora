import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AcademyStudentStatus, AcademyPsiraPreRegistrationStatus } from "@prisma/client";
import { academyProtect } from "./constants.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability } from "../../middleware/authorization.js";
import {
  STUDENT_RESTRICTED_FIELDS,
  canAccessSensitiveData,
  hasRestrictedFields,
  omitFields,
} from "../../lib/sensitive-data.js";
import * as studentService from "../../services/academy-student.service.js";
import { AcademyServiceError } from "../../services/academy-student.service.js";

function canHandleStudentPrivateData(user: import("../../lib/types.js").AuthenticatedUser) {
  return canAccessSensitiveData(user, "/academy");
}

function sanitizeStudent<T extends Record<string, unknown>>(
  student: T,
  user: import("../../lib/types.js").AuthenticatedUser
) {
  return canHandleStudentPrivateData(user) ? student : omitFields(student, STUDENT_RESTRICTED_FIELDS);
}

function rejectStudentPrivateData(
  request: { user?: import("../../lib/types.js").AuthenticatedUser; body: unknown },
  reply: { code: (status: number) => { send: (body: unknown) => unknown } }
) {
  if (canHandleStudentPrivateData(request.user!) || !hasRestrictedFields(request.body, STUDENT_RESTRICTED_FIELDS)) {
    return false;
  }
  reply.code(403).send({
    error: "Forbidden",
    message: "Sensitive student data is restricted to HR/payroll users",
    statusCode: 403,
  });
  return true;
}

function sanitizeDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getFullYear();
  if (y < 1900 || y > 2100) return undefined;
  return d;
}

const optionalString = z.string().optional().nullable();
const optionalDate = z.string().optional().nullable().transform((s) => (s ? sanitizeDate(s) : undefined));

const studentStatuses = z.enum([
  "prospect",
  "registered",
  "active",
  "completed",
  "inactive",
  "blocked",
]) satisfies z.ZodType<AcademyStudentStatus>;

const psiraPreReg = z.enum([
  "unknown",
  "not_required",
  "pending",
  "completed",
]) satisfies z.ZodType<AcademyPsiraPreRegistrationStatus>;

const createStudentSchema = z.object({
  studentNumber: z.string().min(1).max(50).optional(),
  firstName: z.string().min(1),
  middleName: optionalString,
  lastName: z.string().min(1),
  preferredName: optionalString,
  idType: optionalString,
  idNumber: optionalString,
  dateOfBirth: optionalDate,
  gender: optionalString,
  nationality: optionalString,
  phone: optionalString,
  alternatePhone: optionalString,
  email: optionalString,
  addressLine1: optionalString,
  addressLine2: optionalString,
  city: optionalString,
  province: optionalString,
  postalCode: optionalString,
  nextOfKinName: optionalString,
  nextOfKinPhone: optionalString,
  psiraProfileReference: optionalString,
  psiraPreRegistrationStatus: psiraPreReg.optional(),
  status: studentStatuses.optional(),
  employeeId: z.string().optional().nullable(),
});

const updateStudentSchema = createStudentSchema.partial();

const recordAdminFeeSchema = z
  .object({
    status: z.enum(["paid", "waived", "unpaid"]),
    amount: z.union([z.number(), z.string()]).optional(),
    method: optionalString,
    reference: optionalString,
    notes: optionalString,
  })
  .superRefine((data, ctx) => {
    if (data.status === "paid") {
      if (data.amount === undefined || data.amount === "" || data.amount === null) {
        ctx.addIssue({ code: "custom", message: "amount is required when status is paid", path: ["amount"] });
      }
    }
    if (data.status === "waived") {
      const n = data.notes?.trim();
      if (!n) {
        ctx.addIssue({ code: "custom", message: "notes are required when status is waived", path: ["notes"] });
      }
    }
  });

function formatStudent(s: studentService.StudentWithDetails) {
  return {
    ...s,
    adminFeeAmount: s.adminFeeAmount != null ? s.adminFeeAmount.toString() : null,
  };
}

export async function academyStudentsRoutes(app: FastifyInstance) {
  const editProtect = [authMiddleware, requireCapability("/academy", "edit")];

  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;

    const res = await studentService.listStudents({
      companyId,
      search: q.q,
      status: q.status as AcademyStudentStatus | undefined,
      limit: Number(q.limit) || 50,
      offset: Number(q.offset) || 0,
      canAccessSensitive: canHandleStudentPrivateData(request.user!),
    });

    const students = res.students.map((s) =>
      sanitizeStudent(formatStudent(s), request.user!)
    );

    return { students, total: res.total, limit: res.limit, offset: res.offset };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    if (rejectStudentPrivateData(request, reply)) return;
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;

    const body = createStudentSchema.safeParse(request.body);
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
      const student = await studentService.registerStudent(companyId, userId, body.data);
      return reply.code(201).send({
        student: sanitizeStudent(
          formatStudent(student as studentService.StudentWithDetails),
          request.user!
        ),
      });
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

  app.post("/:id/admin-fee", { preHandler: editProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    const body = recordAdminFeeSchema.safeParse(request.body);
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
      const student = await studentService.recordAdminFee(companyId, id, userId, body.data);
      return {
        student: sanitizeStudent(formatStudent(student), request.user!),
      };
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

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };

    try {
      const student = await studentService.getStudentById(companyId, id);
      return {
        student: sanitizeStudent(formatStudent(student), request.user!),
      };
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
    if (rejectStudentPrivateData(request, reply)) return;
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    const body = updateStudentSchema.safeParse(request.body);
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
      const student = await studentService.updateStudent(companyId, id, userId, body.data);
      return {
        student: sanitizeStudent(formatStudent(student), request.user!),
      };
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
      const res = await studentService.deactivateOrDeleteStudent(companyId, id, userId);
      if (res.deactivated && res.student) {
        return {
          student: sanitizeStudent(formatStudent(res.student), request.user!),
          deactivated: true,
        };
      }
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
