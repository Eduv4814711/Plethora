import { Prisma } from "@prisma/client";
import type {
  AcademyAttendanceSession,
  AcademyAttendanceRecord,
  AcademySessionAttendanceStatus,
  AcademyAttendanceMethod,
  AcademyEnrolmentAttendanceStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import {
  AcademyServiceError,
  AcademyValidationError,
  AcademyNotFoundError,
  AcademyConflictError,
} from "./academy-student.service.js";
import { evaluateAndSyncEnrolmentLifecycle } from "./academy-enrolment.service.js";

export interface AttendanceForensics {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface CreateAttendanceSessionInput {
  courseRunId?: string | null;
  classroomId?: string | null;
  instructorId?: string | null;
  sessionDate: string | Date;
}

export interface UpdateAttendanceSessionInput {
  courseRunId?: string | null;
  classroomId?: string | null;
  instructorId?: string | null;
  sessionDate?: string | Date;
}

export interface ListAttendanceSessionsParams {
  courseRunId?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  limit?: number;
  offset?: number;
}

export interface MarkAttendanceInput {
  sessionId: string;
  enrolmentId: string;
  attendanceStatus: AcademySessionAttendanceStatus;
  method?: AcademyAttendanceMethod;
  checkInTime?: string | Date | null;
  checkOutTime?: string | Date | null;
}

export interface BulkMarkRowInput {
  enrolmentId: string;
  attendanceStatus: AcademySessionAttendanceStatus;
  method?: AcademyAttendanceMethod;
  checkInTime?: string | Date | null;
  checkOutTime?: string | Date | null;
}

export interface SessionWithCounts extends AcademyAttendanceSession {
  recordsCount: number;
  recordStatusCounts: Record<string, number>;
  classroom?: unknown;
  instructor?: unknown;
  courseRun?: unknown;
}

function parseDate(v?: string | Date | null): Date | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Validates foreign references (courseRunId, classroomId, instructorId) for a session.
 */
async function validateSessionReferences(
  companyId: string,
  refs: { courseRunId?: string | null; classroomId?: string | null; instructorId?: string | null }
): Promise<void> {
  let runBranchId: string | null | undefined = undefined;

  if (refs.courseRunId != null) {
    if (typeof refs.courseRunId === "string" && refs.courseRunId.trim() === "") {
      throw new AcademyValidationError("courseRunId cannot be empty");
    }
    const run = await prisma.courseRun.findFirst({
      where: { id: refs.courseRunId, companyId },
      select: { id: true, academyBranchId: true },
    });
    if (!run) throw new AcademyValidationError("courseRunId not found in company");
    runBranchId = run.academyBranchId;
  }

  if (refs.classroomId != null) {
    if (typeof refs.classroomId === "string" && refs.classroomId.trim() === "") {
      throw new AcademyValidationError("classroomId cannot be empty");
    }
    const classroom = await prisma.academyClassroom.findFirst({
      where: { id: refs.classroomId, companyId },
      select: { id: true, academyBranchId: true },
    });
    if (!classroom) throw new AcademyValidationError("classroomId not found in company");

    if (refs.courseRunId) {
      if (runBranchId === undefined) {
        const run = await prisma.courseRun.findFirst({
          where: { id: refs.courseRunId, companyId },
          select: { academyBranchId: true },
        });
        runBranchId = run?.academyBranchId;
      }
      if (runBranchId && classroom.academyBranchId && runBranchId !== classroom.academyBranchId) {
        throw new AcademyValidationError("Classroom branch does not match course run branch");
      }
    }
  }

  if (refs.instructorId != null) {
    if (typeof refs.instructorId === "string" && refs.instructorId.trim() === "") {
      throw new AcademyValidationError("instructorId cannot be empty");
    }
    const instructor = await prisma.academyInstructor.findFirst({
      where: { id: refs.instructorId, companyId },
      select: { id: true },
    });
    if (!instructor) throw new AcademyValidationError("instructorId not found in company");
  }
}

/**
 * Recalculates and synchronizes Enrolment.attendanceStatus based on attendance records and course requirement.
 */
export async function syncEnrolmentAttendanceStatus(
  tx: Prisma.TransactionClient,
  enrolmentId: string,
  companyId: string
): Promise<AcademyEnrolmentAttendanceStatus> {
  const enrolment = await tx.enrolment.findFirst({
    where: { id: enrolmentId, companyId },
    include: {
      courseRun: {
        include: {
          course: { select: { minimumAttendancePercent: true } },
          academyAttendanceSessions: { select: { id: true } },
        },
      },
      academyAttendanceRecords: { select: { attendanceStatus: true } },
    },
  });

  if (!enrolment) return "pending";

  const totalSessions = enrolment.courseRun.academyAttendanceSessions.length;
  const records = enrolment.academyAttendanceRecords;

  if (records.length === 0) {
    await tx.enrolment.update({
      where: { id: enrolmentId },
      data: { attendanceStatus: "pending" },
    });
    await evaluateAndSyncEnrolmentLifecycle(tx, enrolmentId, companyId);
    return "pending";
  }

  const attendedCount = records.filter(
    (r) => r.attendanceStatus === "present" || r.attendanceStatus === "late"
  ).length;

  const minRequired = enrolment.courseRun.course.minimumAttendancePercent ?? 80;

  let nextStatus: AcademyEnrolmentAttendanceStatus;
  if (totalSessions > 0) {
    const maxPossibleAttended = attendedCount + (totalSessions - records.length);
    const maxPossiblePercent = (maxPossibleAttended / totalSessions) * 100;
    const currentTotalPercent = (attendedCount / totalSessions) * 100;

    if (records.length < totalSessions) {
      if (maxPossiblePercent < minRequired) {
        nextStatus = "non_compliant";
      } else if (currentTotalPercent >= minRequired) {
        nextStatus = "compliant";
      } else {
        nextStatus = "in_progress";
      }
    } else {
      nextStatus = currentTotalPercent >= minRequired ? "compliant" : "non_compliant";
    }
  } else {
    const currentPercent = (attendedCount / records.length) * 100;
    nextStatus = currentPercent >= minRequired ? "compliant" : "non_compliant";
  }

  if (nextStatus !== enrolment.attendanceStatus) {
    await tx.enrolment.update({
      where: { id: enrolmentId },
      data: { attendanceStatus: nextStatus },
    });
  }

  await evaluateAndSyncEnrolmentLifecycle(tx, enrolmentId, companyId);

  return nextStatus;
}

/**
 * Lists attendance sessions with record counts.
 */
export async function listAttendanceSessions(
  companyId: string,
  options: ListAttendanceSessionsParams
): Promise<{ sessions: SessionWithCounts[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Number(options.limit) || 100, 200);
  const offset = Number(options.offset) || 0;

  const where: Prisma.AcademyAttendanceSessionWhereInput = {
    companyId,
    ...(options.courseRunId ? { courseRunId: options.courseRunId } : {}),
    ...(options.startDate || options.endDate
      ? {
          sessionDate: {
            ...(options.startDate ? { gte: parseDate(options.startDate) } : {}),
            ...(options.endDate ? { lte: parseDate(options.endDate) } : {}),
          },
        }
      : {}),
  };

  const [sessions, total] = await Promise.all([
    prisma.academyAttendanceSession.findMany({
      where,
      include: {
        classroom: true,
        instructor: true,
        courseRun: true,
        _count: { select: { records: true } },
      },
      orderBy: { sessionDate: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.academyAttendanceSession.count({ where }),
  ]);

  const sessionIds = sessions.map((s) => s.id);
  const recordStatusRows = sessionIds.length
    ? await prisma.academyAttendanceRecord.groupBy({
        by: ["sessionId", "attendanceStatus"],
        where: { companyId, sessionId: { in: sessionIds } },
        _count: { id: true },
      })
    : [];

  const statusCountsBySession = new Map<string, Record<string, number>>();
  for (const row of recordStatusRows) {
    const counts = statusCountsBySession.get(row.sessionId) ?? {};
    counts[row.attendanceStatus] = row._count.id;
    statusCountsBySession.set(row.sessionId, counts);
  }

  const enriched = sessions.map((s) => ({
    ...s,
    recordsCount: s._count.records,
    recordStatusCounts: statusCountsBySession.get(s.id) ?? {},
  }));

  return { sessions: enriched, total, limit, offset };
}

/**
 * Retrieves a single attendance session with its records and linked enrolment/student details.
 */
export async function getAttendanceSessionById(
  companyId: string,
  sessionId: string
): Promise<AcademyAttendanceSession | null> {
  return prisma.academyAttendanceSession.findFirst({
    where: { id: sessionId, companyId },
    include: {
      records: {
        include: {
          enrolment: {
            include: {
              student: {
                select: { id: true, studentNumber: true, firstName: true, lastName: true },
              },
            },
          },
        },
      },
      classroom: true,
      instructor: true,
      courseRun: true,
    },
  });
}

/**
 * Creates a new attendance session with tenant foreign-key validation.
 */
export async function createAttendanceSession(
  companyId: string,
  userId: string,
  data: CreateAttendanceSessionInput,
  forensics?: AttendanceForensics
): Promise<AcademyAttendanceSession> {
  const sessionDate = parseDate(data.sessionDate);
  if (!sessionDate) {
    throw new AcademyValidationError("Invalid sessionDate");
  }

  await validateSessionReferences(companyId, data);

  const session = await prisma.academyAttendanceSession.create({
    data: {
      companyId,
      courseRunId: data.courseRunId ?? null,
      classroomId: data.classroomId ?? null,
      instructorId: data.instructorId ?? null,
      sessionDate,
    },
  });

  await createAuditLog({
    userId,
    companyId,
    action: "academy.attendance.session_create",
    entityType: "AcademyAttendanceSession",
    entityId: session.id,
    metadata: { courseRunId: data.courseRunId, classroomId: data.classroomId, sessionDate },
    ...forensics,
  });

  return session;
}

/**
 * Updates an attendance session.
 */
export async function updateAttendanceSession(
  companyId: string,
  userId: string,
  sessionId: string,
  data: UpdateAttendanceSessionInput,
  forensics?: AttendanceForensics
): Promise<AcademyAttendanceSession> {
  const existing = await prisma.academyAttendanceSession.findFirst({
    where: { id: sessionId, companyId },
  });
  if (!existing) {
    throw new AcademyNotFoundError("Session not found");
  }

  let sessionDate = existing.sessionDate;
  if (data.sessionDate != null) {
    const parsed = parseDate(data.sessionDate);
    if (!parsed) throw new AcademyValidationError("Invalid sessionDate");
    sessionDate = parsed;
  }

  // Merge references to preserve branch consistency validation during partial updates
  const mergedRefs = {
    courseRunId: data.courseRunId !== undefined ? data.courseRunId : existing.courseRunId,
    classroomId: data.classroomId !== undefined ? data.classroomId : existing.classroomId,
    instructorId: data.instructorId !== undefined ? data.instructorId : existing.instructorId,
  };

  await validateSessionReferences(companyId, mergedRefs);

  const updated = await prisma.academyAttendanceSession.update({
    where: { id: sessionId },
    data: {
      ...(data.courseRunId !== undefined ? { courseRunId: data.courseRunId } : {}),
      ...(data.classroomId !== undefined ? { classroomId: data.classroomId } : {}),
      ...(data.instructorId !== undefined ? { instructorId: data.instructorId } : {}),
      sessionDate,
    },
  });

  await createAuditLog({
    userId,
    companyId,
    action: "academy.attendance.session_update",
    entityType: "AcademyAttendanceSession",
    entityId: sessionId,
    metadata: data as Record<string, unknown>,
    ...forensics,
  });

  return updated;
}

/**
 * Deletes an attendance session atomically inside $transaction,
 * removing all its records and recalculating attendance status for affected enrolments.
 */
export async function deleteAttendanceSession(
  companyId: string,
  userId: string,
  sessionId: string,
  forensics?: AttendanceForensics
): Promise<{ deletedRecordCount: number }> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.academyAttendanceSession.findFirst({
      where: { id: sessionId, companyId },
      select: { id: true, courseRunId: true },
    });
    if (!session) {
      throw new AcademyNotFoundError("Session not found");
    }

    // Find affected enrolments before deleting records
    const affectedRecords = await tx.academyAttendanceRecord.findMany({
      where: { sessionId, companyId },
      select: { enrolmentId: true },
    });
    const affectedEnrolmentIds = [...new Set(affectedRecords.map((r) => r.enrolmentId))];

    // Atomically delete all records
    const deleted = await tx.academyAttendanceRecord.deleteMany({
      where: { sessionId, companyId },
    });

    // Atomically delete session
    await tx.academyAttendanceSession.delete({
      where: { id: sessionId },
    });

    // Recalculate attendance status for each affected enrolment
    for (const enrId of affectedEnrolmentIds) {
      await syncEnrolmentAttendanceStatus(tx, enrId, companyId);
    }

    await createAuditLog(
      {
        userId,
        companyId,
        action: "academy.attendance.session_delete",
        entityType: "AcademyAttendanceSession",
        entityId: sessionId,
        metadata: {
          deletedRecordCount: deleted.count,
          affectedEnrolments: affectedEnrolmentIds.length,
        },
        ...forensics,
      },
      tx
    );

    return { deletedRecordCount: deleted.count };
  });
}

/**
 * Marks attendance for a single learner and re-syncs the enrolment's attendance compliance.
 */
export async function markAttendance(
  companyId: string,
  userId: string,
  data: MarkAttendanceInput,
  forensics?: AttendanceForensics
): Promise<AcademyAttendanceRecord> {
  const checkInTime = data.checkInTime != null ? parseDate(data.checkInTime) : null;
  const checkOutTime = data.checkOutTime != null ? parseDate(data.checkOutTime) : null;

  if (data.checkInTime != null && !checkInTime) {
    throw new AcademyValidationError("Invalid checkInTime");
  }
  if (data.checkOutTime != null && !checkOutTime) {
    throw new AcademyValidationError("Invalid checkOutTime");
  }

  return prisma.$transaction(async (tx) => {
    const session = await tx.academyAttendanceSession.findFirst({
      where: { id: data.sessionId, companyId },
      select: { id: true, courseRunId: true },
    });
    if (!session) {
      throw new AcademyValidationError("sessionId not found in company");
    }

    const enrolment = await tx.enrolment.findFirst({
      where: { id: data.enrolmentId, companyId },
      select: { id: true, courseRunId: true },
    });
    if (!enrolment) {
      throw new AcademyValidationError("enrolmentId not found in company");
    }

    if (session.courseRunId && session.courseRunId !== enrolment.courseRunId) {
      throw new AcademyValidationError("enrolmentId is not linked to this session's course run");
    }

    const record = await tx.academyAttendanceRecord.upsert({
      where: {
        sessionId_enrolmentId: { sessionId: data.sessionId, enrolmentId: data.enrolmentId },
      },
      update: {
        attendanceStatus: data.attendanceStatus,
        method: data.method,
        checkInTime,
        checkOutTime,
        markedByUserId: userId,
      },
      create: {
        companyId,
        sessionId: data.sessionId,
        enrolmentId: data.enrolmentId,
        attendanceStatus: data.attendanceStatus,
        method: data.method ?? "manual",
        checkInTime,
        checkOutTime,
        markedByUserId: userId,
      },
    });

    await syncEnrolmentAttendanceStatus(tx, data.enrolmentId, companyId);

    await createAuditLog(
      {
        userId,
        companyId,
        action: "academy.attendance.mark",
        entityType: "AcademyAttendanceRecord",
        entityId: record.id,
        metadata: {
          sessionId: data.sessionId,
          enrolmentId: data.enrolmentId,
          attendanceStatus: data.attendanceStatus,
        },
        ...forensics,
      },
      tx
    );

    return record;
  });
}

/**
 * Marks attendance in bulk inside an atomic transaction ($transaction),
 * verifying course-run scoping and synchronizing all affected enrolments.
 */
export async function markAttendanceBulk(
  companyId: string,
  userId: string,
  sessionId: string,
  rows: BulkMarkRowInput[],
  forensics?: AttendanceForensics
): Promise<{ records: AcademyAttendanceRecord[]; updatedCount: number }> {
  for (const row of rows) {
    if (row.checkInTime != null && !parseDate(row.checkInTime)) {
      throw new AcademyValidationError("Invalid checkInTime");
    }
    if (row.checkOutTime != null && !parseDate(row.checkOutTime)) {
      throw new AcademyValidationError("Invalid checkOutTime");
    }
  }

  return prisma.$transaction(async (tx) => {
    const session = await tx.academyAttendanceSession.findFirst({
      where: { id: sessionId, companyId },
      select: { id: true, courseRunId: true },
    });
    if (!session) {
      throw new AcademyValidationError("sessionId not found in company");
    }

    const enrolmentIds = [...new Set(rows.map((r) => r.enrolmentId))];
    const enrolments = await tx.enrolment.findMany({
      where: { companyId, id: { in: enrolmentIds } },
      select: { id: true, courseRunId: true },
    });

    if (enrolments.length !== enrolmentIds.length) {
      const found = new Set(enrolments.map((e) => e.id));
      const missing = enrolmentIds.filter((id) => !found.has(id));
      throw new AcademyValidationError(`enrolmentId not found: ${missing.join(", ")}`);
    }

    if (session.courseRunId) {
      const invalid = enrolments.find((e) => e.courseRunId !== session.courseRunId);
      if (invalid) {
        throw new AcademyValidationError(
          "One or more enrolments are not linked to this session's course run"
        );
      }
    }

    const records: AcademyAttendanceRecord[] = [];
    for (const r of rows) {
      const checkInTime = r.checkInTime ? parseDate(r.checkInTime) : null;
      const checkOutTime = r.checkOutTime ? parseDate(r.checkOutTime) : null;

      const record = await tx.academyAttendanceRecord.upsert({
        where: {
          sessionId_enrolmentId: { sessionId, enrolmentId: r.enrolmentId },
        },
        update: {
          attendanceStatus: r.attendanceStatus,
          method: r.method,
          checkInTime,
          checkOutTime,
          markedByUserId: userId,
        },
        create: {
          companyId,
          sessionId,
          enrolmentId: r.enrolmentId,
          attendanceStatus: r.attendanceStatus,
          method: r.method ?? "manual",
          checkInTime,
          checkOutTime,
          markedByUserId: userId,
        },
      });
      records.push(record);
    }

    for (const enrId of enrolmentIds) {
      await syncEnrolmentAttendanceStatus(tx, enrId, companyId);
    }

    await createAuditLog(
      {
        userId,
        companyId,
        action: "academy.attendance.mark_bulk",
        entityType: "AcademyAttendanceSession",
        entityId: sessionId,
        metadata: { count: records.length, enrolmentCount: enrolmentIds.length },
        ...forensics,
      },
      tx
    );

    return { records, updatedCount: records.length };
  });
}

/**
 * Unmarks/deletes an attendance record and re-syncs the enrolment's attendance status.
 */
export async function unmarkAttendanceRecord(
  companyId: string,
  userId: string,
  recordId: string,
  forensics?: AttendanceForensics
): Promise<void> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.academyAttendanceRecord.findFirst({
      where: { id: recordId, companyId },
      select: { id: true, enrolmentId: true },
    });
    if (!existing) {
      throw new AcademyNotFoundError("Attendance record not found");
    }

    await tx.academyAttendanceRecord.delete({ where: { id: recordId } });
    await syncEnrolmentAttendanceStatus(tx, existing.enrolmentId, companyId);

    await createAuditLog(
      {
        userId,
        companyId,
        action: "academy.attendance.unmark",
        entityType: "AcademyAttendanceRecord",
        entityId: recordId,
        metadata: { enrolmentId: existing.enrolmentId },
        ...forensics,
      },
      tx
    );
  });
}
