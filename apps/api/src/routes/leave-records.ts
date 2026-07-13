import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { authProtect } from "../middleware/auth-protect.js";
import { requireRole } from "../middleware/rbac.js";
import { requirePermission, requireAnyPermission } from "../middleware/permissions.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { hasPermission } from "../services/user-access.service.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import { readStreamToBuffer, storage } from "../lib/storage.js";
import { createSignedDownloadPath, verifySignedDownload } from "../lib/signed-url.js";
import {
  createLeaveRecordsForRange,
  deleteLeaveRecordsForRange,
  LeaveAvailabilityError,
  replaceLeaveRecordRange,
  validateLeaveDateRange,
} from "../services/leave-availability.service.js";

const SA_LEAVE_TYPES = ["annual", "sick", "family_responsibility", "maternity", "parental", "unpaid"] as const;

const SICK_NOTE_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];
const SICK_NOTE_MAX_BYTES = 10 * 1024 * 1024;

const createLeaveRecordSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string(),
  endDate: z.string().optional(),
  type: z.enum(SA_LEAVE_TYPES),
  hours: z.number().min(0).max(24).default(8),
});

const leaveRangeSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(SA_LEAVE_TYPES),
  startDate: z.string(),
  endDate: z.string(),
});

const updateLeaveRangeSchema = leaveRangeSchema.extend({
  newStartDate: z.string(),
  newEndDate: z.string().optional(),
  newType: z.enum(SA_LEAVE_TYPES),
  hours: z.number().min(0).max(24).default(8),
});

export async function leaveRecordsRoutes(app: FastifyInstance) {
  const leaveReadProtect = [
    ...authProtect,
    requireRole(["admin", "operations_manager", "hr_payroll"], {
      anyOfModules: ["/employees", "/payroll"],
    }),
    requirePermission(PERMISSIONS.LEAVE_READ),
  ];
  const leaveManageProtect = [
    ...leaveReadProtect,
    requirePermission(PERMISSIONS.LEAVE_MANAGE),
  ];
  const sickNoteReadProtect = [
    ...authProtect,
    requirePermission(PERMISSIONS.SICK_NOTES_READ),
  ];
  const sickNoteManageProtect = [
    ...authProtect,
    requirePermission(PERMISSIONS.SICK_NOTES_MANAGE),
  ];

  app.get("/", { preHandler: leaveReadProtect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const employeeId = q.employeeId;
    const start = q.start ? new Date(q.start) : undefined;
    const end = q.end ? new Date(q.end) : undefined;

    const where: Record<string, unknown> = {
      employee: { companyId: user.companyId },
    };
    if (employeeId) where.employeeId = employeeId;
    if (start && end) where.date = { gte: start, lte: end };
    else if (start) where.date = { gte: start };
    else if (end) where.date = { lte: end };

    const records = await prisma.leaveRecord.findMany({
      where,
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeNumber: true },
        },
      },
      orderBy: { date: "asc" },
    });

    let sickNoteIndicators: { employeeId: string; medicalDocumentationSubmitted: boolean }[] = [];
    if (employeeId) {
      const count = await prisma.leaveSickNote.count({
        where: { companyId: user.companyId, employeeId },
      });
      sickNoteIndicators = [{ employeeId, medicalDocumentationSubmitted: count > 0 }];
    }

    return reply.send({ data: records, sickNoteIndicators });
  });

  app.get("/sick-notes", { preHandler: sickNoteReadProtect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const employeeId = q.employeeId;

    const sickNotes = await prisma.leaveSickNote.findMany({
      where: {
        companyId: user.companyId,
        ...(employeeId ? { employeeId } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        employeeId: true,
        startDate: true,
        endDate: true,
        fileName: true,
        mimeType: true,
        fileUrl: true,
        fileSize: true,
        createdAt: true,
      },
    });

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "sick_note.view",
      entityType: "leave_sick_note",
      entityId: employeeId ?? "all",
    });

    const data = sickNotes.map((note) => {
      const key = storage.resolveKeyFromUrl(note.fileUrl);
      if (!key || key.startsWith("logos/")) return note;
      const signed = createSignedDownloadPath(
        key,
        900,
        "/payroll/leave-records/sick-notes/download"
      );
      return { ...note, fileUrl: signed.path };
    });

    return reply.send({ data });
  });

  app.get("/sick-notes/download", { preHandler: sickNoteReadProtect }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const key = q.key?.trim();
    if (!key || !verifySignedDownload(key, q.expires, q.sig)) {
      return reply.code(403).send({ error: "Forbidden", message: "Invalid or expired download link" });
    }
    if (!key.startsWith(`leave-sick-notes/${request.user!.companyId}/`)) {
      return reply.code(403).send({ error: "Forbidden", message: "Invalid download key" });
    }
    try {
      const body = await storage.readLocalFile(key);
      return reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Disposition", `attachment; filename="${key.split("/").pop()}"`)
        .send(body);
    } catch {
      return reply.code(404).send({ error: "Not found", message: "File not found" });
    }
  });

  app.post("/sick-note", { preHandler: sickNoteManageProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const q = request.query as Record<string, string | undefined>;
    const employeeId = q.employeeId?.trim();
    const startDate = q.startDate?.trim();
    const endDate = q.endDate?.trim() || startDate;

    if (!employeeId || !startDate) {
      return reply.code(400).send({
        error: "Validation error",
        message: "employeeId and startDate are required",
      });
    }

    let range;
    try {
      range = validateLeaveDateRange(startDate, endDate);
    } catch (err) {
      if (err instanceof LeaveAvailabilityError) {
        return reply.code(400).send({ error: "Validation error", message: err.message });
      }
      throw err;
    }

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true },
    });
    if (!employee) {
      return reply.code(404).send({ error: "Employee not found" });
    }

    const sickLeaveCount = await prisma.leaveRecord.count({
      where: { employeeId, type: "sick", date: { gte: range.start, lte: range.end } },
    });
    if (sickLeaveCount === 0) {
      return reply.code(400).send({
        error: "Validation error",
        message: "Add sick leave for this period before uploading a sick note",
      });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "No file", message: "Please attach a sick note image or PDF" });
    }

    const mimetype = data.mimetype;
    if (!SICK_NOTE_ALLOWED_TYPES.includes(mimetype) && !mimetype.startsWith("image/")) {
      return reply.code(400).send({
        error: "Invalid file type",
        message: "Allowed: images (JPEG, PNG, GIF, WebP) or PDF",
      });
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readStreamToBuffer(data.file, SICK_NOTE_MAX_BYTES);
    } catch (err) {
      if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
        return reply.code(400).send({ error: "File too large", message: "Maximum file size is 10MB" });
      }
      request.log.error(err);
      return reply.code(500).send({ error: "Upload failed", message: "Could not read the file" });
    }

    const ext = mimetype.split("/")[1]?.replace("jpeg", "jpg") || "bin";
    const storageName = `${randomUUID()}.${ext}`;
    const key = `leave-sick-notes/${companyId}/${employeeId}/${storageName}`;

    try {
      await storage.uploadFile({ key, body: fileBuffer, contentType: mimetype });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: "Upload failed", message: "Could not save the file" });
    }

    const fileUrl = storage.getAssetUrl(key);
    const originalName = data.filename || storageName;

    const sickNote = await prisma.leaveSickNote.create({
      data: {
        companyId,
        employeeId,
        startDate: range.start,
        endDate: range.end,
        fileName: originalName,
        mimeType: mimetype,
        fileUrl,
        fileSize: fileBuffer.length,
        uploadedBy: userId,
      },
    });

    await createAuditLog({
      userId: userId!,
      companyId,
      action: "sick_note.upload",
      entityType: "leave_sick_note",
      entityId: sickNote.id,
      metadata: { employeeId, startDate, endDate: endDate ?? startDate },
    });

    return reply.code(201).send(sickNote);
  });

  app.post("/", { preHandler: leaveManageProtect }, async (request, reply) => {
    const parsed = createLeaveRecordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    }

    const companyId = request.user!.companyId;
    const employee = await prisma.employee.findFirst({
      where: { id: parsed.data.employeeId, companyId },
    });
    if (!employee) return reply.code(404).send({ error: "Employee not found" });

    try {
      const { records, days } = await createLeaveRecordsForRange({
        employeeId: parsed.data.employeeId,
        startDate: parsed.data.date,
        endDate: parsed.data.endDate,
        type: parsed.data.type,
        hours: parsed.data.hours,
      });

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "leave_record.create",
        entityType: "leave_record",
        entityId: records[0]?.id ?? "",
        metadata: {
          employeeId: parsed.data.employeeId,
          days,
          startDate: parsed.data.date,
          endDate: parsed.data.endDate ?? parsed.data.date,
        },
      });

      if (records.length === 1) return reply.code(201).send(records[0]);
      return reply.code(201).send({ data: records, days });
    } catch (err) {
      if (err instanceof LeaveAvailabilityError) {
        return reply.code(400).send({ error: "Validation error", message: err.message });
      }
      throw err;
    }
  });

  app.put("/range", { preHandler: leaveManageProtect }, async (request, reply) => {
    const parsed = updateLeaveRangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    }

    const companyId = request.user!.companyId;
    try {
      const { records, days } = await replaceLeaveRecordRange({
        companyId,
        employeeId: parsed.data.employeeId,
        type: parsed.data.type,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        newStartDate: parsed.data.newStartDate,
        newEndDate: parsed.data.newEndDate,
        newType: parsed.data.newType,
        hours: parsed.data.hours,
      });

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "leave_record.update",
        entityType: "leave_record",
        entityId: records[0]?.id ?? "",
        metadata: { employeeId: parsed.data.employeeId, days },
      });

      return reply.send({ data: records, days });
    } catch (err) {
      if (err instanceof LeaveAvailabilityError) {
        return reply.code(400).send({ error: "Validation error", message: err.message });
      }
      throw err;
    }
  });

  app.delete("/range", { preHandler: leaveManageProtect }, async (request, reply) => {
    const parsed = leaveRangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    }

    const companyId = request.user!.companyId;
    try {
      const deleted = await deleteLeaveRecordsForRange({
        companyId,
        employeeId: parsed.data.employeeId,
        type: parsed.data.type,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
      });

      if (deleted === 0) return reply.code(404).send({ error: "Leave record not found" });

      if (hasPermission(request.access, PERMISSIONS.SICK_NOTES_MANAGE)) {
        const range = validateLeaveDateRange(parsed.data.startDate, parsed.data.endDate);
        const sickNotes = await prisma.leaveSickNote.findMany({
          where: {
            companyId,
            employeeId: parsed.data.employeeId,
            startDate: range.start,
            endDate: range.end,
          },
        });
        for (const note of sickNotes) {
          const key = storage.resolveKeyFromUrl(note.fileUrl);
          if (key) {
            try {
              await storage.deleteFile(key);
            } catch {
              // ignore
            }
          }
        }
        if (sickNotes.length > 0) {
          await prisma.leaveSickNote.deleteMany({ where: { id: { in: sickNotes.map((n) => n.id) } } });
        }
      }

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "leave_record.delete",
        entityType: "leave_record",
        entityId: parsed.data.employeeId,
        metadata: { employeeId: parsed.data.employeeId, days: deleted },
      });

      return reply.send({ deleted });
    } catch (err) {
      if (err instanceof LeaveAvailabilityError) {
        return reply.code(400).send({ error: "Validation error", message: err.message });
      }
      throw err;
    }
  });
}
