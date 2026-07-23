import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability, requireCrudCapability } from "../../middleware/authorization.js";
import { hasCapability } from "../../lib/capabilities.js";
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
} from "./documents.service.js";
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
  ]),
  employeeId: z.string().optional().nullable(),
  siteId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  incidentId: z.string().optional().nullable(),
  taskId: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
});

export async function documentsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({ module: "/documents" }),
  ];

  const forUser = <T extends { id: string; fileUrl: string }>(
    document: T,
    canExport: boolean
  ): Omit<T, "fileUrl"> & { downloadUrl?: string } => {
    const { fileUrl: _fileUrl, ...metadata } = document;
    return canExport
      ? { ...metadata, downloadUrl: privateDownloadUrl(`/documents/${document.id}/download`) }
      : metadata;
  };

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const result = await listDocuments(user.companyId, {
      category: q.category as never,
      status: q.status as never,
      employeeId: q.employeeId,
      siteId: q.siteId,
      clientId: q.clientId,
      expiringWithinDays: q.expiringWithinDays ? Number(q.expiringWithinDays) : undefined,
      limit: q.limit ? Number(q.limit) : 50,
      offset: q.offset ? Number(q.offset) : 0,
    });
    const canExport = hasCapability(user, "/documents", "export");
    return reply.send({
      ...result,
      items: result.items.map((document) => forUser(document, canExport)),
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

    const mimetype = data.mimetype;
    if (!ALLOWED_TYPES.includes(mimetype)) {
      return reply.code(400).send({
        error: "Invalid file type",
        message: "Allowed: images, PDF, Word, Excel, text, CSV",
      });
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
      fileUrl: url,
      fileName: sanitizeUploadFilename(data.filename || filename, mimetype),
      mimeType: mimetype,
      size: fileBuffer.length,
      employeeId: parsed.data.employeeId,
      siteId: parsed.data.siteId,
      clientId: parsed.data.clientId,
      incidentId: parsed.data.incidentId,
      taskId: parsed.data.taskId,
      expiryDate: parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : null,
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
        select: { fileUrl: true, fileName: true, mimeType: true },
      });
      if (!document) {
        return reply.code(404).send({ error: "Not found", message: "Document not found" });
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
        employee: { select: { id: true, firstName: true, lastName: true } },
        uploadedBy: { select: { id: true, name: true } },
      },
    });
    if (!doc) {
      return reply.code(404).send({ error: "Not found", message: "Document not found" });
    }
    return reply.send(
      forUser(doc, hasCapability(user, "/documents", "export"))
    );
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
