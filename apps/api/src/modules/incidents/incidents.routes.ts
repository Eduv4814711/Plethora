import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { authProtect } from "../../middleware/auth-protect.js";
import { requireRole } from "../../middleware/rbac.js";
import { requirePermission } from "../../middleware/permissions.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { readStreamToBuffer, storage } from "../../lib/storage.js";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import {
  createIncident,
  getIncident,
  listIncidents,
  reviewIncident,
  updateIncident,
} from "./incidents.service.js";

const ROLES = [
  "admin",
  "operations_manager",
  "hr_payroll",
  "supervisor",
  "controller",
] as const;

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

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
  const protect = [
    ...authProtect,
    requireRole([...ROLES], {
      anyOfModules: ["/", "/incidents", "/sites", "/reports"],
    }),
    requirePermission(PERMISSIONS.INCIDENTS_READ),
  ];
  const manageProtect = [...protect, requirePermission(PERMISSIONS.INCIDENTS_MANAGE)];

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
    return reply.send(incident);
  });

  app.post("/", { preHandler: manageProtect }, async (request, reply) => {
    const user = request.user!;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.errors[0]?.message ?? "Invalid body",
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

  app.patch("/:id", { preHandler: manageProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.errors[0]?.message ?? "Invalid body",
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

  app.post("/:id/attachments", { preHandler: manageProtect }, async (request, reply) => {
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

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readStreamToBuffer(data.file, MAX_ATTACHMENT_SIZE);
    } catch (err) {
      if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
        return reply.code(400).send({ error: "File too large", message: "Maximum file size is 10MB" });
      }
      return reply.code(500).send({ error: "Upload failed", message: "Could not read the file" });
    }

    const mimetype = data.mimetype;
    const ext = mimetype.split("/")[1]?.replace("jpeg", "jpg") || "bin";
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
        filename: data.filename || filename,
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

    return reply.code(201).send(attachment);
  });

  app.post("/:id/review", { preHandler: manageProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.errors[0]?.message ?? "Invalid body",
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
  });
}
