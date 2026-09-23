import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { requireAnyCapability, requireCapability, requireCrudCapability } from "../../middleware/authorization.js";
import { hasCapability } from "../../lib/capabilities.js";
import { canAccessSensitiveData } from "../../lib/sensitive-data.js";
import { readStreamToBuffer, storage } from "../../lib/storage.js";
import {
  privateDownloadUrl,
  sendPrivateStoredFile,
} from "../../lib/private-download.js";
import {
  extensionForMime,
  matchesMagicBytes,
  sanitizeUploadFilename,
} from "../../lib/upload-validation.js";
import {
  createDocumentRecord,
  listDocuments,
  syncDocumentExpiryAlerts,
  validateDocumentReferences,
  updateDocumentMetadata,
  verifyDocument,
  rejectDocument,
} from "./documents.service.js";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_TAXONOMY,
  evaluateExpiryState,
  getDocumentDefinition,
} from "./compliance.service.js";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import {
  listDocumentVersions,
  getDocumentVersion,
  createDocumentVersion,
  readDocumentFileBuffer,
} from "./document-version.service.js";
import { PdfManipulationService } from "./pdf-manipulation.service.js";
import { getSourceEntityInfo, regenerateDocumentPdf } from "./generated-document.service.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];

const metaSchema = z.object({
  title: z.string().min(1),
  documentType: z.string().min(1),
  category: z.enum([
    "EMPLOYEE",
    "SITE",
    "CLIENT",
    "PAYROLL",
    "ATTENDANCE",
    "INCIDENT",
    "EQUIPMENT",
    "COMPLIANCE",
    "TASK",
    "BILLING",
    "REPORT",
    "ACADEMY",
    "OTHER",
  ]).default("EMPLOYEE"),
  documentCategory: z.string().optional().nullable(),
  documentNumber: z.string().optional().nullable(),
  issuingAuthority: z.string().optional().nullable(),
  issueDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  doesNotExpire: z.preprocess((val) => val === "true" || val === true, z.boolean()).optional(),
  isSensitive: z.preprocess((val) => val === "true" || val === true, z.boolean()).optional(),
  origin: z.enum(["UPLOADED", "GENERATED"]).optional(),
  sourceModule: z.string().optional().nullable(),
  sourceEntityType: z.string().optional().nullable(),
  sourceEntityId: z.string().optional().nullable(),
  lifecycleStatus: z.enum(["DRAFT", "REVIEW", "FINAL", "SUPERSEDED", "ARCHIVED"]).optional(),
  employeeId: z.string().optional().nullable(),
  siteId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  clientContractId: z.string().optional().nullable(),
  incidentId: z.string().optional().nullable(),
  taskId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateMetaSchema = z.object({
  title: z.string().min(1).optional(),
  category: z.string().optional().nullable(),
  documentType: z.string().min(1).optional(),
  documentCategory: z.string().optional().nullable(),
  documentNumber: z.string().optional().nullable(),
  issuingAuthority: z.string().optional().nullable(),
  issueDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  doesNotExpire: z.boolean().optional(),
  isSensitive: z.boolean().optional(),
  clientContractId: z.string().optional().nullable(),
  lifecycleStatus: z.enum(["DRAFT", "REVIEW", "FINAL", "SUPERSEDED", "ARCHIVED"]).optional(),
  notes: z.string().optional().nullable(),
});

const rotateSchema = z.object({
  pageIndices: z.array(z.number().int().min(0)).optional(),
  angleDegrees: z.number().int().optional(),
});

const reorderSchema = z.object({
  pageOrder: z.array(z.number().int().min(0)),
});

const deletePagesSchema = z.object({
  pageIndices: z.array(z.number().int().min(0)).min(1),
});

const stampSchema = z.object({
  pageIndex: z.number().int().min(0).optional(),
  signerRole: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

function isDocumentSensitive(doc: { isSensitive?: boolean; documentCategory?: string | null; documentType?: string }): boolean {
  if (doc.isSensitive) return true;
  const cat = (doc.documentCategory ?? "").toUpperCase();
  if (cat === "LEAVE_MEDICAL" || cat === "DISCIPLINARY" || cat === "FIREARM" || cat === "CLIENT_IDENTITY") return true;
  const def = getDocumentDefinition(doc.documentType ?? "");
  return Boolean(def.isSensitive);
}

function isClientDocument(doc: {
  category?: string;
  documentCategory?: string | null;
  clientId?: string | null;
  clientContractId?: string | null;
}): boolean {
  if (doc.clientId || doc.clientContractId) return true;
  if (doc.category === "CLIENT") return true;
  const cat = (doc.documentCategory ?? "").toUpperCase();
  return cat.startsWith("CLIENT_");
}

function canUserAccessDocument(
  user: import("../../lib/types.js").AuthenticatedUser,
  doc: {
    isSensitive?: boolean;
    category?: string;
    documentCategory?: string | null;
    documentType?: string;
    clientId?: string | null;
    clientContractId?: string | null;
  }
): boolean {
  if (user.isOwner) return true;
  if (!isDocumentSensitive(doc)) return true;

  // Least privilege: Sensitive client evidence requires client view_sensitive or documents view_sensitive.
  // Employee or payroll sensitive capabilities never leak client-sensitive documents.
  if (isClientDocument(doc)) {
    return (
      canAccessSensitiveData(user, "/clients") ||
      hasCapability(user, "/documents", "view_sensitive")
    );
  }

  return (
    canAccessSensitiveData(user, "/employees") ||
    canAccessSensitiveData(user, "/payroll") ||
    hasCapability(user, "/documents", "view_sensitive")
  );
}

export async function documentsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({ anyOfModules: ["/documents", "/employees", "/clients"] }),
  ];

  const forUser = <
    T extends {
      id: string;
      fileUrl: string;
      expiryDate?: Date | null;
      doesNotExpire?: boolean;
      documentType?: string;
      sourceModule?: string | null;
      sourceEntityType?: string | null;
      sourceEntityId?: string | null;
      origin?: string;
      lifecycleStatus?: string;
    }
  >(
    document: T,
    canExport: boolean
  ) => {
    const { fileUrl: _fileUrl, ...metadata } = document;
    const expiryState = evaluateExpiryState(document.expiryDate, document.doesNotExpire);
    const typeDefinition = document.documentType ? getDocumentDefinition(document.documentType) : undefined;
    const sourceInfo = getSourceEntityInfo(
      document.sourceModule,
      document.sourceEntityType,
      document.sourceEntityId
    );
    return {
      ...metadata,
      expiryState,
      typeDefinition,
      sourceInfo,
      viewUrl: privateDownloadUrl(`/documents/${document.id}/file`),
      ...(canExport ? { downloadUrl: privateDownloadUrl(`/documents/${document.id}/download`) } : {}),
    };
  };

  app.get("/taxonomy", { preHandler: authMiddleware }, async (_request, reply) => {
    return reply.send({
      categories: DOCUMENT_CATEGORIES,
      taxonomy: DOCUMENT_TAXONOMY,
    });
  });

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const result = await listDocuments(user.companyId, {
      category: q.category as never,
      documentCategory: q.documentCategory,
      verificationStatus: q.verificationStatus,
      status: q.status as never,
      origin: q.origin as never,
      lifecycleStatus: q.lifecycleStatus as never,
      employeeId: q.employeeId,
      siteId: q.siteId,
      clientId: q.clientId,
      search: q.q || q.search,
      expiringWithinDays: q.expiringWithinDays ? Number(q.expiringWithinDays) : undefined,
      limit: q.limit ? Number(q.limit) : 50,
      offset: q.offset ? Number(q.offset) : 0,
    });

    const canExport = hasCapability(user, "/documents", "export");
    // Filter sensitive documents if user does not have sensitive capability
    const items = result.items
      .filter((doc) => canUserAccessDocument(user, doc))
      .map((document) => forUser(document, canExport));

    return reply.send({
      ...result,
      items,
      total: items.length,
    });
  });

  app.post("/sync-expiry-alerts", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const result = await syncDocumentExpiryAlerts(user.companyId);
    return reply.send(result);
  });

  app.post("/upload", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "No file", message: "Please select a file to upload" });
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readStreamToBuffer(data.file, MAX_FILE_SIZE);
    } catch (err) {
      if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
        return reply.code(400).send({
          error: "File too large",
          message: "Maximum file size is 10MB",
        });
      }
      return reply.code(500).send({ error: "Upload failed", message: "Could not read the file" });
    }

    const fields: Record<string, string> = {};
    for (const [key, val] of Object.entries(data.fields)) {
      const f = val as { value?: string } | undefined;
      if (f && typeof f.value === "string") fields[key] = f.value;
    }

    const parsed = metaSchema.safeParse(fields);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.issues[0]?.message ?? "Missing document details",
      });
    }

    // Resolve category and sensitivity
    const docDef = getDocumentDefinition(parsed.data.documentType);
    const resolvedDocCategory = parsed.data.documentCategory || docDef.category || "PERSONAL";
    const resolvedIsSensitive = parsed.data.isSensitive ?? docDef.isSensitive ?? false;

    // Check sensitive document upload permission
    if (
      resolvedIsSensitive &&
      !canUserAccessDocument(user, {
        isSensitive: true,
        documentCategory: resolvedDocCategory,
        documentType: parsed.data.documentType,
        clientId: parsed.data.clientId,
        clientContractId: parsed.data.clientContractId,
      })
    ) {
      return reply.code(403).send({
        error: "Forbidden",
        message: "Sensitive access permissions required for this document",
      });
    }

    const referenceError = await validateDocumentReferences(user.companyId, parsed.data);
    if (referenceError) {
      return reply.code(400).send({ error: "Validation error", message: referenceError });
    }

    const mimetype = data.mimetype;
    if (!ALLOWED_TYPES.includes(mimetype)) {
      return reply.code(400).send({
        error: "Invalid file type",
        message: "Allowed: PDF, JPG, PNG, GIF, WebP, Word, Excel, text, CSV",
      });
    }

    if (!matchesMagicBytes(fileBuffer, mimetype)) {
      return reply.code(400).send({
        error: "Invalid file",
        message: "File content does not match the declared type",
      });
    }

    const ext = extensionForMime(mimetype);
    const filename = `${randomUUID()}.${ext}`;
    const key = `documents/${user.companyId}/${filename}`;

    try {
      await storage.uploadFile({ key, body: fileBuffer, contentType: mimetype });
    } catch {
      return reply.code(500).send({ error: "Upload failed", message: "Could not save the file" });
    }

    const url = storage.getAssetUrl(key);
    const doc = await createDocumentRecord({
      companyId: user.companyId,
      uploadedById: user.sub,
      title: parsed.data.title,
      documentType: parsed.data.documentType,
      category: parsed.data.category,
      documentCategory: resolvedDocCategory,
      documentNumber: parsed.data.documentNumber,
      issuingAuthority: parsed.data.issuingAuthority || docDef.defaultAuthority,
      issueDate: parsed.data.issueDate ? new Date(parsed.data.issueDate) : null,
      expiryDate: parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : null,
      doesNotExpire: parsed.data.doesNotExpire,
      isSensitive: resolvedIsSensitive,
      fileUrl: url,
      fileName: sanitizeUploadFilename(data.filename || filename, mimetype),
      mimeType: mimetype,
      size: fileBuffer.length,
      employeeId: parsed.data.employeeId,
      siteId: parsed.data.siteId,
      clientId: parsed.data.clientId,
      clientContractId: parsed.data.clientContractId,
      incidentId: parsed.data.incidentId,
      taskId: parsed.data.taskId,
      notes: parsed.data.notes,
    });

    return reply.code(201).send(
      forUser(doc, hasCapability(user, "/documents", "export"))
    );
  });

  app.get(
    "/:id/download",
    { preHandler: [authMiddleware, requireAnyCapability(["/documents", "/employees", "/clients"], "export")] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const document = await prisma.managedDocument.findFirst({
        where: { id, companyId: user.companyId },
      });
      if (!document) {
        return reply.code(404).send({ error: "Not found", message: "Document not found" });
      }

      if (!canUserAccessDocument(user, document)) {
        return reply.code(403).send({ error: "Forbidden", message: "Access to this sensitive document is restricted" });
      }

      return sendPrivateStoredFile(reply, {
        storedReference: document.fileUrl,
        allowedPrefixes: [`documents/${user.companyId}`],
        fileName: document.fileName,
        mimeType: document.mimeType,
      });
    }
  );

  app.get("/:id", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const doc = await prisma.managedDocument.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        site: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        clientContract: { select: { id: true, contractNumber: true, title: true } },
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        uploadedBy: { select: { id: true, name: true, email: true } },
        verifiedBy: { select: { id: true, name: true, email: true } },
        currentVersion: {
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
          },
        },
        versions: {
          orderBy: { versionNumber: "desc" },
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (!doc) {
      return reply.code(404).send({ error: "Not found", message: "Document not found" });
    }

    if (!canUserAccessDocument(user, doc)) {
      return reply.code(403).send({ error: "Forbidden", message: "Access to this sensitive document is restricted" });
    }

    const canExport = hasCapability(user, "/documents", "export");
    const canEdit = hasCapability(user, "/documents", "edit");
    const canApprove = hasCapability(user, "/documents", "approve") || user.isOwner;

    return reply.send({
      ...forUser(doc, canExport),
      permissions: {
        canEdit,
        canExport,
        canApprove,
      },
    });
  });

  app.get("/:id/file", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const query = request.query as { versionId?: string };

    const doc = await prisma.managedDocument.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!doc) {
      return reply.code(404).send({ error: "Not found", message: "Document not found" });
    }

    if (!canUserAccessDocument(user, doc)) {
      return reply.code(403).send({ error: "Forbidden", message: "Access to this sensitive document is restricted" });
    }

    const fileData = await readDocumentFileBuffer(user.companyId, id, query.versionId);
    if (!fileData) {
      return reply.code(404).send({ error: "Not found", message: "Document file not found" });
    }

    const safeName = fileData.fileName.replace(/[\u0000-\u001F\u007F"\\]/g, "_").trim() || "document.pdf";
    return reply
      .header("content-type", fileData.mimeType || "application/pdf")
      .header("content-disposition", `inline; filename="${safeName}"`)
      .header("content-length", String(fileData.buffer.length))
      .header("cache-control", "private, no-cache, no-store, must-revalidate")
      .send(fileData.buffer);
  });

  app.get("/:id/versions", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const doc = await prisma.managedDocument.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!doc) {
      return reply.code(404).send({ error: "Not found", message: "Document not found" });
    }
    if (!canUserAccessDocument(user, doc)) {
      return reply.code(403).send({ error: "Forbidden", message: "Access to this sensitive document is restricted" });
    }

    const versions = await listDocumentVersions(user.companyId, id);
    return reply.send({ versions });
  });

  app.get(
    "/:id/versions/:versionId/download",
    { preHandler: [authMiddleware, requireAnyCapability(["/documents", "/employees", "/clients"], "export")] },
    async (request, reply) => {
      const user = request.user!;
      const { id, versionId } = request.params as { id: string; versionId: string };

      const doc = await prisma.managedDocument.findFirst({
        where: { id, companyId: user.companyId },
      });
      if (!doc) {
        return reply.code(404).send({ error: "Not found", message: "Document not found" });
      }
      if (!canUserAccessDocument(user, doc)) {
        return reply.code(403).send({ error: "Forbidden", message: "Access to this sensitive document is restricted" });
      }

      const fileData = await readDocumentFileBuffer(user.companyId, id, versionId);
      if (!fileData) {
        return reply.code(404).send({ error: "Not found", message: "Version file not found" });
      }

      const safeName = fileData.fileName.replace(/[\u0000-\u001F\u007F"\\]/g, "_").trim() || "document.pdf";
      return reply
        .header("content-type", fileData.mimeType || "application/octet-stream")
        .header("content-disposition", `attachment; filename="${safeName}"`)
        .header("content-length", String(fileData.buffer.length))
        .send(fileData.buffer);
    }
  );

  app.post("/:id/versions", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const doc = await prisma.managedDocument.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!doc) return reply.code(404).send({ error: "Not found", message: "Document not found" });
    if (!canUserAccessDocument(user, doc)) return reply.code(403).send({ error: "Forbidden", message: "Access restricted" });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No file", message: "Please select a file to upload as new revision" });

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readStreamToBuffer(data.file, MAX_FILE_SIZE);
    } catch {
      return reply.code(400).send({ error: "File too large", message: "Maximum file size is 10MB" });
    }

    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.fields)) {
      const f = v as { value?: string } | undefined;
      if (f && typeof f.value === "string") fields[k] = f.value;
    }

    const mimetype = data.mimetype;
    if (!ALLOWED_TYPES.includes(mimetype) || !matchesMagicBytes(fileBuffer, mimetype)) {
      return reply.code(400).send({ error: "Invalid file", message: "File type is not allowed or content mismatch" });
    }

    const result = await createDocumentVersion({
      companyId: user.companyId,
      documentId: id,
      userId: user.sub,
      fileBuffer,
      fileName: data.filename || `revision-${Date.now()}`,
      mimeType: mimetype,
      changeSummary: fields.changeSummary || "New uploaded version",
      sourceType: "MANUAL_REVISION",
    });

    return reply.code(201).send(forUser(result.document, hasCapability(user, "/documents", "export")));
  });

  app.post("/:id/pdf/rotate", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const doc = await prisma.managedDocument.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!doc) return reply.code(404).send({ error: "Not found", message: "Document not found" });
    if (!canUserAccessDocument(user, doc)) return reply.code(403).send({ error: "Forbidden", message: "Access restricted" });
    if (doc.mimeType !== "application/pdf") {
      return reply.code(400).send({ error: "Unsupported operation", message: "Page rotation is only supported for PDF documents" });
    }

    const parsed = rotateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.issues[0]?.message ?? "Invalid rotation parameters" });
    }

    const fileData = await readDocumentFileBuffer(user.companyId, id);
    if (!fileData) return reply.code(404).send({ error: "Not found", message: "Document file not found" });

    const angle = parsed.data.angleDegrees ?? 90;
    const modifiedBuffer = await PdfManipulationService.rotatePages(fileData.buffer, {
      pageIndices: parsed.data.pageIndices,
      angleDegrees: angle,
    });

    const result = await createDocumentVersion({
      companyId: user.companyId,
      documentId: id,
      userId: user.sub,
      fileBuffer: modifiedBuffer,
      fileName: fileData.fileName,
      mimeType: "application/pdf",
      changeSummary: `Rotated page(s) by ${angle}°`,
      sourceType: "PAGE_ROTATION",
    });

    return reply.send(forUser(result.document, hasCapability(user, "/documents", "export")));
  });

  app.post("/:id/pdf/reorder", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const doc = await prisma.managedDocument.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!doc) return reply.code(404).send({ error: "Not found", message: "Document not found" });
    if (!canUserAccessDocument(user, doc)) return reply.code(403).send({ error: "Forbidden", message: "Access restricted" });
    if (doc.mimeType !== "application/pdf") {
      return reply.code(400).send({ error: "Unsupported operation", message: "Page reordering is only supported for PDF documents" });
    }

    const parsed = reorderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.issues[0]?.message ?? "Invalid page order" });
    }

    const fileData = await readDocumentFileBuffer(user.companyId, id);
    if (!fileData) return reply.code(404).send({ error: "Not found", message: "Document file not found" });

    const modifiedBuffer = await PdfManipulationService.reorderPages(fileData.buffer, {
      pageOrder: parsed.data.pageOrder,
    });

    const result = await createDocumentVersion({
      companyId: user.companyId,
      documentId: id,
      userId: user.sub,
      fileBuffer: modifiedBuffer,
      fileName: fileData.fileName,
      mimeType: "application/pdf",
      changeSummary: "Reordered document pages",
      sourceType: "PAGE_REORDER",
    });

    return reply.send(forUser(result.document, hasCapability(user, "/documents", "export")));
  });

  app.post("/:id/pdf/delete-page", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const doc = await prisma.managedDocument.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!doc) return reply.code(404).send({ error: "Not found", message: "Document not found" });
    if (!canUserAccessDocument(user, doc)) return reply.code(403).send({ error: "Forbidden", message: "Access restricted" });
    if (doc.mimeType !== "application/pdf") {
      return reply.code(400).send({ error: "Unsupported operation", message: "Page deletion is only supported for PDF documents" });
    }

    const parsed = deletePagesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.issues[0]?.message ?? "Invalid delete parameters" });
    }

    const fileData = await readDocumentFileBuffer(user.companyId, id);
    if (!fileData) return reply.code(404).send({ error: "Not found", message: "Document file not found" });

    const modifiedBuffer = await PdfManipulationService.deletePages(fileData.buffer, {
      pageIndices: parsed.data.pageIndices,
    });

    const result = await createDocumentVersion({
      companyId: user.companyId,
      documentId: id,
      userId: user.sub,
      fileBuffer: modifiedBuffer,
      fileName: fileData.fileName,
      mimeType: "application/pdf",
      changeSummary: `Deleted ${parsed.data.pageIndices.length} page(s)`,
      sourceType: "PAGE_DELETION",
    });

    return reply.send(forUser(result.document, hasCapability(user, "/documents", "export")));
  });

  app.post("/:id/pdf/stamp", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const doc = await prisma.managedDocument.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!doc) return reply.code(404).send({ error: "Not found", message: "Document not found" });
    if (!canUserAccessDocument(user, doc)) return reply.code(403).send({ error: "Forbidden", message: "Access restricted" });
    if (doc.mimeType !== "application/pdf") {
      return reply.code(400).send({ error: "Unsupported operation", message: "Signature stamps are only supported for PDF documents" });
    }

    const parsed = stampSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.issues[0]?.message ?? "Invalid stamp parameters" });
    }

    const fileData = await readDocumentFileBuffer(user.companyId, id);
    if (!fileData) return reply.code(404).send({ error: "Not found", message: "Document file not found" });

    const modifiedBuffer = await PdfManipulationService.applySignatureStamp(fileData.buffer, {
      pageIndex: parsed.data.pageIndex,
      signerName: user.name || user.email || "Authorized Signer",
      signerRole: parsed.data.signerRole || (user.isOwner ? "Company Owner" : "Authorized User"),
      documentTitle: doc.title,
      notes: parsed.data.notes,
      x: parsed.data.x,
      y: parsed.data.y,
    });

    const result = await createDocumentVersion({
      companyId: user.companyId,
      documentId: id,
      userId: user.sub,
      fileBuffer: modifiedBuffer,
      fileName: fileData.fileName,
      mimeType: "application/pdf",
      changeSummary: `Applied electronic signature mark by ${user.name || user.email}`,
      sourceType: "SIGNATURE_STAMP",
    });

    return reply.send(forUser(result.document, hasCapability(user, "/documents", "export")));
  });

  app.post("/:id/regenerate", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    try {
      const result = await regenerateDocumentPdf(user.companyId, id, user.sub);
      return reply.send(forUser(result.document, hasCapability(user, "/documents", "export")));
    } catch (err: any) {
      return reply.code(400).send({
        error: "Regeneration failed",
        message: err?.message || "Could not regenerate PDF from source data",
      });
    }
  });

  app.post("/:id/finalize", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const doc = await prisma.managedDocument.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!doc) return reply.code(404).send({ error: "Not found", message: "Document not found" });

    const updated = await prisma.managedDocument.update({
      where: { id },
      data: { lifecycleStatus: "FINAL" },
      include: {
        site: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        currentVersion: true,
        uploadedBy: { select: { id: true, name: true, email: true } },
        verifiedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "document.finalize",
      entityType: "ManagedDocument",
      entityId: id,
    });

    return reply.send(forUser(updated, hasCapability(user, "/documents", "export")));
  });

  app.patch("/:id", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = updateMetaSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.issues[0]?.message ?? "Invalid metadata",
      });
    }

    const updated = await updateDocumentMetadata(user.companyId, id, user.sub, {
      title: parsed.data.title,
      category: parsed.data.category ?? undefined,
      documentType: parsed.data.documentType,
      documentCategory: parsed.data.documentCategory,
      documentNumber: parsed.data.documentNumber,
      issuingAuthority: parsed.data.issuingAuthority,
      issueDate: parsed.data.issueDate ? new Date(parsed.data.issueDate) : undefined,
      expiryDate: parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : undefined,
      doesNotExpire: parsed.data.doesNotExpire,
      isSensitive: parsed.data.isSensitive,
      clientContractId: parsed.data.clientContractId,
      notes: parsed.data.notes,
    });

    if (!updated) {
      return reply.code(404).send({ error: "Not found", message: "Document not found" });
    }

    return reply.send(forUser(updated, hasCapability(user, "/documents", "export")));
  });

  app.post("/:id/verify", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const updated = await verifyDocument(user.companyId, id, user.sub);
    if (!updated) {
      return reply.code(404).send({ error: "Not found", message: "Document not found" });
    }

    return reply.send(forUser(updated, hasCapability(user, "/documents", "export")));
  });

  app.post("/:id/reject", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = request.body as { rejectionReason?: string } | undefined;
    const reason = body?.rejectionReason?.trim() || "Document details or authenticity could not be verified";

    const updated = await rejectDocument(user.companyId, id, user.sub, reason);
    if (!updated) {
      return reply.code(404).send({ error: "Not found", message: "Document not found" });
    }

    return reply.send(forUser(updated, hasCapability(user, "/documents", "export")));
  });

  app.patch("/:id/archive", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const doc = await prisma.managedDocument.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!doc) {
      return reply.code(404).send({ error: "Not found", message: "Document not found" });
    }
    const updated = await prisma.managedDocument.update({
      where: { id },
      data: { status: "ARCHIVED" },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        uploadedBy: { select: { id: true, name: true, email: true } },
        verifiedBy: { select: { id: true, name: true, email: true } },
      },
    });
    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "document.archive",
      entityType: "ManagedDocument",
      entityId: id,
    });
    return reply.send(
      forUser(updated, hasCapability(user, "/documents", "export"))
    );
  });
}
