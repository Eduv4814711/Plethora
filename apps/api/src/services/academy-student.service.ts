import { Prisma } from "@prisma/client";
import type {
  Student,
  AcademyStudentStatus,
  AcademyPsiraPreRegistrationStatus,
  AcademyAdminFeeStatus,
  AcademyStudentDocumentType,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import { ensureLearnerDocumentGate, getAcademyComplianceGate } from "./academy-compliance.service.js";

/**
 * Standard domain error for Academy services.
 */
export class AcademyServiceError extends Error {
  public readonly statusCode: number;
  public readonly error: string;
  public readonly details?: unknown;
  public readonly blockers?: string[];

  constructor(
    statusCode: number,
    error: string,
    message: string,
    options?: { details?: unknown; blockers?: string[] }
  ) {
    super(message);
    this.name = "AcademyServiceError";
    this.statusCode = statusCode;
    this.error = error;
    this.details = options?.details;
    this.blockers = options?.blockers;
    Object.setPrototypeOf(this, AcademyServiceError.prototype);
  }

  toJSON() {
    return {
      error: this.error,
      message: this.message,
      statusCode: this.statusCode,
      ...(this.details !== undefined ? { details: this.details } : {}),
      ...(this.blockers !== undefined ? { blockers: this.blockers } : {}),
    };
  }
}

export class AcademyValidationError extends AcademyServiceError {
  constructor(message: string, options?: { details?: unknown; blockers?: string[] }) {
    super(400, "Validation error", message, options);
  }
}

export class AcademyNotFoundError extends AcademyServiceError {
  constructor(message: string) {
    super(404, "Not found", message);
  }
}

export class AcademyForbiddenError extends AcademyServiceError {
  constructor(message: string) {
    super(403, "Forbidden", message);
  }
}

export class AcademyConflictError extends AcademyServiceError {
  constructor(message: string) {
    super(409, "Conflict", message);
  }
}

export interface CreateStudentData {
  studentNumber?: string | null;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  preferredName?: string | null;
  idType?: string | null;
  idNumber?: string | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  nationality?: string | null;
  phone?: string | null;
  alternatePhone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  nextOfKinName?: string | null;
  nextOfKinPhone?: string | null;
  psiraProfileReference?: string | null;
  psiraPreRegistrationStatus?: AcademyPsiraPreRegistrationStatus;
  status?: AcademyStudentStatus;
  employeeId?: string | null;
}

export interface UpdateStudentData extends Partial<CreateStudentData> {}

export interface RecordAdminFeeData {
  status: "paid" | "waived" | "unpaid";
  amount?: number | string | Prisma.Decimal | null;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
}

export interface ListStudentsOptions {
  companyId: string;
  search?: string;
  status?: AcademyStudentStatus;
  limit?: number;
  offset?: number;
  canAccessSensitive?: boolean;
}

export interface DocumentEligibilityResult {
  eligible: boolean;
  documentCount: number;
  documents: Array<{
    id: string;
    documentType: AcademyStudentDocumentType;
    fileName: string;
    createdAt: Date;
  }>;
  missingRequirements: string[];
}

export type StudentWithDetails = Student & {
  employee?: {
    id: string;
    employeeNumber: string;
    firstName: string;
    lastName: string;
  } | null;
  _count?: {
    documents: number;
    enrolments: number;
  };
};

/**
 * Generates the next sequential student number (STU-YYYY-XXXX) for a company
 * using PostgreSQL transaction advisory locking and SQL aggregation.
 */
export async function generateNextStudentNumber(
  companyId: string,
  tx: Prisma.TransactionClient = prisma
): Promise<string> {
  const year = new Date().getUTCFullYear();
  const yearPrefix = `STU-${year}-`;
  const substringOffset = yearPrefix.length + 1;
  const regexPattern = `^STU-${year}-[0-9]+$`;

  const run = async (client: Prisma.TransactionClient): Promise<string> => {
    let maxNum = 0;
    try {
      await client.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'academy-student:' + companyId}))`);
      const result = await client.$queryRaw<Array<{ maxNum: number | bigint | null }>>(Prisma.sql`
        SELECT COALESCE(
          MAX(CAST(SUBSTRING("studentNumber" FROM ${substringOffset}) AS INTEGER)),
          0
        ) AS "maxNum"
        FROM "Student"
        WHERE "companyId" = ${companyId}
          AND "studentNumber" ~ ${regexPattern}
      `);
      maxNum = Number(result[0]?.maxNum ?? 0);
    } catch {
      // Fallback for mock/test environments
      const students = await client.student.findMany({
        where: { companyId, studentNumber: { startsWith: yearPrefix } },
        select: { studentNumber: true },
      });
      const pattern = new RegExp(`^STU-${year}-(\\d+)$`);
      for (const s of students) {
        const m = s.studentNumber.match(pattern);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      }
    }
    return `${yearPrefix}${String(maxNum + 1).padStart(4, "0")}`;
  };

  if ("$queryRaw" in tx && tx !== prisma) {
    return run(tx);
  }

  return prisma.$transaction(async (innerTx) => run(innerTx));
}

/**
 * Valid allowed status transitions for AcademyStudentStatus state machine.
 */
const ALLOWED_STUDENT_STATUS_TRANSITIONS: Record<AcademyStudentStatus, AcademyStudentStatus[]> = {
  prospect: ["registered", "inactive", "blocked"],
  registered: ["active", "inactive", "blocked"],
  active: ["completed", "inactive", "blocked"],
  completed: ["active", "inactive"],
  inactive: ["prospect", "registered", "active"],
  blocked: ["inactive", "registered", "active"],
};

export function canTransitionStudentStatus(
  current: AcademyStudentStatus,
  target: AcademyStudentStatus
): boolean {
  if (current === target) return true;
  const allowed = ALLOWED_STUDENT_STATUS_TRANSITIONS[current] ?? [];
  return allowed.includes(target);
}

/**
 * Registers a new Academy student with concurrency-safe student number allocation.
 */
export async function registerStudent(
  companyId: string,
  userId: string,
  data: CreateStudentData
): Promise<Student> {
  if (data.employeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: data.employeeId, companyId },
    });
    if (!emp) {
      throw new AcademyValidationError("employeeId not found in company");
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const studentNumber = data.studentNumber?.trim() || (await generateNextStudentNumber(companyId, tx));

      const student = await tx.student.create({
        data: {
          companyId,
          studentNumber,
          firstName: data.firstName,
          middleName: data.middleName ?? undefined,
          lastName: data.lastName,
          preferredName: data.preferredName ?? undefined,
          idType: data.idType ?? undefined,
          idNumber: data.idNumber ?? undefined,
          dateOfBirth: data.dateOfBirth ?? undefined,
          gender: data.gender ?? undefined,
          nationality: data.nationality ?? undefined,
          phone: data.phone ?? undefined,
          alternatePhone: data.alternatePhone ?? undefined,
          email: data.email ?? undefined,
          addressLine1: data.addressLine1 ?? undefined,
          addressLine2: data.addressLine2 ?? undefined,
          city: data.city ?? undefined,
          province: data.province ?? undefined,
          postalCode: data.postalCode ?? undefined,
          nextOfKinName: data.nextOfKinName ?? undefined,
          nextOfKinPhone: data.nextOfKinPhone ?? undefined,
          psiraProfileReference: data.psiraProfileReference ?? undefined,
          psiraPreRegistrationStatus: data.psiraPreRegistrationStatus,
          status: data.status,
          employeeId: data.employeeId ?? undefined,
        },
      });

      await createAuditLog(
        {
          userId,
          companyId,
          action: "academy.student.create",
          entityType: "Student",
          entityId: student.id,
          metadata: { studentNumber: student.studentNumber },
        },
        tx
      );

      return student;
    });
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
    if (code === "P2002") {
      throw new AcademyConflictError("Student number already exists");
    }
    throw e;
  }
}

/**
 * Retrieves a single student with relations scoped to tenant.
 */
export async function getStudentById(
  companyId: string,
  studentId: string
): Promise<StudentWithDetails> {
  const student = await prisma.student.findFirst({
    where: { id: studentId, companyId },
    include: {
      employee: {
        select: { id: true, employeeNumber: true, firstName: true, lastName: true },
      },
      _count: { select: { documents: true, enrolments: true } },
    },
  });

  if (!student) {
    throw new AcademyNotFoundError("Student not found");
  }

  return student;
}

/**
 * Lists students with tenant scoping, search, and pagination.
 */
export async function listStudents(
  options: ListStudentsOptions
): Promise<{ students: StudentWithDetails[]; total: number; limit: number; offset: number }> {
  const { companyId, search, status, canAccessSensitive } = options;
  const limit = Math.min(Number(options.limit) || 50, 200);
  const offset = Number(options.offset) || 0;
  const trimmed = (search ?? "").trim();

  const where: Prisma.StudentWhereInput = {
    companyId,
    ...(status ? { status } : {}),
    ...(trimmed.length >= 2
      ? {
          OR: [
            { firstName: { contains: trimmed, mode: "insensitive" as const } },
            { lastName: { contains: trimmed, mode: "insensitive" as const } },
            { studentNumber: { contains: trimmed, mode: "insensitive" as const } },
            ...(canAccessSensitive
              ? [
                  { idNumber: { contains: trimmed, mode: "insensitive" as const } },
                  { email: { contains: trimmed, mode: "insensitive" as const } },
                ]
              : []),
          ],
        }
      : {}),
  };

  const [students, total] = await Promise.all([
    prisma.student.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
      include: {
        employee: {
          select: { id: true, employeeNumber: true, firstName: true, lastName: true },
        },
        _count: { select: { documents: true, enrolments: true } },
      },
    }),
    prisma.student.count({ where }),
  ]);

  return { students, total, limit, offset };
}

/**
 * Updates student fields and validates state machine transitions.
 */
export async function updateStudent(
  companyId: string,
  studentId: string,
  userId: string,
  data: UpdateStudentData
): Promise<StudentWithDetails> {
  const existing = await prisma.student.findFirst({ where: { id: studentId, companyId } });
  if (!existing) {
    throw new AcademyNotFoundError("Student not found");
  }

  if (data.employeeId) {
    const emp = await prisma.employee.findFirst({
      where: { id: data.employeeId, companyId },
    });
    if (!emp) {
      throw new AcademyValidationError("employeeId not found in company");
    }
  }

  if (data.status && !canTransitionStudentStatus(existing.status, data.status)) {
    throw new AcademyValidationError(
      `Cannot transition student status from '${existing.status}' to '${data.status}'`
    );
  }

  try {
    const student = await prisma.student.update({
      where: { id: studentId },
      data: {
        ...("studentNumber" in data && data.studentNumber != null ? { studentNumber: data.studentNumber } : {}),
        ...("firstName" in data && data.firstName != null ? { firstName: data.firstName } : {}),
        ...("middleName" in data ? { middleName: data.middleName } : {}),
        ...("lastName" in data && data.lastName != null ? { lastName: data.lastName } : {}),
        ...("preferredName" in data ? { preferredName: data.preferredName } : {}),
        ...("idType" in data ? { idType: data.idType } : {}),
        ...("idNumber" in data ? { idNumber: data.idNumber } : {}),
        ...("dateOfBirth" in data ? { dateOfBirth: data.dateOfBirth } : {}),
        ...("gender" in data ? { gender: data.gender } : {}),
        ...("nationality" in data ? { nationality: data.nationality } : {}),
        ...("phone" in data ? { phone: data.phone } : {}),
        ...("alternatePhone" in data ? { alternatePhone: data.alternatePhone } : {}),
        ...("email" in data ? { email: data.email } : {}),
        ...("addressLine1" in data ? { addressLine1: data.addressLine1 } : {}),
        ...("addressLine2" in data ? { addressLine2: data.addressLine2 } : {}),
        ...("city" in data ? { city: data.city } : {}),
        ...("province" in data ? { province: data.province } : {}),
        ...("postalCode" in data ? { postalCode: data.postalCode } : {}),
        ...("nextOfKinName" in data ? { nextOfKinName: data.nextOfKinName } : {}),
        ...("nextOfKinPhone" in data ? { nextOfKinPhone: data.nextOfKinPhone } : {}),
        ...("psiraProfileReference" in data ? { psiraProfileReference: data.psiraProfileReference } : {}),
        ...("psiraPreRegistrationStatus" in data && data.psiraPreRegistrationStatus != null
          ? { psiraPreRegistrationStatus: data.psiraPreRegistrationStatus }
          : {}),
        ...("status" in data && data.status != null ? { status: data.status } : {}),
        ...("employeeId" in data ? { employeeId: data.employeeId } : {}),
      },
      include: {
        employee: {
          select: { id: true, employeeNumber: true, firstName: true, lastName: true },
        },
        _count: { select: { documents: true, enrolments: true } },
      },
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.student.update",
      entityType: "Student",
      entityId: student.id,
      metadata: data as Record<string, unknown>,
    });

    return student;
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
    if (code === "P2002") {
      throw new AcademyConflictError("Student number already exists");
    }
    throw e;
  }
}

/**
 * Records admin fee payment, waiver, or reset for a student.
 */
export async function recordAdminFee(
  companyId: string,
  studentId: string,
  userId: string,
  data: RecordAdminFeeData
): Promise<StudentWithDetails> {
  const existing = await prisma.student.findFirst({ where: { id: studentId, companyId } });
  if (!existing) {
    throw new AcademyNotFoundError("Student not found");
  }

  let updatePayload: Prisma.StudentUpdateInput;

  if (data.status === "paid") {
    const dec = data.amount != null ? new Prisma.Decimal(String(data.amount)) : new Prisma.Decimal(0);
    if (dec.lte(0)) {
      throw new AcademyValidationError("amount must be greater than zero when status is paid");
    }
    updatePayload = {
      adminFeeStatus: "paid",
      adminFeePaidAt: new Date(),
      adminFeeAmount: dec,
      adminFeeMethod: data.method?.trim() || null,
      adminFeeReference: data.reference?.trim() || null,
      adminFeeNotes: data.notes?.trim() || null,
      adminFeeRecordedByUserId: userId,
    };
  } else if (data.status === "waived") {
    const notes = data.notes?.trim();
    if (!notes) {
      throw new AcademyValidationError("notes are required when status is waived");
    }
    updatePayload = {
      adminFeeStatus: "waived",
      adminFeePaidAt: null,
      adminFeeAmount: null,
      adminFeeMethod: null,
      adminFeeReference: null,
      adminFeeNotes: notes,
      adminFeeRecordedByUserId: userId,
    };
  } else {
    updatePayload = {
      adminFeeStatus: "unpaid",
      adminFeePaidAt: null,
      adminFeeAmount: null,
      adminFeeMethod: null,
      adminFeeReference: null,
      adminFeeNotes: null,
      adminFeeRecordedByUserId: userId,
    };
  }

  const student = await prisma.student.update({
    where: { id: studentId },
    data: updatePayload,
    include: {
      employee: {
        select: { id: true, employeeNumber: true, firstName: true, lastName: true },
      },
      _count: { select: { documents: true, enrolments: true } },
    },
  });

  await createAuditLog({
    userId,
    companyId,
    action: "academy.student.admin_fee",
    entityType: "Student",
    entityId: student.id,
    metadata: { status: data.status, studentNumber: student.studentNumber },
  });

  return student;
}

/**
 * Checks document compliance eligibility for learner enrolment.
 */
export async function checkDocumentEligibility(
  companyId: string,
  studentId: string
): Promise<DocumentEligibilityResult> {
  const existing = await prisma.student.findFirst({ where: { id: studentId, companyId } });
  if (!existing) {
    throw new AcademyNotFoundError("Student not found");
  }

  const docs = await prisma.studentDocument.findMany({
    where: { companyId, studentId, deletedAt: null },
    select: { id: true, documentType: true, fileName: true, createdAt: true },
  });

  const missingRequirements: string[] = [];
  if (docs.length === 0) {
    missingRequirements.push("Learner has no verified documents uploaded");
  }

  return {
    eligible: docs.length > 0,
    documentCount: docs.length,
    documents: docs,
    missingRequirements,
  };
}

/**
 * Deactivates a student if enrolments exist, or hard-deletes if none exist.
 */
export async function deactivateOrDeleteStudent(
  companyId: string,
  studentId: string,
  userId: string
): Promise<{ deactivated: boolean; student?: StudentWithDetails }> {
  const existing = await prisma.student.findFirst({
    where: { id: studentId, companyId },
    include: { _count: { select: { enrolments: true } } },
  });

  if (!existing) {
    throw new AcademyNotFoundError("Student not found");
  }

  if (existing._count.enrolments > 0) {
    const student = await prisma.student.update({
      where: { id: studentId },
      data: { status: "inactive" },
      include: {
        employee: {
          select: { id: true, employeeNumber: true, firstName: true, lastName: true },
        },
        _count: { select: { documents: true, enrolments: true } },
      },
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.student.deactivate",
      entityType: "Student",
      entityId: studentId,
    });

    return { deactivated: true, student };
  }

  await prisma.student.delete({ where: { id: studentId } });

  await createAuditLog({
    userId,
    companyId,
    action: "academy.student.delete",
    entityType: "Student",
    entityId: studentId,
  });

  return { deactivated: false };
}

export interface LearnerEnrolmentEligibility {
  eligible: boolean;
  student: {
    id: string;
    studentNumber: string;
    status: AcademyStudentStatus;
    adminFeeStatus: AcademyAdminFeeStatus;
    psiraPreRegistrationStatus: AcademyPsiraPreRegistrationStatus;
  };
  courseRun: {
    id: string;
    runCode: string;
    status: string;
    capacity: number;
    enrolledCount: number;
    requiresDocuments: boolean;
    psiraCategory?: string | null;
  };
  checks: {
    studentStatusActive: boolean;
    academyProfileCompliant: boolean;
    adminFeePaidOrWaived: boolean;
    documentsCompliant: boolean;
    psiraPreRegistrationCompliant: boolean;
    courseRunAcceptingEnrolments: boolean;
    capacityAvailable: boolean;
  };
  blockers: string[];
}

/**
 * Checks overall learner enrolment eligibility against all pre-enrolment gates:
 * academy profile compliance, student status, admin fee status, document requirements,
 * PSIRA pre-registration, course run acceptance, and capacity.
 */
export async function checkLearnerEnrolmentEligibility(
  companyId: string,
  studentId: string,
  courseRunId: string
): Promise<LearnerEnrolmentEligibility> {
  const blockers: string[] = [];

  const [student, courseRun, academyGate] = await Promise.all([
    prisma.student.findFirst({
      where: { id: studentId, companyId },
      select: {
        id: true,
        studentNumber: true,
        status: true,
        adminFeeStatus: true,
        psiraPreRegistrationStatus: true,
      },
    }),
    prisma.courseRun.findFirst({
      where: { id: courseRunId, companyId },
      include: { course: true, branch: true },
    }),
    getAcademyComplianceGate(companyId),
  ]);

  if (!student) {
    throw new AcademyNotFoundError("Student not found");
  }
  if (!courseRun) {
    throw new AcademyNotFoundError("Course run not found");
  }

  // 1. Academy compliance gate
  if (!academyGate.ok) {
    blockers.push(...academyGate.blockers);
  }

  // 2. Student status
  const studentStatusActive = student.status !== "blocked" && student.status !== "inactive";
  if (!studentStatusActive) {
    blockers.push(`Student status is '${student.status}'`);
  }

  // 3. Admin fee status
  const adminFeePaidOrWaived = student.adminFeeStatus === "paid" || student.adminFeeStatus === "waived";
  if (!adminFeePaidOrWaived) {
    blockers.push("Admin fee must be paid or waived before enrolling this student");
  }

  // 4. Document requirements (conditional on course.requiresDocuments)
  const requiresDocs = courseRun.course.requiresDocuments;
  const docGate = await ensureLearnerDocumentGate(companyId, student.id, requiresDocs);
  const documentsCompliant = docGate.ok;
  if (!documentsCompliant) {
    blockers.push(docGate.reason ?? "Mandatory learner compliance documents missing");
  }

  // 5. PSIRA Pre-Registration status
  let psiraPreRegistrationCompliant = true;
  if (courseRun.course.psiraCategory && student.psiraPreRegistrationStatus !== "completed") {
    psiraPreRegistrationCompliant = false;
    blockers.push("Learner must complete PSIRA pre-registration before enrolling in this course run");
  }

  // 6. Course run accepting enrolments
  const courseRunAcceptingEnrolments = ["planned", "open", "in_progress"].includes(courseRun.status);
  if (!courseRunAcceptingEnrolments) {
    blockers.push(`Course run does not accept new enrolments (status: ${courseRun.status})`);
  }

  // 7. Capacity check
  const capacityAvailable = courseRun.capacity === 0 || courseRun.enrolledCount < courseRun.capacity;
  if (!capacityAvailable) {
    blockers.push("Course run is at capacity");
  }

  return {
    eligible: blockers.length === 0,
    student,
    courseRun: {
      id: courseRun.id,
      runCode: courseRun.runCode,
      status: courseRun.status,
      capacity: courseRun.capacity,
      enrolledCount: courseRun.enrolledCount,
      requiresDocuments: courseRun.course.requiresDocuments,
      psiraCategory: courseRun.course.psiraCategory,
    },
    checks: {
      studentStatusActive,
      academyProfileCompliant: academyGate.ok,
      adminFeePaidOrWaived,
      documentsCompliant,
      psiraPreRegistrationCompliant,
      courseRunAcceptingEnrolments,
      capacityAvailable,
    },
    blockers,
  };
}
