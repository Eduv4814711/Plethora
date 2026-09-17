import { Prisma } from "@prisma/client";
import type {
  Enrolment,
  AcademyInvoice,
  AcademyInvoiceLine,
  AcademyCourseRunStatus,
  AcademyEnrolmentFinancialStatus,
  AcademyEnrolmentAttendanceStatus,
  AcademyEnrolmentCompletionStatus,
  AcademyReportingReadinessStatus,
  AcademyPsiraSubmissionStatus,
  AcademyAdminFeeStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import { ensureLearnerDocumentGate, getAcademyComplianceGate } from "./academy-compliance.service.js";
import {
  computeInvoiceTotals,
  computeLineTotal,
  generateNextInvoiceNumber,
  syncEnrolmentFinancialStatus,
} from "./academy-finance.service.js";
import {
  AcademyServiceError,
  AcademyValidationError,
  AcademyNotFoundError,
  AcademyConflictError,
} from "./academy-student.service.js";

export const ENROLMENT_ALLOWED_RUN_STATUSES: AcademyCourseRunStatus[] = [
  "planned",
  "open",
  "in_progress",
];

export function studentMayEnrol(adminFeeStatus: AcademyAdminFeeStatus): boolean {
  return adminFeeStatus === "paid" || adminFeeStatus === "waived";
}

export function runAcceptsNewEnrolments(status: AcademyCourseRunStatus): boolean {
  return ENROLMENT_ALLOWED_RUN_STATUSES.includes(status);
}

export interface CreateEnrolmentServiceInput {
  studentId: string;
  courseRunId: string;
  enrolmentDate?: string | Date;
  feePlanId?: string | null;
  financialStatus?: AcademyEnrolmentFinancialStatus;
  attendanceStatus?: AcademyEnrolmentAttendanceStatus;
  completionStatus?: AcademyEnrolmentCompletionStatus;
  reportingReadinessStatus?: AcademyReportingReadinessStatus;
  psiraSubmissionStatus?: AcademyPsiraSubmissionStatus;
  remarks?: string | null;

  // Financial integration options:
  createInvoice?: boolean;
  invoiceStatus?: "draft" | "issued";
  invoiceDueDate?: string | Date;
  discountAmount?: number | string | Prisma.Decimal;
  customInvoiceLines?: Array<{
    description: string;
    quantity: number;
    unitAmount: number | string | Prisma.Decimal;
  }>;
}

export interface BatchEnrolmentServiceInput {
  studentId: string;
  courseRunIds: string[];
  createInvoice?: boolean;
  invoiceDueDate?: string | Date;
  discountAmount?: number | string | Prisma.Decimal;
}

export interface UpdateEnrolmentServiceInput {
  feePlanId?: string | null;
  enrolmentDate?: string | Date;
  financialStatus?: AcademyEnrolmentFinancialStatus;
  attendanceStatus?: AcademyEnrolmentAttendanceStatus;
  completionStatus?: AcademyEnrolmentCompletionStatus;
  reportingReadinessStatus?: AcademyReportingReadinessStatus;
  psiraSubmissionStatus?: AcademyPsiraSubmissionStatus;
  remarks?: string | null;
}

export interface ListEnrolmentsOptions {
  companyId: string;
  courseRunId?: string;
  studentId?: string;
  limit?: number;
  offset?: number;
}

export type EnrolmentWithRelations = Enrolment & {
  student: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
    status?: string;
    adminFeeStatus?: string;
  };
  courseRun: {
    id: string;
    runCode: string;
    intakeName?: string | null;
    startDate?: Date;
    endDate?: Date;
    course?: {
      code: string;
      title: string;
      feeAmount?: string | Prisma.Decimal | null;
    };
    branch?: unknown;
  };
  feePlan?: {
    id: string;
    name: string;
  } | null;
};

export interface EnrolmentResult {
  enrolment: EnrolmentWithRelations;
  invoice?: (AcademyInvoice & { items: AcademyInvoiceLine[] }) | null;
}

/**
 * Creates an enrolment inside an atomic transaction ($transaction),
 * checking capacity, updating run capacity, and optionally creating draft/issued invoice.
 */
export async function createEnrolment(
  companyId: string,
  userId: string,
  data: CreateEnrolmentServiceInput
): Promise<EnrolmentResult> {
  // 1. Compliance & Gating Checks
  const academyGate = await getAcademyComplianceGate(companyId);
  if (!academyGate.ok) {
    throw new AcademyValidationError("Academy profile is not compliant for enrolments", {
      blockers: academyGate.blockers,
    });
  }

  const [student, courseRun] = await Promise.all([
    prisma.student.findFirst({
      where: { id: data.studentId, companyId },
      select: { id: true, adminFeeStatus: true, psiraPreRegistrationStatus: true },
    }),
    prisma.courseRun.findFirst({
      where: { id: data.courseRunId, companyId },
      include: { course: true, branch: true },
    }),
  ]);

  if (!student) {
    throw new AcademyValidationError("studentId not found");
  }

  if (!studentMayEnrol(student.adminFeeStatus)) {
    throw new AcademyValidationError(
      "Admin fee must be paid or waived before enrolling this student"
    );
  }

  if (!courseRun) {
    throw new AcademyValidationError("courseRunId not found");
  }

  const docGate = await ensureLearnerDocumentGate(companyId, student.id, courseRun.course.requiresDocuments);
  if (!docGate.ok) {
    throw new AcademyValidationError(docGate.reason ?? "Document gate failed");
  }

  if (!runAcceptsNewEnrolments(courseRun.status)) {
    throw new AcademyValidationError(
      `Course run does not accept new enrolments (status: ${courseRun.status})`
    );
  }

  if (courseRun.course.psiraCategory && student.psiraPreRegistrationStatus !== "completed") {
    throw new AcademyValidationError(
      "Learner must complete PSIRA pre-registration before enrolling in this course run"
    );
  }

  if (data.feePlanId) {
    const plan = await prisma.feePlan.findFirst({
      where: { id: data.feePlanId, companyId },
    });
    if (!plan) {
      throw new AcademyValidationError("feePlanId not found in company");
    }
  }

  const enrolmentDate = data.enrolmentDate ? new Date(data.enrolmentDate) : new Date();
  if (Number.isNaN(enrolmentDate.getTime())) {
    throw new AcademyValidationError("Invalid enrolmentDate");
  }

  // 2. Multi-Table Atomic Transaction
  const { enrolment, invoice } = await prisma.$transaction(async (tx) => {
    // Acquire row-level lock on CourseRun
    try {
      await tx.$executeRaw`SELECT id FROM "CourseRun" WHERE id = ${data.courseRunId} AND "companyId" = ${companyId} FOR UPDATE`;
    } catch {
      // Non-fatal if raw lock unsupported in mock environment
    }

    const lockedRun = await tx.courseRun.findFirst({
      where: { id: data.courseRunId, companyId },
      include: { course: true },
    });

    if (!lockedRun || !runAcceptsNewEnrolments(lockedRun.status)) {
      throw new AcademyValidationError("Course run does not accept new enrolments");
    }

    if (lockedRun.capacity > 0 && lockedRun.enrolledCount >= lockedRun.capacity) {
      throw new AcademyConflictError("Course run is at capacity");
    }

    // Check duplicate enrolment
    const existing = await tx.enrolment.findUnique({
      where: {
        studentId_courseRunId: {
          studentId: data.studentId,
          courseRunId: data.courseRunId,
        },
      },
    });
    if (existing) {
      throw new AcademyConflictError("Student is already enrolled in this course run");
    }

    // Create Enrolment
    const createdEnrolment = await tx.enrolment.create({
      data: {
        companyId,
        studentId: data.studentId,
        courseRunId: data.courseRunId,
        enrolmentDate,
        feePlanId: data.feePlanId ?? null,
        financialStatus: data.financialStatus ?? "unpaid",
        attendanceStatus: data.attendanceStatus ?? "pending",
        completionStatus: data.completionStatus ?? "pending",
        reportingReadinessStatus: data.reportingReadinessStatus ?? "not_started",
        psiraSubmissionStatus: data.psiraSubmissionStatus ?? "not_applicable",
        remarks: data.remarks ?? null,
      },
      include: {
        student: {
          select: {
            id: true,
            studentNumber: true,
            firstName: true,
            lastName: true,
            status: true,
            adminFeeStatus: true,
          },
        },
        courseRun: {
          select: {
            id: true,
            runCode: true,
            intakeName: true,
            startDate: true,
            endDate: true,
            course: { select: { code: true, title: true } },
          },
        },
        feePlan: { select: { id: true, name: true } },
      },
    });

    // Increment CourseRun enrolledCount
    await tx.courseRun.update({
      where: { id: data.courseRunId },
      data: { enrolledCount: { increment: 1 } },
    });

    // Fee calculation and atomic invoice creation
    let createdInvoice: (AcademyInvoice & { items: AcademyInvoiceLine[] }) | null = null;

    const shouldCreateInvoice =
      data.createInvoice !== false &&
      (Boolean(data.customInvoiceLines?.length) ||
        (lockedRun.course.feeAmount != null &&
          new Prisma.Decimal(lockedRun.course.feeAmount).gt(0)));

    if (shouldCreateInvoice) {
      const invoiceNumber = await generateNextInvoiceNumber(companyId, tx);
      const discountAmount = data.discountAmount
        ? new Prisma.Decimal(String(data.discountAmount))
        : new Prisma.Decimal(0);

      const lineItems =
        data.customInvoiceLines && data.customInvoiceLines.length > 0
          ? data.customInvoiceLines.map((l) => {
              const unit = new Prisma.Decimal(String(l.unitAmount));
              return {
                description: l.description,
                quantity: l.quantity,
                unitAmount: unit,
                lineTotal: computeLineTotal(l.quantity, unit),
              };
            })
          : [
              {
                description: `Tuition Fee - ${lockedRun.course.code} ${lockedRun.course.title} (${lockedRun.runCode})`,
                quantity: 1,
                unitAmount: new Prisma.Decimal(lockedRun.course.feeAmount ?? 0),
                lineTotal: new Prisma.Decimal(lockedRun.course.feeAmount ?? 0),
              },
            ];

      const { subtotal, totalAmount } = computeInvoiceTotals(lineItems, discountAmount);
      if (totalAmount.lt(0)) {
        throw new AcademyValidationError("Invoice total amount cannot be negative");
      }

      const invoiceDate = enrolmentDate;
      const dueDate = data.invoiceDueDate
        ? new Date(data.invoiceDueDate)
        : new Date(lockedRun.startDate);

      createdInvoice = await tx.academyInvoice.create({
        data: {
          companyId,
          studentId: data.studentId,
          enrolmentId: createdEnrolment.id,
          invoiceNumber,
          invoiceDate,
          dueDate,
          subtotal,
          discountAmount,
          totalAmount,
          status: data.invoiceStatus ?? "draft",
          items: {
            create: lineItems.map((it) => ({
              description: it.description,
              quantity: it.quantity,
              unitAmount: it.unitAmount,
              lineTotal: it.lineTotal,
            })),
          },
        },
        include: { items: true },
      });

      if (createdInvoice.status !== "draft" && createdInvoice.status !== "cancelled") {
        await syncEnrolmentFinancialStatus(tx, createdEnrolment.id, companyId);
      }
    }

    return { enrolment: createdEnrolment as EnrolmentWithRelations, invoice: createdInvoice };
  });

  // Post-Transaction Audit Logging
  await createAuditLog({
    userId,
    companyId,
    action: "academy.enrolment.create",
    entityType: "Enrolment",
    entityId: enrolment.id,
    metadata: {
      studentId: enrolment.studentId,
      courseRunId: enrolment.courseRunId,
      invoiceId: invoice?.id,
    },
  });

  if (invoice) {
    await createAuditLog({
      userId,
      companyId,
      action: "academy.invoice.create",
      entityType: "AcademyInvoice",
      entityId: invoice.id,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: invoice.totalAmount.toString(),
      },
    });
  }

  return { enrolment, invoice };
}

/**
 * Batch enrols a student into multiple course runs atomically.
 */
export async function batchEnrolLearners(
  companyId: string,
  userId: string,
  data: BatchEnrolmentServiceInput
): Promise<Enrolment[]> {
  const academyGate = await getAcademyComplianceGate(companyId);
  if (!academyGate.ok) {
    throw new AcademyValidationError("Academy profile is not compliant for enrolments", {
      blockers: academyGate.blockers,
    });
  }

  const student = await prisma.student.findFirst({
    where: { id: data.studentId, companyId },
    select: { id: true, adminFeeStatus: true, studentNumber: true, psiraPreRegistrationStatus: true },
  });
  if (!student) {
    throw new AcademyValidationError("studentId not found");
  }

  if (!studentMayEnrol(student.adminFeeStatus)) {
    throw new AcademyValidationError(
      "Admin fee must be paid or waived before enrolling this student"
    );
  }

  const courseRunIds = [...new Set(data.courseRunIds)];
  const runs = await prisma.courseRun.findMany({
    where: { companyId, id: { in: courseRunIds } },
    select: {
      id: true,
      runCode: true,
      status: true,
      capacity: true,
      enrolledCount: true,
      startDate: true,
      course: {
        select: {
          id: true,
          code: true,
          title: true,
          psiraCategory: true,
          requiresDocuments: true,
          feeAmount: true,
        },
      },
    },
  });

  if (runs.length !== courseRunIds.length) {
    const found = new Set(runs.map((r) => r.id));
    const missing = courseRunIds.filter((id) => !found.has(id));
    throw new AcademyValidationError(`courseRunId not found: ${missing.join(", ")}`);
  }

  const anyRequiresDocs = runs.some((r) => r.course.requiresDocuments !== false);
  const docGate = await ensureLearnerDocumentGate(companyId, student.id, anyRequiresDocs);
  if (!docGate.ok) {
    throw new AcademyValidationError(docGate.reason ?? "Document gate failed");
  }

  for (const r of runs) {
    if (r.course.psiraCategory && student.psiraPreRegistrationStatus !== "completed") {
      throw new AcademyValidationError(
        `Learner must complete PSIRA pre-registration before enrolling in PSIRA-linked course run ${r.id}`
      );
    }
    if (!runAcceptsNewEnrolments(r.status)) {
      throw new AcademyValidationError(
        `Course run ${r.id} does not accept new enrolments (status: ${r.status})`
      );
    }
    if (r.capacity > 0 && r.enrolledCount >= r.capacity) {
      throw new AcademyConflictError(`Course run ${r.id} is at capacity`);
    }
  }

  const existing = await prisma.enrolment.findMany({
    where: { studentId: data.studentId, courseRunId: { in: courseRunIds } },
    select: { courseRunId: true },
  });
  if (existing.length > 0) {
    throw new AcademyConflictError(
      `Student is already enrolled in course run(s): ${existing.map((e) => e.courseRunId).join(", ")}`
    );
  }

  const enrolmentDate = new Date();

  const created = await prisma.$transaction(async (tx) => {
    const results: Enrolment[] = [];
    for (const runId of courseRunIds) {
      const r = runs.find((item) => item.id === runId)!;
      const lockedRun = await tx.courseRun.findFirst({
        where: { id: runId, companyId },
        select: { id: true, status: true, capacity: true, enrolledCount: true },
      });
      if (!lockedRun || !runAcceptsNewEnrolments(lockedRun.status)) {
        throw new AcademyValidationError(`Course run ${runId} no longer accepts enrolments`);
      }
      if (lockedRun.capacity > 0 && lockedRun.enrolledCount >= lockedRun.capacity) {
        throw new AcademyConflictError(`Course run ${runId} is at capacity`);
      }
      const e = await tx.enrolment.create({
        data: {
          companyId,
          studentId: data.studentId,
          courseRunId: runId,
          enrolmentDate,
        },
        include: {
          student: { select: { studentNumber: true, firstName: true, lastName: true } },
          courseRun: { select: { runCode: true } },
        },
      });
      await tx.courseRun.update({
        where: { id: runId },
        data: { enrolledCount: { increment: 1 } },
      });

      // Optional draft invoice creation matching single enrolment
      if (
        data.createInvoice !== false &&
        r.course.feeAmount != null &&
        new Prisma.Decimal(r.course.feeAmount).gt(0)
      ) {
        const invoiceNumber = await generateNextInvoiceNumber(companyId, tx);
        const feeDecimal = new Prisma.Decimal(r.course.feeAmount);
        const discountAmount = data.discountAmount
          ? new Prisma.Decimal(String(data.discountAmount))
          : new Prisma.Decimal(0);
        const lineTotal = feeDecimal;
        const { subtotal, totalAmount } = computeInvoiceTotals(
          [
            {
              quantity: 1,
              unitAmount: feeDecimal,
              lineTotal,
            },
          ],
          discountAmount
        );
        if (totalAmount.lt(0)) {
          throw new AcademyValidationError("Invoice total amount cannot be negative");
        }
        const dueDate = data.invoiceDueDate
          ? new Date(data.invoiceDueDate)
          : new Date(r.startDate);

        await tx.academyInvoice.create({
          data: {
            companyId,
            studentId: data.studentId,
            enrolmentId: e.id,
            invoiceNumber,
            invoiceDate: enrolmentDate,
            dueDate,
            subtotal,
            discountAmount,
            totalAmount,
            status: "draft",
            items: {
              create: [
                {
                  description: `Tuition Fee - ${r.course.code} ${r.course.title} (${r.runCode})`,
                  quantity: 1,
                  unitAmount: feeDecimal,
                  lineTotal,
                },
              ],
            },
          },
        });
      }

      results.push(e);
    }
    return results;
  });

  await createAuditLog({
    userId,
    companyId,
    action: "academy.enrolment.batch_create",
    entityType: "Enrolment",
    entityId: created[0]?.id ?? data.studentId,
    metadata: { studentId: data.studentId, courseRunIds, count: created.length },
  });

  return created;
}

/**
 * Retrieves an enrolment by ID scoped to tenant.
 */
export async function getEnrolmentById(
  companyId: string,
  enrolmentId: string
): Promise<EnrolmentWithRelations> {
  const enrolment = await prisma.enrolment.findFirst({
    where: { id: enrolmentId, companyId },
    include: {
      student: true,
      courseRun: { include: { course: true, branch: true } },
      feePlan: true,
    },
  });

  if (!enrolment) {
    throw new AcademyNotFoundError("Enrolment not found");
  }

  return {
    ...enrolment,
    courseRun: {
      ...enrolment.courseRun,
      course: {
        ...enrolment.courseRun.course,
        feeAmount:
          enrolment.courseRun.course.feeAmount != null
            ? enrolment.courseRun.course.feeAmount.toString()
            : null,
      },
    },
  } as EnrolmentWithRelations;
}

/**
 * Lists enrolments with optional filtering and pagination.
 */
export async function listEnrolments(options: ListEnrolmentsOptions): Promise<{
  enrolments: EnrolmentWithRelations[];
  total: number;
  limit: number;
  offset: number;
}> {
  const { companyId, courseRunId, studentId } = options;
  const limit = Math.min(Number(options.limit) || 100, 200);
  const offset = Number(options.offset) || 0;

  const where: Prisma.EnrolmentWhereInput = {
    companyId,
    ...(courseRunId ? { courseRunId } : {}),
    ...(studentId ? { studentId } : {}),
  };

  const [enrolments, total] = await Promise.all([
    prisma.enrolment.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { enrolmentDate: "desc" },
      include: {
        student: {
          select: {
            id: true,
            studentNumber: true,
            firstName: true,
            lastName: true,
            status: true,
            adminFeeStatus: true,
          },
        },
        courseRun: {
          select: {
            id: true,
            runCode: true,
            intakeName: true,
            startDate: true,
            endDate: true,
            course: { select: { code: true, title: true } },
          },
        },
        feePlan: { select: { id: true, name: true } },
      },
    }),
    prisma.enrolment.count({ where }),
  ]);

  return {
    enrolments: enrolments as unknown as EnrolmentWithRelations[],
    total,
    limit,
    offset,
  };
}

/**
 * Updates an enrolment's metadata or status.
 */
export async function updateEnrolment(
  companyId: string,
  enrolmentId: string,
  userId: string,
  data: UpdateEnrolmentServiceInput
): Promise<Enrolment> {
  const existing = await prisma.enrolment.findFirst({ where: { id: enrolmentId, companyId } });
  if (!existing) {
    throw new AcademyNotFoundError("Enrolment not found");
  }

  if (data.feePlanId) {
    const plan = await prisma.feePlan.findFirst({ where: { id: data.feePlanId, companyId } });
    if (!plan) {
      throw new AcademyValidationError("feePlanId not found in company");
    }
  }

  let parsedEnrolmentDate: Date | undefined = undefined;
  if (data.enrolmentDate != null) {
    parsedEnrolmentDate = new Date(data.enrolmentDate);
    if (Number.isNaN(parsedEnrolmentDate.getTime())) {
      throw new AcademyValidationError("Invalid enrolmentDate");
    }
  }

  const enrolment = await prisma.enrolment.update({
    where: { id: enrolmentId },
    data: {
      ...(parsedEnrolmentDate != null ? { enrolmentDate: parsedEnrolmentDate } : {}),
      ...(data.feePlanId !== undefined ? { feePlanId: data.feePlanId } : {}),
      ...(data.financialStatus != null ? { financialStatus: data.financialStatus } : {}),
      ...(data.attendanceStatus != null ? { attendanceStatus: data.attendanceStatus } : {}),
      ...(data.completionStatus != null ? { completionStatus: data.completionStatus } : {}),
      ...(data.reportingReadinessStatus != null
        ? { reportingReadinessStatus: data.reportingReadinessStatus }
        : {}),
      ...(data.psiraSubmissionStatus != null
        ? { psiraSubmissionStatus: data.psiraSubmissionStatus }
        : {}),
      ...(data.remarks !== undefined ? { remarks: data.remarks } : {}),
    },
    include: {
      student: { select: { id: true, studentNumber: true, firstName: true, lastName: true } },
      courseRun: { select: { id: true, runCode: true } },
    },
  });

  await createAuditLog({
    userId,
    companyId,
    action: "academy.enrolment.update",
    entityType: "Enrolment",
    entityId: enrolment.id,
    metadata: data as Record<string, unknown>,
  });

  return enrolment;
}

export interface EnrolmentLifecycleEvaluation {
  attendanceStatus: AcademyEnrolmentAttendanceStatus;
  completionStatus: AcademyEnrolmentCompletionStatus;
  reportingReadinessStatus: AcademyReportingReadinessStatus;
  blockers: string[];
}

/**
 * Re-evaluates and synchronizes operational and compliance statuses
 * across attendance, assessment, finance, and learner document domains.
 */
export async function evaluateAndSyncEnrolmentLifecycle(
  tx: Prisma.TransactionClient,
  enrolmentId: string,
  companyId: string
): Promise<EnrolmentLifecycleEvaluation> {
  const enrolment = await tx.enrolment.findFirst({
    where: { id: enrolmentId, companyId },
    include: {
      student: { select: { id: true } },
      courseRun: {
        include: {
          course: true,
          academyAttendanceSessions: { select: { id: true } },
        },
      },
      academyAttendanceRecords: { select: { attendanceStatus: true } },
    },
  });

  if (!enrolment) {
    throw new AcademyNotFoundError("Enrolment not found");
  }

  const course = enrolment.courseRun.course;
  const blockers: string[] = [];

  // 1. Evaluate Attendance Compliance
  const totalSessions = enrolment.courseRun.academyAttendanceSessions.length;
  const records = enrolment.academyAttendanceRecords;
  const attendedCount = records.filter(
    (r) => r.attendanceStatus === "present" || r.attendanceStatus === "late"
  ).length;
  const minRequired = course.minimumAttendancePercent ?? 80;

  let nextAttendance: AcademyEnrolmentAttendanceStatus = enrolment.attendanceStatus;
  if (totalSessions > 0) {
    const maxPossibleAttended = attendedCount + (totalSessions - records.length);
    const maxPossiblePercent = (maxPossibleAttended / totalSessions) * 100;
    const currentTotalPercent = (attendedCount / totalSessions) * 100;

    if (records.length < totalSessions) {
      if (maxPossiblePercent < minRequired) {
        nextAttendance = "non_compliant";
      } else if (currentTotalPercent >= minRequired) {
        nextAttendance = "compliant";
      } else {
        nextAttendance = records.length > 0 ? "in_progress" : "pending";
      }
    } else {
      nextAttendance = currentTotalPercent >= minRequired ? "compliant" : "non_compliant";
    }
  } else {
    if (records.length === 0) {
      nextAttendance = "pending";
    } else {
      const currentPercent = (attendedCount / records.length) * 100;
      nextAttendance = currentPercent >= minRequired ? "compliant" : "non_compliant";
    }
  }

  const isAttendanceCompliant = nextAttendance === "compliant";
  if (!isAttendanceCompliant) {
    blockers.push(`Attendance is not compliant (status: ${nextAttendance})`);
  }

  // 2. Evaluate Academic Completion
  let nextCompletion: AcademyEnrolmentCompletionStatus = enrolment.completionStatus;
  let academicComplete = false;

  if (course.requiresAssessment) {
    const assessments = await tx.academyAssessment.findMany({
      where: { companyId, learnerId: enrolment.studentId, courseId: course.id },
      orderBy: { assessmentDate: "desc" },
    });

    const hasPassing = assessments.some(
      (a) => a.result === "pass" || a.result === "competent"
    );

    if (hasPassing) {
      nextCompletion = "completed";
      academicComplete = true;
    } else if (assessments.length > 0) {
      const maxAttempt = Math.max(...assessments.map((a) => a.attemptNumber));
      const lastAssessment = assessments[0];
      if (maxAttempt >= 3 && !lastAssessment.reassessmentDate) {
        nextCompletion = "failed";
      } else {
        nextCompletion = "in_progress";
      }
    } else {
      nextCompletion = "pending";
    }
  } else {
    // Non-assessment course: completion is driven by attendance compliance
    if (isAttendanceCompliant) {
      nextCompletion = "completed";
      academicComplete = true;
    } else if (nextAttendance === "in_progress") {
      nextCompletion = "in_progress";
    } else if (nextAttendance === "non_compliant") {
      nextCompletion = "failed";
    } else {
      nextCompletion = "pending";
    }
  }

  if (!academicComplete) {
    blockers.push(`Academic requirements not completed (status: ${nextCompletion})`);
  }

  // 3. Evaluate Financial Status
  const isFinancePaid = enrolment.financialStatus === "paid";
  if (!isFinancePaid) {
    blockers.push(`Tuition fee not fully paid (current financial status: ${enrolment.financialStatus})`);
  }

  // 4. Evaluate Document Compliance
  let docsCompliant = true;
  if (course.requiresDocuments) {
    const docCount = await tx.studentDocument.count({
      where: { companyId, studentId: enrolment.studentId, deletedAt: null },
    });
    docsCompliant = docCount > 0;
  }
  if (!docsCompliant) {
    blockers.push("Mandatory student compliance documents missing");
  }

  // 5. Evaluate Reporting Readiness Status
  let nextReadiness: AcademyReportingReadinessStatus = "not_started";
  if (nextCompletion === "failed" || nextAttendance === "non_compliant") {
    nextReadiness = "blocked";
  } else if (academicComplete && isAttendanceCompliant && isFinancePaid && docsCompliant) {
    nextReadiness = "ready";
  } else if (
    nextAttendance === "in_progress" ||
    nextCompletion === "in_progress" ||
    enrolment.financialStatus === "partial" ||
    records.length > 0
  ) {
    nextReadiness = "incomplete";
  }

  // 6. Update Enrolment state if changed
  if (
    nextAttendance !== enrolment.attendanceStatus ||
    nextCompletion !== enrolment.completionStatus ||
    nextReadiness !== enrolment.reportingReadinessStatus
  ) {
    await tx.enrolment.update({
      where: { id: enrolmentId },
      data: {
        attendanceStatus: nextAttendance,
        completionStatus: nextCompletion,
        reportingReadinessStatus: nextReadiness,
      },
    });
  }

  return {
    attendanceStatus: nextAttendance,
    completionStatus: nextCompletion,
    reportingReadinessStatus: nextReadiness,
    blockers,
  };
}

/**
 * Cancels or deletes an enrolment, atomically decrementing CourseRun.enrolledCount.
 * Rejects if verified payments exist on any invoice linked to this enrolment.
 * Deletes or cancels draft/unpaid invoices so they aren't orphaned.
 */
export async function cancelOrDeleteEnrolment(
  companyId: string,
  enrolmentId: string,
  userId: string
): Promise<void> {
  const existing = await prisma.enrolment.findFirst({
    where: { id: enrolmentId, companyId },
    select: { id: true, courseRunId: true, studentId: true },
  });

  if (!existing) {
    throw new AcademyNotFoundError("Enrolment not found");
  }

  // Check if any invoice linked to this enrolment has verified payments
  const linkedInvoices = await prisma.academyInvoice.findMany({
    where: { enrolmentId, companyId },
    include: {
      payments: { where: { verificationStatus: "verified" } },
    },
  });

  const hasVerifiedPayments = linkedInvoices.some((inv) => inv.payments.length > 0);
  if (hasVerifiedPayments) {
    throw new AcademyConflictError("Cannot delete enrolment with verified payments");
  }

  await prisma.$transaction(async (tx) => {
    // Delete draft invoices linked to this enrolment
    await tx.academyInvoice.deleteMany({
      where: { enrolmentId, companyId, status: "draft" },
    });

    // Cancel any non-draft invoices without verified payments
    await tx.academyInvoice.updateMany({
      where: { enrolmentId, companyId },
      data: { status: "cancelled", enrolmentId: null },
    });

    await tx.enrolment.delete({ where: { id: enrolmentId } });
    await tx.courseRun.update({
      where: { id: existing.courseRunId },
      data: { enrolledCount: { decrement: 1 } },
    });
  });

  await createAuditLog({
    userId,
    companyId,
    action: "academy.enrolment.delete",
    entityType: "Enrolment",
    entityId: enrolmentId,
    metadata: { courseRunId: existing.courseRunId, studentId: existing.studentId },
  });
}
