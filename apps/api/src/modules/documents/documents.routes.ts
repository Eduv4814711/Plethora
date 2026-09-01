import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability, requireCrudCapability } from "../../middleware/authorization.js";
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
    "OTHER",
  ]).default("EMPLOYEE"),
  documentCategory: z.string().optional().nullable(),
  documentNumber: z.string().optional().nullable(),
  issuingAuthority: z.string().optional().nullable(),
  issueDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  doesNotExpire: z.preprocess((val) => val === "true" || val === true, z.boolean()).optional(),
  isSensitive: z.preprocess((val) => val === "true" || val === true, z.boolean()).optional(),
  employeeId: z.string().optional().nullable(),
  siteId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  incidentId: z.string().optional().nullable(),
  taskId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateMetaSchema = z.object({
  title: z.string().min(1).optional(),
  documentType: z.string().min(1).optional(),
  documentCategory: z.string().optional().nullable(),
  documentNumber: z.string().optional().nullable(),
  issuingAuthority: z.string().optional().nullable(),
  issueDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  doesNotExpire: z.boolean().optional(),
  isSensitive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

function isDocumentSensitive(doc: { isSensitive?: boolean; documentCategory?: string | null; documentType?: string }): boolean {
  if (doc.isSensitive) return true;
  const cat = (doc.documentCategory ?? "").toUpperCase();
  if (cat === "LEAVE_MEDICAL" || cat === "DISCIPLINARY" || cat === "FIREARM") return true;
  const def = getDocumentDefinition(doc.documentType ?? "");
  return Boolean(def.isSensitive);
}

function canUserAccessDocument(
  user: import("../../lib/types.js").AuthenticatedUser,
  doc: { isSensitive?: boolean; documentCategory?: string | null; documentType?: string }
): boolean {
  if (user.isOwner) return true;
  if (!isDocumentSensitive(doc)) return true;
  return (
    canAccessSensitiveData(user, "/employees") ||
    canAccessSensitiveData(user, "/payroll") ||
    hasCapability(user, "/documents", "view_sensitive")
  );
}

export async function documentsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({ module: "/documents" }),
  ];

  const forUser = <T extends { id: string; fileUrl: string; expiryDate?: Date | null; doesNotExpire?: boolean; documentType?: string }>(
    document: T,
    canExport: boolean
  ): Omit<T, "fileUrl"> & { downloadUrl?: string; expiryState?: ReturnType<typeof evaluateExpiryState>; typeDefinition?: ReturnType<typeof getDocumentDefinition> } => {
    const { fileUrl: _fileUrl, ...metadata } = document;
    const expiryState = evaluateExpiryState(document.expiryDate, document.doesNotExpire);
    const typeDefinition = document.documentType ? getDocumentDefinition(document.documentType) : undefined;
    return {
      ...metadata,
      expiryState,
      typeDefinition,
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
    if (resolvedIsSensitive && !canUserAccessDocument(user, { isSensitive: true, documentCategory: resolvedDocCategory, documentType: parsed.data.documentType })) {
      return reply.code(403).send({
        error: "Forbidden",
        message: "Sensitive access permissions required for medical, disciplinary, or firearm documents",
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
    { preHandler: [authMiddleware, requireCapability("/documents", "export")] },
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
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        uploadedBy: { select: { id: true, name: true, email: true } },
        verifiedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!doc) {
      return reply.code(404).send({ error: "Not found", message: "Document not found" });
    }

    if (!canUserAccessDocument(user, doc)) {
      return reply.code(403).send({ error: "Forbidden", message: "Access to this sensitive document is restricted" });
    }

    return reply.send(
      forUser(doc, hasCapability(user, "/documents", "export"))
    );
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
      documentType: parsed.data.documentType,
      documentCategory: parsed.data.documentCategory,
      documentNumber: parsed.data.documentNumber,
      issuingAuthority: parsed.data.issuingAuthority,
      issueDate: parsed.data.issueDate ? new Date(parsed.data.issueDate) : undefined,
      expiryDate: parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : undefined,
      doesNotExpire: parsed.data.doesNotExpire,
      isSensitive: parsed.data.isSensitive,
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
