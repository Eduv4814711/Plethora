import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import { readStreamToBuffer, storage } from "../lib/storage.js";
import {
  deleteLeaveRecordsForRange,
  LeaveAvailabilityError,
  replaceLeaveRecordRange,
  validateLeaveDateRange,
} from "../services/leave-availability.service.js";
import {
  createLeaveApplication,
  decideLeaveApplication,
  LeaveManagementError,
} from "../services/leave-management.service.js";
import { reconcileContinuityForEmployee } from "../modules/rosters/roster-continuity.service.js";

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
  /** Start date (inclusive). For a single day, omit endDate or set it equal to date. */
  date: z.string(),
  /** End date (inclusive). When set, one leave record is created per calendar day in the range. */
  endDate: z.string().optional(),
  type: z.enum(SA_LEAVE_TYPES),
  hours: z.number().positive().max(24).default(8),
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
  hours: z.number().positive().max(24).default(8),
});

async function legacyMutationBlocker(companyId: string, employeeId: string, startDate: string, endDate: string) {
  const range = validateLeaveDateRange(startDate, endDate);
  const [application, lockedPayroll] = await Promise.all([
    prisma.leaveApplication.findFirst({
      where: {
        companyId,
        employeeId,
        startDate: { lte: range.end },
        endDate: { gte: range.start },
      },
      select: { id: true, status: true },
    }),
    prisma.payrollRun.findFirst({
      where: {
        companyId,
        status: { in: ["approved", "paid"] },
        periodStart: { lte: range.end },
        periodEnd: { gte: range.start },
        items: { some: { employeeId } },
      },
      select: { id: true, status: true },
    }),
  ]);
  if (application) {
    return `This legacy row is controlled by leave application ${application.id} (${application.status.toLowerCase()}); cancel or adjust the application instead.`;
  }
  if (lockedPayroll) {
    return `Leave affecting ${lockedPayroll.status} payroll ${lockedPayroll.id} is immutable; create a reversing adjustment in an open run.`;
  }
  return null;
}

export async function leaveRecordsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireRole(["admin", "operations_manager", "hr_payroll"], {
      anyOfModules: ["/employees/leave", "/payroll"],
    }),
  ];

  app.get("/", { preHandler: protect }, async (request, reply) => {
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

    const sickNotes = await prisma.leaveSickNote.findMany({
      where: { companyId: user.companyId },
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

    return reply.send({ data: records, sickNotes });
  });

  app.post("/sick-note", { preHandler: protect }, async (request, reply) => {
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
      where: {
        employeeId,
        type: "sick",
        date: { gte: range.start, lte: range.end },
      },
    });
    if (sickLeaveCount === 0) {
      return reply.code(400).send({
        error: "Validation error",
        message: "Add sick leave for this period before uploading a sick note",
      });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({
        error: "No file",
        message: "Please attach a sick note image or PDF",
      });
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
        return reply.code(400).send({
          error: "File too large",
          message: "Maximum file size is 10MB",
        });
      }
      request.log.error(err);
      return reply.code(500).send({ error: "Upload failed", message: "Could not read the file" });
    }

    const ext = mimetype.split("/")[1]?.replace("jpeg", "jpg") || "bin";
    const storageName = `${randomUUID()}.${ext}`;
    const key = `leave-sick-notes/${companyId}/${employeeId}/${storageName}`;

    try {
      await storage.uploadFile({
        key,
        body: fileBuffer,
        contentType: mimetype,
      });
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

    const application = await prisma.leaveApplication.findFirst({
      where: {
        companyId,
        employeeId,
        leaveType: { code: "sick" },
        startDate: range.start,
        endDate: range.end,
        status: { in: ["PENDING_HR", "APPROVED", "PAYROLL_PROCESSED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (application && userId) {
      await prisma.leaveApplicationDocument.create({
        data: {
          applicationId: application.id,
          documentType: "medical_certificate",
          fileUrl,
          fileName: originalName,
          mimeType: mimetype,
          fileSize: fileBuffer.length,
          uploadedById: userId,
          reviewStatus: "VERIFIED",
          verifiedById: userId,
          verifiedAt: new Date(),
          reviewNote: "Verified during HR direct capture",
        },
      });
    }

    await createAuditLog({
      userId: userId!,
      companyId,
      action: "leave_sick_note.upload",
      entityType: "leave_sick_note",
      entityId: sickNote.id,
      metadata: { employeeId, startDate, endDate: endDate ?? startDate, fileName: originalName },
    });

    return reply.code(201).send(sickNote);
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createLeaveRecordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const employee = await prisma.employee.findFirst({
      where: { id: parsed.data.employeeId, companyId },
    });
    if (!employee) {
      return reply.code(404).send({ error: "Employee not found" });
    }

    try {
      const { application, records } = await prisma.$transaction(async (tx) => {
        const application = await createLeaveApplication({
          companyId,
          employeeId: parsed.data.employeeId,
          leaveTypeCode: parsed.data.type,
          startDate: parsed.data.date,
          endDate: parsed.data.endDate,
          requestedMinutesPerDay: Math.round(parsed.data.hours * 60),
          reason: "Approved leave recorded by HR",
          retrospectiveReason: parsed.data.date < new Date().toISOString().slice(0, 10)
            ? "Retrospective leave recorded through legacy-compatible HR form"
            : undefined,
          source: "ADMIN",
          actorId: request.user!.sub,
          legacyFullDayCapture: true,
        }, { transaction: tx });
        const approved = await decideLeaveApplication({
          companyId,
          applicationId: application.id,
          actorId: request.user!.sub,
          decision: "approve",
          reason: "Approved during direct HR capture",
        }, { transaction: tx });
        const legacyRecordIds = Array.isArray(approved?.legacyLeaveRecordIds)
          ? approved.legacyLeaveRecordIds.filter((id): id is string => typeof id === "string")
          : [];
        const records = await tx.leaveRecord.findMany({ where: { id: { in: legacyRecordIds } } });
        return { application, records };
      }, { maxWait: 5_000, timeout: 30_000 });
      await reconcileContinuityForEmployee(parsed.data.employeeId, companyId, "leave_approved").catch(() => undefined);
      const days = records.length;

      if (records.length === 1) {
        return reply.code(201).send(records[0]);
      }
      return reply.code(201).send({ data: records, days, applicationId: application.id });
    } catch (err) {
      if (err instanceof LeaveManagementError) {
        return reply.code(err.statusCode).send({ error: err.code, message: err.message });
      }
      if (err instanceof LeaveAvailabilityError) {
        return reply.code(400).send({ error: "Validation error", message: err.message });
      }
      throw err;
    }
  });

  app.put("/range", { preHandler: protect }, async (request, reply) => {
    const parsed = updateLeaveRangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    try {
      const blocked = await legacyMutationBlocker(companyId, parsed.data.employeeId, parsed.data.startDate, parsed.data.endDate);
      if (blocked) return reply.code(409).send({ error: "Authoritative leave is immutable", message: blocked });
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
        metadata: {
          employeeId: parsed.data.employeeId,
          days,
          previous: {
            startDate: parsed.data.startDate,
            endDate: parsed.data.endDate,
            type: parsed.data.type,
          },
          updated: {
            startDate: parsed.data.newStartDate,
            endDate: parsed.data.newEndDate ?? parsed.data.newStartDate,
            type: parsed.data.newType,
          },
        },
      });

      return reply.send({ data: records, days });
    } catch (err) {
      if (err instanceof LeaveAvailabilityError) {
        return reply.code(400).send({ error: "Validation error", message: err.message });
      }
      throw err;
    }
  });

  app.delete("/range", { preHandler: protect }, async (request, reply) => {
    const parsed = leaveRangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    try {
      const blocked = await legacyMutationBlocker(companyId, parsed.data.employeeId, parsed.data.startDate, parsed.data.endDate);
      if (blocked) return reply.code(409).send({ error: "Authoritative leave is immutable", message: blocked });
      const deleted = await deleteLeaveRecordsForRange({
        companyId,
        employeeId: parsed.data.employeeId,
        type: parsed.data.type,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
      });

      if (deleted === 0) {
        return reply.code(404).send({ error: "Leave record not found" });
      }

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
            // ignore missing objects
          }
        }
      }
      if (sickNotes.length > 0) {
        await prisma.leaveSickNote.deleteMany({
          where: { id: { in: sickNotes.map((n) => n.id) } },
        });
      }

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "leave_record.delete",
        entityType: "leave_record",
        entityId: parsed.data.employeeId,
        metadata: {
          employeeId: parsed.data.employeeId,
          days: deleted,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          type: parsed.data.type,
        },
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
