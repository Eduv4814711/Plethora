import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";

const sessionSchema = z.object({
  courseRunId: z.string().optional().nullable(),
  classroomId: z.string().optional().nullable(),
  instructorId: z.string().optional().nullable(),
  sessionDate: z.string().min(1),
});

const markSchema = z.object({
  sessionId: z.string().min(1),
  enrolmentId: z.string().min(1),
  attendanceStatus: z.enum(["present", "absent", "late", "excused"]),
  method: z.enum(["manual", "qr_code", "otp", "biometric"]).optional(),
  checkInTime: z.string().optional().nullable(),
  checkOutTime: z.string().optional().nullable(),
});

const markBulkSchema = z.object({
  sessionId: z.string().min(1),
  rows: z.array(markSchema.omit({ sessionId: true })).min(1).max(200),
});

function parseDate(v?: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function validateSessionReferences(
  companyId: string,
  refs: { courseRunId?: string | null; classroomId?: string | null; instructorId?: string | null }
): Promise<string | null> {
  if (refs.courseRunId) {
    const run = await prisma.courseRun.findFirst({
      where: { id: refs.courseRunId, companyId },
      select: { id: true },
    });
    if (!run) return "courseRunId not found";
  }
  if (refs.classroomId) {
    const classroom = await prisma.academyClassroom.findFirst({
      where: { id: refs.classroomId, companyId },
      select: { id: true },
    });
    if (!classroom) return "classroomId not found";
  }
  if (refs.instructorId) {
    const instructor = await prisma.academyInstructor.findFirst({
      where: { id: refs.instructorId, companyId },
      select: { id: true },
    });
    if (!instructor) return "instructorId not found";
  }
  return null;
}

async function validateSessionAndEnrolmentScope(
  companyId: string,
  sessionId: string,
  enrolmentId: string
): Promise<string | null> {
  const [session, enrolment] = await Promise.all([
    prisma.academyAttendanceSession.findFirst({
      where: { id: sessionId, companyId },
      select: { id: true, courseRunId: true },
    }),
    prisma.enrolment.findFirst({
      where: { id: enrolmentId, companyId },
      select: { id: true, courseRunId: true },
    }),
  ]);
  if (!session) return "sessionId not found";
  if (!enrolment) return "enrolmentId not found";
  if (session.courseRunId && session.courseRunId !== enrolment.courseRunId) {
    return "enrolmentId is not linked to this session's course run";
  }
  return null;
}

export async function academyAttendanceRoutes(app: FastifyInstance) {
  app.get("/sessions", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 100, 200);
    const offset = Number(q.offset) || 0;
    const where = { companyId, ...(q.courseRunId ? { courseRunId: q.courseRunId } : {}) };
    const [sessions, total] = await Promise.all([
      prisma.academyAttendanceSession.findMany({ where, include: { classroom: true, instructor: true, courseRun: true, records: true }, orderBy: { sessionDate: "desc" }, take: limit, skip: offset }),
      prisma.academyAttendanceSession.count({ where }),
    ]);
    return { sessions, total, limit, offset };
  });

  app.get("/sessions/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const session = await prisma.academyAttendanceSession.findFirst({ where: { id, companyId }, include: { records: { include: { enrolment: { include: { student: true } } } }, classroom: true, instructor: true, courseRun: true } });
    if (!session) return reply.code(404).send({ error: "Not found", message: "Session not found" });
    return { session };
  });

  app.post("/sessions", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const parsed = sessionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });

    const sessionDate = parseDate(parsed.data.sessionDate);
    if (!sessionDate) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid sessionDate" });
    }
    const refsError = await validateSessionReferences(companyId, parsed.data);
    if (refsError) {
      return reply.code(400).send({ error: "Validation error", message: refsError });
    }

    const row = await prisma.academyAttendanceSession.create({
      data: { ...parsed.data, companyId, sessionDate },
    });
    await createAuditLog({ userId, companyId, action: "academy.attendance.session_create", entityType: "AcademyAttendanceSession", entityId: row.id });
    return reply.code(201).send({ session: row });
  });

  app.patch("/sessions/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const parsed = sessionSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const exists = await prisma.academyAttendanceSession.findFirst({ where: { id, companyId } });
    if (!exists) return reply.code(404).send({ error: "Not found", message: "Session not found" });
    const d = parsed.data;

    if (d.sessionDate != null && !parseDate(d.sessionDate)) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid sessionDate" });
    }
    const refsError = await validateSessionReferences(companyId, d);
    if (refsError) {
      return reply.code(400).send({ error: "Validation error", message: refsError });
    }

    const session = await prisma.academyAttendanceSession.update({
      where: { id },
      data: { ...d, sessionDate: d.sessionDate ? parseDate(d.sessionDate) : undefined },
    });
    await createAuditLog({ userId, companyId, action: "academy.attendance.session_update", entityType: "AcademyAttendanceSession", entityId: id });
    return { session };
  });

  app.delete("/sessions/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const exists = await prisma.academyAttendanceSession.findFirst({ where: { id, companyId } });
    if (!exists) return reply.code(404).send({ error: "Not found", message: "Session not found" });
    await prisma.academyAttendanceRecord.deleteMany({ where: { sessionId: id } });
    await prisma.academyAttendanceSession.delete({ where: { id } });
    await createAuditLog({ userId, companyId, action: "academy.attendance.session_delete", entityType: "AcademyAttendanceSession", entityId: id });
    return reply.code(204).send();
  });

  app.post("/mark", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const parsed = markSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const d = parsed.data;

    const scopeError = await validateSessionAndEnrolmentScope(companyId, d.sessionId, d.enrolmentId);
    if (scopeError) {
      return reply.code(400).send({ error: "Validation error", message: scopeError });
    }
    if (d.checkInTime != null && !parseDate(d.checkInTime)) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid checkInTime" });
    }
    if (d.checkOutTime != null && !parseDate(d.checkOutTime)) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid checkOutTime" });
    }

    const row = await prisma.academyAttendanceRecord.upsert({
      where: { sessionId_enrolmentId: { sessionId: d.sessionId, enrolmentId: d.enrolmentId } },
      update: { attendanceStatus: d.attendanceStatus, method: d.method, checkInTime: parseDate(d.checkInTime), checkOutTime: parseDate(d.checkOutTime), markedByUserId: userId },
      create: { companyId, sessionId: d.sessionId, enrolmentId: d.enrolmentId, attendanceStatus: d.attendanceStatus, method: d.method ?? "manual", checkInTime: parseDate(d.checkInTime), checkOutTime: parseDate(d.checkOutTime), markedByUserId: userId },
    });
    await createAuditLog({ userId, companyId, action: "academy.attendance.mark", entityType: "AcademyAttendanceRecord", entityId: row.id });
    return { record: row };
  });

  app.post("/mark-bulk", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const parsed = markBulkSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const { sessionId, rows } = parsed.data;

    const session = await prisma.academyAttendanceSession.findFirst({
      where: { id: sessionId, companyId },
      select: { id: true, courseRunId: true },
    });
    if (!session) {
      return reply.code(400).send({ error: "Validation error", message: "sessionId not found" });
    }

    const enrolmentIds = [...new Set(rows.map((r) => r.enrolmentId))];
    const enrolments = await prisma.enrolment.findMany({
      where: { companyId, id: { in: enrolmentIds } },
      select: { id: true, courseRunId: true },
    });
    if (enrolments.length !== enrolmentIds.length) {
      const found = new Set(enrolments.map((e) => e.id));
      const missing = enrolmentIds.filter((id) => !found.has(id));
      return reply.code(400).send({
        error: "Validation error",
        message: `enrolmentId not found: ${missing.join(", ")}`,
      });
    }
    if (session.courseRunId) {
      const invalid = enrolments.find((e) => e.courseRunId !== session.courseRunId);
      if (invalid) {
        return reply.code(400).send({
          error: "Validation error",
          message: "One or more enrolments are not linked to this session's course run",
        });
      }
    }
    for (const row of rows) {
      if (row.checkInTime != null && !parseDate(row.checkInTime)) {
        return reply.code(400).send({ error: "Validation error", message: "Invalid checkInTime" });
      }
      if (row.checkOutTime != null && !parseDate(row.checkOutTime)) {
        return reply.code(400).send({ error: "Validation error", message: "Invalid checkOutTime" });
      }
    }

    const records = await prisma.$transaction(
      rows.map((d) =>
        prisma.academyAttendanceRecord.upsert({
          where: { sessionId_enrolmentId: { sessionId, enrolmentId: d.enrolmentId } },
          update: { attendanceStatus: d.attendanceStatus, method: d.method, checkInTime: parseDate(d.checkInTime), checkOutTime: parseDate(d.checkOutTime), markedByUserId: userId },
          create: { companyId, sessionId, enrolmentId: d.enrolmentId, attendanceStatus: d.attendanceStatus, method: d.method ?? "manual", checkInTime: parseDate(d.checkInTime), checkOutTime: parseDate(d.checkOutTime), markedByUserId: userId },
        })
      )
    );
    await createAuditLog({ userId, companyId, action: "academy.attendance.mark_bulk", entityType: "AcademyAttendanceSession", entityId: sessionId, metadata: { count: records.length } });
    return { records };
  });

  app.delete("/records/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const existing = await prisma.academyAttendanceRecord.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Attendance record not found" });
    await prisma.academyAttendanceRecord.delete({ where: { id } });
    await createAuditLog({ userId, companyId, action: "academy.attendance.unmark", entityType: "AcademyAttendanceRecord", entityId: id });
    return reply.code(204).send();
  });
}
