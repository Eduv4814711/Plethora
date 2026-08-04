import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.js";
import { requireCapability, requireCrudCapability } from "../../middleware/authorization.js";
import { hasCapability } from "../../lib/capabilities.js";
import { privateDownloadUrl, sendPrivateStoredFile } from "../../lib/private-download.js";
import { readStreamToBuffer, storage } from "../../lib/storage.js";
import {
  extensionForMime,
  matchesMagicBytes,
  sanitizeUploadFilename,
} from "../../lib/upload-validation.js";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import {
  createIncident,
  getIncident,
  listIncidents,
  reviewIncident,
  updateIncident,
} from "./incidents.service.js";

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
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
]);

const incidentTypeSchema = z.enum([
  "THEFT",
  "BREAK_IN",
  "ASSAULT",
  "GUARD_MISCONDUCT",
  "CLIENT_COMPLAINT",
  "EQUIPMENT_DAMAGE",
  "SITE_EMERGENCY",
  "SAFETY_RISK",
  "ABSENTEEISM",
  "TRESPASSING",
  "FIRE",
  "MEDICAL_EMERGENCY",
  "OTHER",
]);

const createSchema = z.object({
  siteId: z.string().min(1),
  incidentDateTime: z.string().transform((v) => new Date(v)),
  incidentType: incidentTypeSchema,
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10000),
  peopleInvolved: z.string().max(5000).optional(),
  witnesses: z.string().max(5000).optional(),
  clientVisible: z.boolean().optional(),
  assignedSupervisorId: z.string().optional().nullable(),
  followUpRequired: z.boolean().optional(),
  submit: z.boolean().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(10000).optional(),
  peopleInvolved: z.string().max(5000).optional().nullable(),
  witnesses: z.string().max(5000).optional().nullable(),
  clientVisible: z.boolean().optional(),
  followUpRequired: z.boolean().optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  incidentType: incidentTypeSchema.optional(),
});

const reviewSchema = z.object({
  action: z.enum(["approve", "reject", "query", "close", "submit"]),
  note: z.string().max(2000).optional(),
  createFollowUpTask: z.boolean().optional(),
});

export async function incidentsRoutes(app: FastifyInstance) {
  // These are the incident CRUD routes, not an aggregate read surface, so they
  // require the Incidents module itself. Dashboard/Sites/Reports grants used to
  // reach them (including create and edit); the access migration granted
  // /incidents explicitly to everyone who relied on that.
  const protect = [authMiddleware, requireCrudCapability({ module: "/incidents" })];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const result = await listIncidents(user.companyId, {
      status: q.status as never,
      severity: q.severity as never,
      siteId: q.siteId,
      incidentType: q.incidentType as never,
      clientVisible: q.clientVisible === "true" ? true : q.clientVisible === "false" ? false : undefined,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      limit: q.limit ? Number(q.limit) : 50,
      offset: q.offset ? Number(q.offset) : 0,
    });
    return reply.send(result);
  });

  app.get("/:id", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const incident = await getIncident(user.companyId, id);
    if (!incident) {
      return reply.code(404).send({ error: "Not found", message: "Incident not found" });
    }
    const canExport = hasCapability(user, "/incidents", "export");
    const attachments = incident.attachments.map(({ url: _url, ...attachment }) =>
      canExport
        ? {
            ...attachment,
            downloadUrl: privateDownloadUrl(
              `/incidents/${incident.id}/attachments/${attachment.id}/download`
            ),
          }
        : attachment
    );
    return reply.send({ ...incident, attachments });
  });

  app.get(
    "/:id/attachments/:attachmentId/download",
    { preHandler: [authMiddleware, requireCapability("/incidents", "export")] },
    async (request, reply) => {
      const user = request.user!;
      const { id, attachmentId } = request.params as { id: string; attachmentId: string };
      const attachment = await prisma.incidentAttachment.findFirst({
        where: {
          id: attachmentId,
          incidentId: id,
          incident: { companyId: user.companyId },
        },
        select: { url: true, filename: true, mimeType: true },
      });
      if (!attachment) {
        return reply.code(404).send({ error: "Not found", message: "Attachment not found" });
      }
      return sendPrivateStoredFile(reply, {
        storedReference: attachment.url,
        allowedPrefixes: [`incidents/${user.companyId}/${id}`],
        fileName: attachment.filename,
        mimeType: attachment.mimeType,
      });
    }
  );

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      });
    }
    if (Number.isNaN(parsed.data.incidentDateTime.getTime())) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid incident date" });
    }
    const result = await createIncident({
      companyId: user.companyId,
      reportedById: user.sub,
      ...parsed.data,
    });
    if (result.error === "site_not_found") {
      return reply.code(400).send({ error: "Validation error", message: "Site not found" });
    }
    return reply.code(201).send(result.incident);
  });

  app.patch("/:id", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      });
    }
    const result = await updateIncident({
      companyId: user.companyId,
      incidentId: id,
      userId: user.sub,
      data: parsed.data,
    });
    if (result.error === "not_found") {
      return reply.code(404).send({ error: "Not found", message: "Incident not found" });
    }
    if (result.error === "not_editable") {
      return reply.code(400).send({
        error: "Validation error",
        message: "Only draft incidents can be edited",
      });
    }
    return reply.send(result.incident);
  });

  app.post("/:id/attachments", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const incident = await prisma.incident.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!incident) {
      return reply.code(404).send({ error: "Not found", message: "Incident not found" });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "No file", message: "Please select a file to upload" });
    }

    const mimetype = data.mimetype;
    if (!ALLOWED_ATTACHMENT_TYPES.has(mimetype)) {
      return reply.code(400).send({
        error: "Invalid file type",
        message: "Allowed: images, PDF, Word, Excel, text, or CSV",
      });
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readStreamToBuffer(data.file, MAX_ATTACHMENT_SIZE);
    } catch (err) {
      if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
        return reply.code(400).send({ error: "File too large", message: "Maximum file size is 10MB" });
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
    const key = `incidents/${user.companyId}/${id}/${filename}`;

    try {
      await storage.uploadFile({ key, body: fileBuffer, contentType: mimetype });
    } catch {
      return reply.code(500).send({ error: "Upload failed", message: "Could not save the file" });
    }

    const attachment = await prisma.incidentAttachment.create({
      data: {
        incidentId: id,
        url: storage.getAssetUrl(key),
        filename: sanitizeUploadFilename(data.filename || filename, mimetype),
        mimeType: mimetype,
        size: fileBuffer.length,
        uploadedById: user.sub,
      },
    });

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "incident.attachment_upload",
      entityType: "Incident",
      entityId: id,
      metadata: { attachmentId: attachment.id },
    });

    const { url: _url, ...metadata } = attachment;
    return reply.code(201).send(
      hasCapability(user, "/incidents", "export")
        ? {
            ...metadata,
            downloadUrl: privateDownloadUrl(
              `/incidents/${id}/attachments/${attachment.id}/download`
            ),
          }
        : metadata
    );
  });

  app.post(
    "/:id/review",
    { preHandler: [authMiddleware, requireCapability("/incidents", "approve")] },
    async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      });
    }
    const result = await reviewIncident({
      companyId: user.companyId,
      incidentId: id,
      reviewerId: user.sub,
      ...parsed.data,
    });
    if (result.error === "not_found") {
      return reply.code(404).send({ error: "Not found", message: "Incident not found" });
    }
    return reply.send(result);
    }
  );
}
