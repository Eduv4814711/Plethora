import { Prisma } from "@prisma/client";
import type {
  AcademyAssessment,
  AcademyAssessmentResult,
  AcademyEnrolmentCompletionStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import {
  AcademyServiceError,
  AcademyValidationError,
  AcademyNotFoundError,
} from "./academy-student.service.js";
import { evaluateAndSyncEnrolmentLifecycle } from "./academy-enrolment.service.js";

export interface AttendanceForensics {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface RecordAssessmentInput {
  learnerId: string;
  courseId: string;
  instructorId?: string | null;
  assessmentType: string;
  assessmentDate: string | Date;
  venue?: string | null;
  attemptNumber?: number;
  mark?: number | string | Prisma.Decimal | null;
  result?: AcademyAssessmentResult | null;
  moderationStatus?: string | null;
  reassessmentDate?: string | Date | null;
}

export interface UpdateAssessmentInput {
  instructorId?: string | null;
  assessmentType?: string;
  assessmentDate?: string | Date;
  venue?: string | null;
  attemptNumber?: number;
  mark?: number | string | Prisma.Decimal | null;
  result?: AcademyAssessmentResult | null;
  moderationStatus?: string | null;
  reassessmentDate?: string | Date | null;
}

export interface ListAssessmentsParams {
  learnerId?: string;
  courseId?: string;
  result?: AcademyAssessmentResult;
  limit?: number;
  offset?: number;
}

function parseDate(v?: string | Date | null): Date | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function validateAndFormatMark(mark: number | string | Prisma.Decimal | null | undefined): Prisma.Decimal | undefined {
  if (mark == null || mark === "") return undefined;
  const num = Number(mark);
  if (Number.isNaN(num) || num < 0 || num > 100) {
    throw new AcademyValidationError("Assessment mark must be a valid number between 0 and 100");
  }
  return new Prisma.Decimal(num.toFixed(2));
}

/**
 * Lists assessments with filters and pagination scoped to tenant.
 */
export async function listAssessments(
  companyId: string,
  options: ListAssessmentsParams
): Promise<{ assessments: AcademyAssessment[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Number(options.limit) || 100, 200);
  const offset = Number(options.offset) || 0;

  const where: Prisma.AcademyAssessmentWhereInput = {
    companyId,
    ...(options.learnerId ? { learnerId: options.learnerId } : {}),
    ...(options.courseId ? { courseId: options.courseId } : {}),
    ...(options.result ? { result: options.result } : {}),
  };

  const [assessments, total] = await Promise.all([
    prisma.academyAssessment.findMany({
      where,
      include: { learner: true, course: true, instructor: true },
      orderBy: { assessmentDate: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.academyAssessment.count({ where }),
  ]);

  return { assessments, total, limit, offset };
}

/**
 * Retrieves an assessment by ID scoped to tenant.
 */
export async function getAssessmentById(
  companyId: string,
  assessmentId: string
): Promise<AcademyAssessment | null> {
  return prisma.academyAssessment.findFirst({
    where: { id: assessmentId, companyId },
    include: { learner: true, course: true, instructor: true },
  });
}

/**
 * Evaluates enrolment academic completion status based on recorded assessments.
 */
async function syncEnrolmentCompletionFromAssessments(
  tx: Prisma.TransactionClient,
  companyId: string,
  learnerId: string,
  courseId: string
): Promise<void> {
  const enrolment = await tx.enrolment.findFirst({
    where: { companyId, studentId: learnerId, courseRun: { courseId } },
    include: { courseRun: true },
    orderBy: { createdAt: "desc" },
  });

  if (!enrolment) return;

  await evaluateAndSyncEnrolmentLifecycle(tx, enrolment.id, companyId);
}

/**
 * Records a learner assessment inside an atomic transaction ($transaction),
 * checking foreign keys and auto-advancing Enrolment completion and readiness statuses.
 */
export async function recordAssessment(
  companyId: string,
  userId: string,
  data: RecordAssessmentInput,
  forensics?: AttendanceForensics
): Promise<{ assessment: AcademyAssessment; enrolmentStatus?: AcademyEnrolmentCompletionStatus }> {
  const assessmentDate = parseDate(data.assessmentDate);
  if (!assessmentDate) {
    throw new AcademyValidationError("Invalid assessmentDate");
  }

  const reassessmentDate = data.reassessmentDate ? parseDate(data.reassessmentDate) : null;
  if (data.reassessmentDate != null && !reassessmentDate) {
    throw new AcademyValidationError("Invalid reassessmentDate");
  }

  const decimalMark = validateAndFormatMark(data.mark);

  let derivedResult = data.result;
  if (!derivedResult && decimalMark != null) {
    derivedResult = decimalMark.gte(50) ? "pass" : "fail";
  }

  return prisma.$transaction(async (tx) => {
    // 1. Cross-tenant foreign reference checks
    const [student, course] = await Promise.all([
      tx.student.findFirst({ where: { id: data.learnerId, companyId }, select: { id: true } }),
      tx.course.findFirst({
        where: { id: data.courseId, companyId },
        select: { id: true, requiresAssessment: true },
      }),
    ]);

    if (!student) throw new AcademyValidationError("learnerId not found in company");
    if (!course) throw new AcademyValidationError("courseId not found in company");

    if (data.instructorId) {
      const instructor = await tx.academyInstructor.findFirst({
        where: { id: data.instructorId, companyId },
        select: { id: true },
      });
      if (!instructor) throw new AcademyValidationError("instructorId not found in company");
    }

    // 2. Enrolment verification
    const enrolment = await tx.enrolment.findFirst({
      where: { companyId, studentId: data.learnerId, courseRun: { courseId: data.courseId } },
      include: { courseRun: true },
      orderBy: { createdAt: "desc" },
    });

    if (!enrolment) {
      throw new AcademyValidationError("Learner is not enrolled in this course");
    }

    // 3. Attempt Number resolution
    let attemptNumber = data.attemptNumber;
    if (!attemptNumber) {
      const previousAttempts = await tx.academyAssessment.count({
        where: { companyId, learnerId: data.learnerId, courseId: data.courseId },
      });
      attemptNumber = previousAttempts + 1;
    }

    // 4. Create Assessment Record
    const assessment = await tx.academyAssessment.create({
      data: {
        companyId,
        learnerId: data.learnerId,
        courseId: data.courseId,
        instructorId: data.instructorId ?? null,
        assessmentType: data.assessmentType,
        assessmentDate,
        venue: data.venue ?? null,
        attemptNumber,
        mark: decimalMark,
        result: derivedResult ?? undefined,
        moderationStatus: data.moderationStatus ?? null,
        reassessmentDate,
      },
      include: { learner: true, course: true, instructor: true },
    });

    // 5. Synchronize Enrolment Completion & Readiness
    await syncEnrolmentCompletionFromAssessments(tx, companyId, data.learnerId, data.courseId);

    const updatedEnrolment = await tx.enrolment.findUnique({
      where: { id: enrolment.id },
      select: { completionStatus: true },
    });

    // 6. Audit logging
    await createAuditLog(
      {
        userId,
        companyId,
        action: "academy.assessment.create",
        entityType: "AcademyAssessment",
        entityId: assessment.id,
        metadata: {
          mark: decimalMark?.toString(),
          result: derivedResult,
          attemptNumber,
        },
        ...forensics,
      },
      tx
    );

    return { assessment, enrolmentStatus: updatedEnrolment?.completionStatus };
  });
}

/**
 * Updates an assessment and re-syncs enrolment completion criteria.
 */
export async function updateAssessment(
  companyId: string,
  userId: string,
  assessmentId: string,
  data: UpdateAssessmentInput,
  forensics?: AttendanceForensics
): Promise<AcademyAssessment> {
  const existing = await prisma.academyAssessment.findFirst({
    where: { id: assessmentId, companyId },
  });
  if (!existing) {
    throw new AcademyNotFoundError("Assessment not found");
  }

  let assessmentDate = existing.assessmentDate;
  if (data.assessmentDate != null) {
    const parsed = parseDate(data.assessmentDate);
    if (!parsed) throw new AcademyValidationError("Invalid assessmentDate");
    assessmentDate = parsed;
  }

  const reassessmentDate =
    data.reassessmentDate !== undefined
      ? data.reassessmentDate
        ? parseDate(data.reassessmentDate)
        : null
      : existing.reassessmentDate;

  if (data.reassessmentDate != null && !reassessmentDate) {
    throw new AcademyValidationError("Invalid reassessmentDate");
  }

  const decimalMark =
    data.mark !== undefined ? validateAndFormatMark(data.mark) : existing.mark;

  if (data.instructorId) {
    const instructor = await prisma.academyInstructor.findFirst({
      where: { id: data.instructorId, companyId },
      select: { id: true },
    });
    if (!instructor) throw new AcademyValidationError("instructorId not found in company");
  }

  return prisma.$transaction(async (tx) => {
    const assessment = await tx.academyAssessment.update({
      where: { id: assessmentId },
      data: {
        ...(data.instructorId !== undefined ? { instructorId: data.instructorId } : {}),
        ...(data.assessmentType !== undefined ? { assessmentType: data.assessmentType } : {}),
        assessmentDate,
        ...(data.venue !== undefined ? { venue: data.venue } : {}),
        ...(data.attemptNumber !== undefined ? { attemptNumber: data.attemptNumber } : {}),
        mark: decimalMark,
        ...(data.result !== undefined ? { result: data.result } : {}),
        ...(data.moderationStatus !== undefined ? { moderationStatus: data.moderationStatus } : {}),
        reassessmentDate,
      },
      include: { learner: true, course: true, instructor: true },
    });

    await syncEnrolmentCompletionFromAssessments(
      tx,
      companyId,
      existing.learnerId,
      existing.courseId
    );

    await createAuditLog(
      {
        userId,
        companyId,
        action: "academy.assessment.update",
        entityType: "AcademyAssessment",
        entityId: assessmentId,
        metadata: data as Record<string, unknown>,
        ...forensics,
      },
      tx
    );

    return assessment;
  });
}

/**
 * Deletes an assessment and re-evaluates the learner's enrolment completion state.
 */
export async function deleteAssessment(
  companyId: string,
  userId: string,
  assessmentId: string,
  forensics?: AttendanceForensics
): Promise<void> {
  const existing = await prisma.academyAssessment.findFirst({
    where: { id: assessmentId, companyId },
    select: { id: true, learnerId: true, courseId: true },
  });
  if (!existing) {
    throw new AcademyNotFoundError("Assessment not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.academyAssessment.delete({ where: { id: assessmentId } });
    await syncEnrolmentCompletionFromAssessments(
      tx,
      companyId,
      existing.learnerId,
      existing.courseId
    );

    await createAuditLog(
      {
        userId,
        companyId,
        action: "academy.assessment.delete",
        entityType: "AcademyAssessment",
        entityId: assessmentId,
        ...forensics,
      },
      tx
    );
  });
}
