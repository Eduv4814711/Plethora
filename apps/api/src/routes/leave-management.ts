import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireAnyCapability, requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { sendPrivateStoredFile } from "../lib/private-download.js";
import { persistWithUploadedFileRollback, readStreamToBuffer, storage } from "../lib/storage.js";
import { matchesMagicBytes, sanitizeUploadFilename } from "../lib/upload-validation.js";
import {
  cancelOrWithdrawLeave,
  accrueConfirmedLeave,
  createLeaveApplication,
  createOpeningBalanceAdjustment,
  decideLeaveApplication,
  ensureDefaultLeavePolicy,
  getLeaveApplication,
  getLeaveBalances,
  getLeaveCalendar,
  getLeaveReport,
  listLeaveAdjustments,
  LeaveManagementError,
  listLeaveApplications,
  previewLeave,
  resolveLeaveAdjustment,
  submitLeaveApplication,
} from "../services/leave-management.service.js";
import { leavePolicyConfigurationIssues } from "../services/leave-policy.service.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const applicationStatus = z.enum([
  "DRAFT", "SUBMITTED", "PENDING_HR", "APPROVED", "REJECTED", "WITHDRAWN",
  "CANCELLATION_REQUESTED", "CANCELLED", "EXPIRED", "PAYROLL_PROCESSED",
  "ADJUSTMENT_REQUIRED", "IMPORTED_APPROVED",
]);
const previewSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeCode: z.string().min(1),
  startDate: z.string().regex(DATE),
  endDate: z.string().regex(DATE).optional(),
  requestedMinutesPerDay: z.number().int().positive().max(24 * 60).optional(),
  excludeApplicationId: z.string().optional(),
});
const createSchema = previewSchema.omit({ excludeApplicationId: true }).extend({
  reason: z.string().max(2000).optional(),
  retrospectiveReason: z.string().max(2000).optional(),
  submit: z.boolean().default(true),
});
const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(2000).optional(),
  expectedVersion: z.number().int().positive().optional(),
});
const cancellationSchema = z.object({ reason: z.string().min(1).max(2000), expectedVersion: z.number().int().positive().optional() });
const adjustmentSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeCode: z.string().min(1),
  minutes: z.number().int().refine((value) => value !== 0),
  reason: z.string().min(1).max(2000),
});
const adjustmentStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "POSTED"]);
const adjustmentResolutionSchema = z.object({
  decision: z.enum(["reject", "confirm_external_correction"]),
  reason: z.string().min(1).max(2000),
  payrollReference: z.string().min(1).max(250).optional(),
});

function withoutDocumentStoragePath<T extends { fileUrl: string }>(document: T): Omit<T, "fileUrl"> {
  const { fileUrl, ...safeDocument } = document;
  void fileUrl;
  return safeDocument;
}
const employmentTermSchema = z.object({
  employeeId: z.string().min(1), effectiveFrom: z.string().regex(DATE), effectiveTo: z.string().regex(DATE).optional(),
  contractType: z.string().min(1).max(100), normalMinutesPerShift: z.number().int().positive().max(24 * 60),
  normalDaysPerWeek: z.number().positive().max(7).optional(), workingPattern: z.record(z.string(), z.unknown()).optional(),
});
const supportedApprovalFlowSchema = z.tuple([
  z.object({
    order: z.literal(1),
    module: z.literal("/employees/leave"),
    capability: z.literal("approve"),
    required: z.literal(true),
  }).strict(),
]);
const policyVersionSchema = z.object({
  leaveTypeCode: z.string().min(1), effectiveFrom: z.string().regex(DATE), effectiveTo: z.string().regex(DATE).optional(),
  sourceAuthority: z.string().min(1).max(250), legalReference: z.string().max(1000).optional(),
  entitlementMinutes: z.number().int().positive().optional(), accrualMethod: z.string().min(1).max(100),
  accrualRateMinutes: z.number().positive().optional(), cycleMonths: z.number().int().min(0).max(120).default(12),
  carryOverLimitMinutes: z.number().int().nonnegative().nullable().optional(), expiryMonths: z.number().int().positive().nullable().optional(),
  noticeDays: z.number().int().nonnegative().nullable().optional(), maxConsecutiveDays: z.number().int().positive().optional(),
  negativeBalanceAllowed: z.boolean().default(false), autoConvertToUnpaid: z.boolean().default(false),
  approvalFlow: supportedApprovalFlowSchema.default([
    { order: 1, module: "/employees/leave", capability: "approve", required: true },
  ]),
  documentRules: z.record(z.string(), z.unknown()).optional(), calculationRules: z.record(z.string(), z.unknown()).optional(),
});
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function sendLeaveError(reply: import("fastify").FastifyReply, error: unknown) {
  if (error instanceof LeaveManagementError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}

async function visibleEmployeeIds(_user: { companyId: string; sub: string }): Promise<string[] | undefined> {
  // Titles never determine record visibility. Tenant-wide module grants currently
  // cover tenant records; client data remains scoped through its linked profile.
  return undefined;
}

function employeeIsVisible(employeeId: string, scope: string[] | undefined): boolean {
  return !scope || scope.includes(employeeId);
}

export async function leaveManagementRoutes(app: FastifyInstance) {
  const readProtect = [
    authMiddleware,
    requireAnyCapability(["/employees/leave", "/payroll"], "view"),
  ];
  const manageProtect = [
    authMiddleware,
    requireCrudCapability({ anyOfModules: ["/employees/leave", "/payroll"] }),
  ];
  const approveProtect = [
    authMiddleware,
    requireAnyCapability(["/employees/leave", "/payroll"], "approve"),
  ];
  const exportProtect = [
    authMiddleware,
    requireAnyCapability(["/employees/leave", "/payroll"], "export"),
  ];
  const editProtect = [
    authMiddleware,
    requireAnyCapability(["/employees/leave", "/payroll"], "edit"),
  ];

  app.get("/types", { preHandler: readProtect }, async (request, reply) => {
    await ensureDefaultLeavePolicy(request.user!.companyId, request.user!.sub);
    const data = await prisma.leaveTypeDefinition.findMany({
      where: { companyId: request.user!.companyId, isActive: true },
      orderBy: { name: "asc" },
    });
    return reply.send({ data });
  });

  app.get("/policies", { preHandler: readProtect }, async (request, reply) => {
    await ensureDefaultLeavePolicy(request.user!.companyId, request.user!.sub);
    const data = await prisma.leavePolicy.findMany({
      where: { companyId: request.user!.companyId },
      include: { versions: { include: { leaveType: true }, orderBy: [{ leaveType: { name: "asc" } }, { version: "desc" }] }, assignments: true },
      orderBy: { name: "asc" },
    });
    return reply.send({
      data: data.map((policy) => ({
        ...policy,
        versions: policy.versions.map((version) => {
          const configurationIssues = leavePolicyConfigurationIssues(version);
          return {
            ...version,
            configurationReady: configurationIssues.length === 0,
            configurationIssues,
          };
        }),
      })),
    });
  });

  app.post("/policies/:policyId/versions", { preHandler: manageProtect }, async (request, reply) => {
    const parsed = policyVersionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const policy = await prisma.leavePolicy.findFirst({ where: { id: (request.params as { policyId: string }).policyId, companyId: request.user!.companyId } });
    const leaveType = await prisma.leaveTypeDefinition.findFirst({ where: { companyId: request.user!.companyId, code: parsed.data.leaveTypeCode } });
    if (!policy || !leaveType) return reply.code(404).send({ error: "Not found", message: "Policy or leave type not found" });
    const effectiveFrom = normalizeDate(parsed.data.effectiveFrom);
    const effectiveTo = parsed.data.effectiveTo ? normalizeDate(parsed.data.effectiveTo) : null;
    if (effectiveTo && effectiveTo < effectiveFrom) return reply.code(400).send({ error: "Validation error", message: "effectiveTo must be on or after effectiveFrom" });
    const created = await prisma.$transaction(async (tx) => {
      const latest = await tx.leavePolicyVersion.findFirst({ where: { policyId: policy.id, leaveTypeId: leaveType.id }, orderBy: { version: "desc" } });
      if (latest && latest.effectiveFrom >= effectiveFrom) throw new LeaveManagementError("A new policy version must start after the latest version's effective date", 409, "POLICY_DATE_CONFLICT");
      const { leaveTypeCode: _leaveTypeCode, ...data } = parsed.data;
      const version = await tx.leavePolicyVersion.create({ data: { companyId: request.user!.companyId, policyId: policy.id, leaveTypeId: leaveType.id, version: (latest?.version ?? 0) + 1, ...data, approvalFlow: data.approvalFlow as Prisma.InputJsonValue, documentRules: data.documentRules as Prisma.InputJsonValue | undefined, calculationRules: data.calculationRules as Prisma.InputJsonValue | undefined, effectiveFrom, effectiveTo, reviewStatus: "PENDING_HR_LEGAL_CONFIRMATION", createdBy: request.user!.sub } });
      await tx.leaveAuditEvent.create({ data: { companyId: request.user!.companyId, userId: request.user!.sub, eventType: "POLICY_VERSION_CREATED", newValue: { policyVersionId: version.id, policyId: policy.id, leaveTypeCode: leaveType.code, version: version.version } } });
      return version;
    });
    return reply.code(201).send(created);
  });

  app.put("/policies/versions/:id", { preHandler: manageProtect }, async (request, reply) => {
    const parsed = policyVersionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const { id } = request.params as { id: string };
    const existing = await prisma.leavePolicyVersion.findFirst({
      where: { id, companyId: request.user!.companyId },
      include: { leaveType: true },
    });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Policy version not found" });
    if (existing.reviewStatus !== "PENDING_HR_LEGAL_CONFIRMATION") {
      return reply.code(409).send({ error: "POLICY_STATUS_CONFLICT", message: "Only a pending policy version can be edited; create a new effective-dated version instead" });
    }
    if (parsed.data.leaveTypeCode !== existing.leaveType.code) {
      return reply.code(409).send({ error: "POLICY_TYPE_CONFLICT", message: "A policy version's leave type cannot be changed" });
    }
    const effectiveFrom = normalizeDate(parsed.data.effectiveFrom);
    const effectiveTo = parsed.data.effectiveTo ? normalizeDate(parsed.data.effectiveTo) : null;
    if (effectiveTo && effectiveTo < effectiveFrom) return reply.code(400).send({ error: "Validation error", message: "effectiveTo must be on or after effectiveFrom" });
    const laterVersion = await prisma.leavePolicyVersion.findFirst({
      where: {
        id: { not: existing.id },
        policyId: existing.policyId,
        leaveTypeId: existing.leaveTypeId,
        effectiveFrom: { gte: effectiveFrom },
      },
      select: { id: true },
    });
    if (laterVersion) return reply.code(409).send({ error: "POLICY_DATE_CONFLICT", message: "This effective date conflicts with a later policy version" });
    const { leaveTypeCode: _leaveTypeCode, ...data } = parsed.data;
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.leavePolicyVersion.updateMany({
        where: { id: existing.id, reviewStatus: "PENDING_HR_LEGAL_CONFIRMATION" },
        data: {
          ...data,
          approvalFlow: data.approvalFlow as Prisma.InputJsonValue,
          documentRules: data.documentRules as Prisma.InputJsonValue | undefined,
          calculationRules: data.calculationRules as Prisma.InputJsonValue | undefined,
          effectiveFrom,
          effectiveTo,
        },
      });
      if (changed.count !== 1) throw new LeaveManagementError("Policy version changed during editing; refresh and try again", 409, "POLICY_STATUS_CONFLICT");
      await tx.leaveAuditEvent.create({ data: { companyId: request.user!.companyId, userId: request.user!.sub, eventType: "POLICY_VERSION_UPDATED", newValue: { policyVersionId: existing.id, leaveTypeCode: existing.leaveType.code } } });
      return tx.leavePolicyVersion.findUniqueOrThrow({ where: { id: existing.id } });
    });
    return reply.send(updated);
  });

  app.post("/policies/versions/:id/confirm", { preHandler: approveProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updated = await prisma.$transaction(async (tx) => {
      const version = await tx.leavePolicyVersion.findFirst({ where: { id, companyId: request.user!.companyId }, include: { leaveType: true } });
      if (!version) throw new LeaveManagementError("Policy version not found", 404, "NOT_FOUND");
      const configurationIssues = leavePolicyConfigurationIssues(version);
      if (configurationIssues.length > 0) {
        throw new LeaveManagementError(configurationIssues.join(" "), 409, "POLICY_CONFIGURATION_INCOMPLETE");
      }
      if (version.reviewStatus === "ACTIVE") return version;
      if (version.reviewStatus !== "PENDING_HR_LEGAL_CONFIRMATION") {
        throw new LeaveManagementError("Only a pending policy version can be confirmed", 409, "POLICY_STATUS_CONFLICT");
      }

      const activeOverlaps = await tx.leavePolicyVersion.findMany({
        where: {
          id: { not: version.id },
          policyId: version.policyId,
          leaveTypeId: version.leaveTypeId,
          reviewStatus: "ACTIVE",
          effectiveFrom: { lte: version.effectiveTo ?? new Date("9999-12-31T00:00:00.000Z") },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: version.effectiveFrom } }],
        },
      });
      for (const active of activeOverlaps) {
        if (active.effectiveFrom >= version.effectiveFrom) {
          throw new LeaveManagementError("The pending policy overlaps an active version that starts on or after it", 409, "POLICY_DATE_CONFLICT");
        }
        await tx.leavePolicyVersion.update({
          where: { id: active.id },
          data: { effectiveTo: new Date(version.effectiveFrom.getTime() - 86_400_000) },
        });
      }

      const changed = await tx.leavePolicyVersion.updateMany({
        where: { id: version.id, reviewStatus: "PENDING_HR_LEGAL_CONFIRMATION" },
        data: { reviewStatus: "ACTIVE", confirmedBy: request.user!.sub, confirmedAt: new Date() },
      });
      if (changed.count !== 1) {
        throw new LeaveManagementError("Policy version changed during confirmation; refresh and try again", 409, "POLICY_STATUS_CONFLICT");
      }
      await tx.leaveAuditEvent.create({ data: { companyId: request.user!.companyId, userId: request.user!.sub, eventType: "POLICY_VERSION_CONFIRMED", newValue: { policyVersionId: id, reviewStatus: "ACTIVE" } } });
      return tx.leavePolicyVersion.findUniqueOrThrow({ where: { id } });
    });
    return reply.send(updated);
  });

  app.post("/preview", { preHandler: readProtect }, async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    try {
      const scope = await visibleEmployeeIds(request.user!);
      if (!employeeIsVisible(parsed.data.employeeId, scope)) return reply.code(403).send({ error: "Forbidden", message: "Employee is outside your supervised sites" });
      return reply.send(await previewLeave({ companyId: request.user!.companyId, ...parsed.data }));
    } catch (error) {
      return sendLeaveError(reply, error);
    }
  });

  app.get("/applications", { preHandler: readProtect }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    try {
      const status = q.status ? applicationStatus.safeParse(q.status) : null;
      if (status && !status.success) return reply.code(400).send({ error: "Validation error", message: "Invalid leave status" });
      const scope = await visibleEmployeeIds(request.user!);
      if (q.employeeId && !employeeIsVisible(q.employeeId, scope)) return reply.code(403).send({ error: "Forbidden", message: "Employee is outside your supervised sites" });
      return reply.send(await listLeaveApplications(request.user!.companyId, {
        status: status?.success ? status.data : undefined,
        employeeId: q.employeeId,
        employeeIds: scope,
        leaveTypeCode: q.leaveTypeCode,
        start: q.start,
        end: q.end,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      }));
    } catch (error) {
      return sendLeaveError(reply, error);
    }
  });

  app.post("/applications", { preHandler: manageProtect }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const idempotencyKey = typeof request.headers["idempotency-key"] === "string" ? request.headers["idempotency-key"] : undefined;
    try {
      const result = await createLeaveApplication({ companyId: request.user!.companyId, actorId: request.user!.sub, source: "ADMIN", idempotencyKey, ...parsed.data });
      return reply.code(201).send(result);
    } catch (error) {
      return sendLeaveError(reply, error);
    }
  });

  app.get("/applications/:id", { preHandler: readProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getLeaveApplication(request.user!.companyId, id);
    if (!result) return reply.code(404).send({ error: "Not found", message: "Leave application not found" });
    const scope = await visibleEmployeeIds(request.user!);
    return employeeIsVisible(result.employeeId, scope) ? reply.send(result) : reply.code(403).send({ error: "Forbidden", message: "Employee is outside your supervised sites" });
  });

  app.post("/applications/:id/submit", { preHandler: editProtect }, async (request, reply) => {
    const parsed = z.object({ expectedVersion: z.number().int().positive().optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    try {
      return reply.send(await submitLeaveApplication({ companyId: request.user!.companyId, applicationId: (request.params as { id: string }).id, actorId: request.user!.sub, ...parsed.data }));
    } catch (error) { return sendLeaveError(reply, error); }
  });

  app.post("/applications/:id/decision", { preHandler: approveProtect }, async (request, reply) => {
    const parsed = decisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    try {
      return reply.send(await decideLeaveApplication({ companyId: request.user!.companyId, applicationId: (request.params as { id: string }).id, actorId: request.user!.sub, ...parsed.data }));
    } catch (error) {
      return sendLeaveError(reply, error);
    }
  });

  app.post("/applications/:id/cancel", { preHandler: approveProtect }, async (request, reply) => {
    const parsed = cancellationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    try {
      return reply.send(await cancelOrWithdrawLeave({ companyId: request.user!.companyId, applicationId: (request.params as { id: string }).id, actorId: request.user!.sub, reason: parsed.data.reason, expectedVersion: parsed.data.expectedVersion }));
    } catch (error) {
      return sendLeaveError(reply, error);
    }
  });

  app.post("/applications/:id/documents", { preHandler: manageProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const application = await prisma.leaveApplication.findFirst({ where: { id, companyId: request.user!.companyId } });
    if (!application) return reply.code(404).send({ error: "Not found", message: "Leave application not found" });
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No file", message: "Please attach a supporting document" });
    if (!ALLOWED_DOCUMENT_TYPES.has(data.mimetype)) return reply.code(400).send({ error: "Invalid file type", message: "Allowed file types: PDF, JPEG, PNG, or WebP" });
    let buffer: Buffer;
    try {
      buffer = await readStreamToBuffer(data.file, MAX_DOCUMENT_BYTES);
    } catch {
      return reply.code(400).send({ error: "File too large", message: "Maximum file size is 10MB" });
    }
    if (!matchesMagicBytes(buffer, data.mimetype)) {
      return reply.code(400).send({ error: "Invalid file", message: "File content does not match the declared type" });
    }
    const documentTypeField = data.fields.documentType as { value?: unknown } | undefined;
    const documentType = typeof documentTypeField?.value === "string" ? documentTypeField.value.trim() : "supporting_document";
    const ext = data.mimetype === "application/pdf" ? "pdf" : data.mimetype.split("/")[1] || "bin";
    const key = `leave-private/${request.user!.companyId}/${application.id}/${randomUUID()}.${ext}`;
    await storage.uploadFile({ key, body: buffer, contentType: data.mimetype });
    const document = await persistWithUploadedFileRollback(
      key,
      () => prisma.$transaction(async (tx) => {
        const created = await tx.leaveApplicationDocument.create({ data: { applicationId: application.id, documentType, fileUrl: storage.getAssetUrl(key), fileName: sanitizeUploadFilename(data.filename || `document.${ext}`, data.mimetype), mimeType: data.mimetype, fileSize: buffer.length, uploadedById: request.user!.sub } });
        await tx.leaveAuditEvent.create({ data: { companyId: request.user!.companyId, employeeId: application.employeeId, applicationId: application.id, userId: request.user!.sub, eventType: "DOCUMENT_UPLOADED", newValue: { documentId: created.id, documentType, fileName: created.fileName } } });
        return created;
      }),
      { onCleanupError: (cleanupError) => request.log.error({ err: cleanupError, key }, "Failed to remove leave document after database rollback") }
    );
    return reply.code(201).send(withoutDocumentStoragePath(document));
  });

  app.post("/documents/:id/verify", { preHandler: approveProtect }, async (request, reply) => {
    const body = z.object({ decision: z.enum(["verify", "reject"]), note: z.string().max(2000).optional() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Validation error", message: body.error.flatten().fieldErrors });
    const document = await prisma.leaveApplicationDocument.findFirst({ where: { id: (request.params as { id: string }).id, application: { companyId: request.user!.companyId } }, include: { application: true } });
    if (!document) return reply.code(404).send({ error: "Not found", message: "Document not found" });
    const updated = await prisma.leaveApplicationDocument.update({ where: { id: document.id }, data: { reviewStatus: body.data.decision === "verify" ? "VERIFIED" : "REJECTED", verifiedById: request.user!.sub, verifiedAt: new Date(), reviewNote: body.data.note } });
    await prisma.leaveAuditEvent.create({ data: { companyId: request.user!.companyId, employeeId: document.application.employeeId, applicationId: document.applicationId, userId: request.user!.sub, eventType: body.data.decision === "verify" ? "DOCUMENT_VERIFIED" : "DOCUMENT_REJECTED", reason: body.data.note, newValue: { documentId: document.id, reviewStatus: updated.reviewStatus } } });
    return reply.send(withoutDocumentStoragePath(updated));
  });

  app.get("/documents/:id/download", { preHandler: exportProtect }, async (request, reply) => {
    const document = await prisma.leaveApplicationDocument.findFirst({
      where: { id: (request.params as { id: string }).id, application: { companyId: request.user!.companyId } },
      include: { application: { select: { employeeId: true } } },
    });
    if (!document) return reply.code(404).send({ error: "Not found", message: "Document not found" });
    const scope = await visibleEmployeeIds(request.user!);
    if (!employeeIsVisible(document.application.employeeId, scope)) return reply.code(403).send({ error: "Forbidden", message: "Employee is outside your supervised sites" });
    return sendPrivateStoredFile(reply, {
      storedReference: document.fileUrl,
      allowedPrefixes: [
        `leave-private/${request.user!.companyId}`,
        `leave-sick-notes/${request.user!.companyId}`,
      ],
      fileName: document.fileName,
      mimeType: document.mimeType,
    });
  });

  app.get("/balances", { preHandler: readProtect }, async (request, reply) => {
    const q = request.query as { employeeId?: string; asOf?: string };
    try {
      const scope = await visibleEmployeeIds(request.user!);
      if (q.employeeId && !employeeIsVisible(q.employeeId, scope)) return reply.code(403).send({ error: "Forbidden", message: "Employee is outside your supervised sites" });
      return reply.send({ data: await getLeaveBalances(request.user!.companyId, q.employeeId, q.asOf ? normalizeDate(q.asOf) : new Date(), scope) });
    } catch (error) {
      return sendLeaveError(reply, error);
    }
  });

  app.get("/employment-terms", { preHandler: manageProtect }, async (request, reply) => {
    const employeeId = (request.query as { employeeId?: string }).employeeId;
    const data = await prisma.employmentTerm.findMany({ where: { companyId: request.user!.companyId, ...(employeeId ? { employeeId } : {}) }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } } }, orderBy: [{ employeeId: "asc" }, { effectiveFrom: "desc" }] });
    return reply.send({ data });
  });

  app.post("/employment-terms", { preHandler: manageProtect }, async (request, reply) => {
    const parsed = employmentTermSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const employee = await prisma.employee.findFirst({ where: { id: parsed.data.employeeId, companyId: request.user!.companyId }, select: { id: true } });
    if (!employee) return reply.code(404).send({ error: "Not found", message: "Employee not found" });
    const effectiveFrom = normalizeDate(parsed.data.effectiveFrom);
    const effectiveTo = parsed.data.effectiveTo ? normalizeDate(parsed.data.effectiveTo) : null;
    if (effectiveTo && effectiveTo < effectiveFrom) return reply.code(400).send({ error: "Validation error", message: "effectiveTo must be on or after effectiveFrom" });
    const overlap = await prisma.employmentTerm.findFirst({ where: { employeeId: employee.id, effectiveFrom: { lte: effectiveTo ?? new Date("9999-12-31") }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] } });
    if (overlap) return reply.code(409).send({ error: "Employment term overlap", message: "Employment terms cannot overlap; close the existing term first" });
    const { employeeId: _employeeId, ...data } = parsed.data;
    const term = await prisma.employmentTerm.create({ data: { companyId: request.user!.companyId, employeeId: employee.id, ...data, workingPattern: data.workingPattern as Prisma.InputJsonValue | undefined, effectiveFrom, effectiveTo } });
    await prisma.leaveAuditEvent.create({ data: { companyId: request.user!.companyId, employeeId: employee.id, userId: request.user!.sub, eventType: "EMPLOYMENT_TERM_CREATED", newValue: { employmentTermId: term.id, effectiveFrom: parsed.data.effectiveFrom, effectiveTo: parsed.data.effectiveTo ?? null } } });
    return reply.code(201).send(term);
  });

  app.post("/policy-assignments", { preHandler: manageProtect }, async (request, reply) => {
    const parsed = z.object({ employeeId: z.string().min(1), policyId: z.string().min(1), effectiveFrom: z.string().regex(DATE), effectiveTo: z.string().regex(DATE).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    const [employee, policy] = await Promise.all([prisma.employee.findFirst({ where: { id: parsed.data.employeeId, companyId: request.user!.companyId }, select: { id: true } }), prisma.leavePolicy.findFirst({ where: { id: parsed.data.policyId, companyId: request.user!.companyId }, select: { id: true } })]);
    if (!employee || !policy) return reply.code(404).send({ error: "Not found", message: "Employee or policy not found" });
    const effectiveFrom = normalizeDate(parsed.data.effectiveFrom);
    const effectiveTo = parsed.data.effectiveTo ? normalizeDate(parsed.data.effectiveTo) : null;
    if (effectiveTo && effectiveTo < effectiveFrom) return reply.code(400).send({ error: "Validation error", message: "effectiveTo must be on or after effectiveFrom" });
    const overlap = await prisma.employeeLeavePolicyAssignment.findFirst({
      where: {
        employeeId: employee.id,
        effectiveFrom: { lte: effectiveTo ?? new Date("9999-12-31T00:00:00.000Z") },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
      },
    });
    if (overlap) return reply.code(409).send({ error: "Policy assignment overlap", message: "An employee can have only one leave policy assignment for a date" });
    const assignment = await prisma.employeeLeavePolicyAssignment.create({ data: { employeeId: employee.id, policyId: policy.id, effectiveFrom, effectiveTo } });
    return reply.code(201).send(assignment);
  });

  app.get("/calendar", { preHandler: readProtect }, async (request, reply) => {
    const q = request.query as { start?: string; end?: string };
    if (!q.start || !q.end) return reply.code(400).send({ error: "Validation error", message: "start and end are required" });
    try {
      return reply.send({ data: await getLeaveCalendar(request.user!.companyId, q.start, q.end, await visibleEmployeeIds(request.user!)) });
    } catch (error) {
      return sendLeaveError(reply, error);
    }
  });

  app.get("/reports", { preHandler: readProtect }, async (request, reply) => {
    const q = request.query as { start?: string; end?: string };
    if (!q.start || !q.end) return reply.code(400).send({ error: "Validation error", message: "start and end are required" });
    try {
      return reply.send(await getLeaveReport(request.user!.companyId, q.start, q.end, await visibleEmployeeIds(request.user!)));
    } catch (error) {
      return sendLeaveError(reply, error);
    }
  });

  app.post("/adjustments", { preHandler: approveProtect }, async (request, reply) => {
    const parsed = adjustmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    try {
      return reply.code(201).send(await createOpeningBalanceAdjustment({ companyId: request.user!.companyId, actorId: request.user!.sub, ...parsed.data }));
    } catch (error) {
      return sendLeaveError(reply, error);
    }
  });

  app.get("/adjustments", { preHandler: manageProtect }, async (request, reply) => {
    const rawStatus = (request.query as { status?: string }).status;
    const status = rawStatus ? adjustmentStatusSchema.safeParse(rawStatus) : null;
    if (status && !status.success) return reply.code(400).send({ error: "Validation error", message: "Invalid adjustment status" });
    return reply.send({ data: await listLeaveAdjustments(request.user!.companyId, status?.success ? status.data : undefined) });
  });

  app.post("/adjustments/:id/resolve", { preHandler: approveProtect }, async (request, reply) => {
    const parsed = adjustmentResolutionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    try {
      return reply.send(await resolveLeaveAdjustment({ companyId: request.user!.companyId, adjustmentId: (request.params as { id: string }).id, actorId: request.user!.sub, ...parsed.data }));
    } catch (error) {
      return sendLeaveError(reply, error);
    }
  });

  app.post("/accruals/run", { preHandler: approveProtect }, async (request, reply) => {
    const parsed = z.object({ asOf: z.string().regex(DATE) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    try { return reply.send(await accrueConfirmedLeave({ companyId: request.user!.companyId, actorId: request.user!.sub, asOf: parsed.data.asOf })); }
    catch (error) { return sendLeaveError(reply, error); }
  });

  app.get("/audit", { preHandler: manageProtect }, async (request, reply) => {
    const q = request.query as { applicationId?: string; employeeId?: string; limit?: string };
    const data = await prisma.leaveAuditEvent.findMany({
      where: { companyId: request.user!.companyId, ...(q.applicationId ? { applicationId: q.applicationId } : {}), ...(q.employeeId ? { employeeId: q.employeeId } : {}) },
      include: { user: { select: { id: true, name: true } }, employee: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { occurredAt: "desc" },
      take: Math.min(Number(q.limit) || 200, 500),
    });
    return reply.send({ data });
  });
}

function normalizeDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!DATE.test(value.slice(0, 10)) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new LeaveManagementError("Invalid date; use YYYY-MM-DD");
  }
  return date;
}
