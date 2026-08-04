import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireCapability, requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { sendPrivateStoredFile } from "../lib/private-download.js";
import { persistWithUploadedFileRollback, readStreamToBuffer, storage } from "../lib/storage.js";
import { matchesMagicBytes, sanitizeUploadFilename } from "../lib/upload-validation.js";
import {
  attachMedicalCertificate,
  cancelLeaveRequest,
  createLeaveAdjustment,
  createLeaveRequest,
  decideLeaveRequest,
  getLeaveBalances,
  LeaveV3Error,
  previewLeaveRequest,
} from "../services/leave-v3.service.js";

const MAX_CERTIFICATE_BYTES = 10 * 1024 * 1024;
const ALLOWED_CERTIFICATE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const leaveType = z.enum(["ANNUAL", "SICK", "FAMILY_RESPONSIBILITY", "PARENTAL", "STUDY"]);
const familyResponsibilityReason = z.enum([
  "CHILD_BIRTH",
  "CHILD_SICK",
  "SPOUSE_OR_LIFE_PARTNER_DEATH",
  "PARENT_DEATH",
  "ADOPTIVE_PARENT_DEATH",
  "GRANDPARENT_DEATH",
  "CHILD_DEATH",
  "ADOPTED_CHILD_DEATH",
  "GRANDCHILD_DEATH",
  "SIBLING_DEATH",
]);
const parentalLeaveScenario = z.enum(["SOLE_OR_ONLY_EMPLOYED_PARENT", "SHARED_POOL"]);

const requestBodySchema = z.object({
  employeeId: z.string().min(1),
  leaveType,
  startDate: z.string().regex(DATE),
  endDate: z.string().regex(DATE),
  unitsRequested: z.number().positive(),
  reason: z.string().max(2000).optional(),
  familyResponsibilityReason: familyResponsibilityReason.optional(),
  parentalLeaveScenario: parentalLeaveScenario.optional(),
  workedPublicHoliday: z.boolean().optional(),
});

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(2000).optional(),
});

const cancelSchema = z.object({ reason: z.string().min(1).max(2000) });

const adjustmentSchema = z.object({
  employeeId: z.string().min(1),
  leaveType,
  units: z.number().refine((value) => value !== 0, "units cannot be zero"),
  reason: z.string().min(1).max(2000),
});

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function sendLeaveV3Error(reply: FastifyReply, error: unknown) {
  if (error instanceof LeaveV3Error) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}

export async function leaveV3Routes(app: FastifyInstance) {
  // Leave is its own grantable module. A /payroll grant no longer implies it;
  // the access migration granted /employees/leave explicitly to prior holders.
  const readProtect = [authMiddleware, requireCapability("/employees/leave", "view")];
  const manageProtect = [authMiddleware, requireCrudCapability({ module: "/employees/leave" })];
  const approveProtect = [authMiddleware, requireCapability("/employees/leave", "approve")];
  const exportProtect = [authMiddleware, requireCapability("/employees/leave", "export")];

  app.post("/preview", { preHandler: readProtect }, async (request, reply) => {
    const parsed = requestBodySchema.omit({ reason: true }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    try {
      const preview = await previewLeaveRequest(request.user!.companyId, {
        ...parsed.data,
        startDate: toDate(parsed.data.startDate),
        endDate: toDate(parsed.data.endDate),
      });
      return reply.send({ data: preview });
    } catch (error) {
      return sendLeaveV3Error(reply, error);
    }
  });

  app.post("/", { preHandler: manageProtect }, async (request, reply) => {
    const parsed = requestBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    try {
      const created = await createLeaveRequest(request.user!.companyId, request.user!.sub, {
        ...parsed.data,
        startDate: toDate(parsed.data.startDate),
        endDate: toDate(parsed.data.endDate),
      });
      return reply.code(201).send({ data: created });
    } catch (error) {
      return sendLeaveV3Error(reply, error);
    }
  });

  app.get("/", { preHandler: readProtect }, async (request, reply) => {
    const query = request.query as { employeeId?: string; status?: string; leaveType?: string; start?: string; end?: string };
    const data = await prisma.leaveRequest.findMany({
      where: {
        companyId: request.user!.companyId,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.leaveType ? { leaveType: query.leaveType as never } : {}),
        ...(query.start ? { endDate: { gte: toDate(query.start) } } : {}),
        ...(query.end ? { startDate: { lte: toDate(query.end) } } : {}),
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeType: true } }, medicalCertificate: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ data });
  });

  app.get("/balances", { preHandler: readProtect }, async (request, reply) => {
    const query = request.query as { employeeId?: string };
    if (!query.employeeId) return reply.code(400).send({ error: "Validation error", message: "employeeId is required" });
    try {
      const data = await getLeaveBalances(request.user!.companyId, query.employeeId);
      return reply.send({ data });
    } catch (error) {
      return sendLeaveV3Error(reply, error);
    }
  });

  app.post("/:id/decide", { preHandler: approveProtect }, async (request, reply) => {
    const parsed = decisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    try {
      const updated = await decideLeaveRequest({
        companyId: request.user!.companyId,
        actorUserId: request.user!.sub,
        requestId: (request.params as { id: string }).id,
        decision: parsed.data.decision === "approve" ? "APPROVED" : "REJECTED",
        reason: parsed.data.reason,
      });
      return reply.send({ data: updated });
    } catch (error) {
      return sendLeaveV3Error(reply, error);
    }
  });

  app.post("/:id/cancel", { preHandler: manageProtect }, async (request, reply) => {
    const parsed = cancelSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    try {
      const updated = await cancelLeaveRequest({
        companyId: request.user!.companyId,
        actorUserId: request.user!.sub,
        requestId: (request.params as { id: string }).id,
        reason: parsed.data.reason,
      });
      return reply.send({ data: updated });
    } catch (error) {
      return sendLeaveV3Error(reply, error);
    }
  });

  app.post("/adjustments", { preHandler: approveProtect }, async (request, reply) => {
    const parsed = adjustmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    try {
      const created = await createLeaveAdjustment({
        companyId: request.user!.companyId,
        actorUserId: request.user!.sub,
        ...parsed.data,
      });
      return reply.code(201).send({ data: created });
    } catch (error) {
      return sendLeaveV3Error(reply, error);
    }
  });

  app.get("/adjustments", { preHandler: readProtect }, async (request, reply) => {
    const query = request.query as { employeeId?: string };
    const data = await prisma.leaveAdjustment.findMany({
      where: { companyId: request.user!.companyId, ...(query.employeeId ? { employeeId: query.employeeId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ data });
  });

  app.get("/audit", { preHandler: readProtect }, async (request, reply) => {
    const query = request.query as { employeeId?: string; limit?: string };
    const limit = Math.min(Number(query.limit) || 250, 1000);
    const data = await prisma.leaveAuditLog.findMany({
      where: { companyId: request.user!.companyId, ...(query.employeeId ? { employeeId: query.employeeId } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return reply.send({ data });
  });

  app.post("/:id/medical-certificate", { preHandler: manageProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const leaveRequest = await prisma.leaveRequest.findFirst({ where: { id, companyId: request.user!.companyId } });
    if (!leaveRequest) return reply.code(404).send({ error: "Not found", message: "Leave request not found" });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No file", message: "Please attach the medical certificate" });
    const ext = ALLOWED_CERTIFICATE_TYPES[data.mimetype];
    if (!ext) return reply.code(400).send({ error: "Invalid file type", message: "Allowed file types: PDF, JPEG, PNG, or WebP" });

    let buffer: Buffer;
    try {
      buffer = await readStreamToBuffer(data.file, MAX_CERTIFICATE_BYTES);
    } catch {
      return reply.code(400).send({ error: "File too large", message: "Maximum file size is 10MB" });
    }
    if (!matchesMagicBytes(buffer, data.mimetype)) {
      return reply.code(400).send({ error: "Invalid file", message: "File content does not match the declared type" });
    }

    const fields = data.fields as Record<string, { value?: unknown } | undefined>;
    const fieldValue = (name: string) => {
      const value = fields[name]?.value;
      return typeof value === "string" ? value.trim() : "";
    };
    const parsedFields = z
      .object({
        practitionerName: z.string().min(1),
        practitionerRegistrationNumber: z.string().min(1),
        consultationDate: z.string().regex(DATE),
        bookedOffStartDate: z.string().regex(DATE),
        bookedOffEndDate: z.string().regex(DATE),
      })
      .safeParse({
        practitionerName: fieldValue("practitionerName"),
        practitionerRegistrationNumber: fieldValue("practitionerRegistrationNumber"),
        consultationDate: fieldValue("consultationDate"),
        bookedOffStartDate: fieldValue("bookedOffStartDate"),
        bookedOffEndDate: fieldValue("bookedOffEndDate"),
      });
    if (!parsedFields.success) {
      return reply.code(400).send({ error: "Validation error", message: parsedFields.error.flatten().fieldErrors });
    }

    const key = `leave-medical-certificates/${request.user!.companyId}/${leaveRequest.id}/${randomUUID()}.${ext}`;
    await storage.uploadFile({ key, body: buffer, contentType: data.mimetype });
    try {
      const certificate = await persistWithUploadedFileRollback(
        key,
        () =>
          attachMedicalCertificate({
            companyId: request.user!.companyId,
            actorUserId: request.user!.sub,
            leaveRequestId: leaveRequest.id,
            practitionerName: parsedFields.data.practitionerName,
            practitionerRegistrationNumber: parsedFields.data.practitionerRegistrationNumber,
            consultationDate: toDate(parsedFields.data.consultationDate),
            bookedOffStartDate: toDate(parsedFields.data.bookedOffStartDate),
            bookedOffEndDate: toDate(parsedFields.data.bookedOffEndDate),
            fileReference: storage.getAssetUrl(key),
          }),
        { onCleanupError: (cleanupError) => request.log.error({ err: cleanupError, key }, "Failed to remove medical certificate file after database rollback") },
      );
      return reply.code(201).send({ data: certificate });
    } catch (error) {
      return sendLeaveV3Error(reply, error);
    }
  });

  app.get("/:id/medical-certificate", { preHandler: exportProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const certificate = await prisma.medicalCertificate.findFirst({
      where: { leaveRequestId: id, leaveRequest: { companyId: request.user!.companyId } },
    });
    if (!certificate) return reply.code(404).send({ error: "Not found", message: "Medical certificate not found" });
    const ext = certificate.fileReference.split(".").pop() || "bin";
    const mimeType = Object.entries(ALLOWED_CERTIFICATE_TYPES).find(([, extension]) => extension === ext)?.[0] || "application/octet-stream";
    return sendPrivateStoredFile(reply, {
      storedReference: certificate.fileReference,
      allowedPrefixes: [`leave-medical-certificates/${request.user!.companyId}`],
      fileName: sanitizeUploadFilename(`medical-certificate.${ext}`, mimeType),
      mimeType,
    });
  });
}
