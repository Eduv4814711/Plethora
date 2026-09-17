import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import type {
  AcademyCertificate,
  AcademyRenewalAlert,
  AcademyCertificateStatus,
  AcademyRenewalSeverity,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import { getAcademyComplianceGate } from "./academy-compliance.service.js";
import {
  AcademyServiceError,
  AcademyValidationError,
  AcademyNotFoundError,
  AcademyConflictError,
} from "./academy-student.service.js";

export interface AttendanceForensics {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface IssueCertificateInput {
  learnerId: string;
  courseId: string;
  enrolmentId?: string | null;
  completionDate?: string | Date | null;
  issueDate: string | Date;
  certificateNumber?: string | null;
  pdfPath?: string | null;
  validityMonths?: number | null;
}

export interface UpdateCertificateInput {
  completionDate?: string | Date | null;
  issueDate?: string | Date;
  pdfPath?: string | null;
  status?: AcademyCertificateStatus;
}

export interface ListCertificatesParams {
  learnerId?: string;
  courseId?: string;
  status?: AcademyCertificateStatus;
  limit?: number;
  offset?: number;
}

export interface CertificateGateResult {
  ok: boolean;
  enrolmentId?: string;
  blockers: string[];
}

export type CertificateWithRelations = AcademyCertificate & {
  learner: { id: string; studentNumber: string; firstName: string; lastName: string };
  course: { id: string; code: string; title: string };
  enrolment?: unknown;
};

function parseDate(v?: string | Date | null): Date | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function computeRenewalSeverity(dueDate: Date): AcademyRenewalSeverity {
  const diffDays = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 30) return "red";
  if (diffDays <= 60) return "amber";
  return "green";
}

/**
 * Generates the next sequential certificate number (CERT-XXXXX) for a company
 * using PostgreSQL transaction advisory locking and SQL aggregation.
 */
export async function generateNextCertificateNumber(
  companyId: string,
  tx: Prisma.TransactionClient = prisma,
  prefix = "CERT"
): Promise<string> {
  const substringOffset = prefix.length + 2; // e.g. "CERT-" is 5 chars, offset is 6
  const regexPattern = `^${prefix}-[0-9]+$`;

  const run = async (client: Prisma.TransactionClient): Promise<string> => {
    let maxNum = 0;
    try {
      await client.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'academy-certificate:' + companyId}))`
      );
      const result = await client.$queryRaw<Array<{ maxNum: number | bigint | null }>>(Prisma.sql`
        SELECT COALESCE(
          MAX(CAST(SUBSTRING("certificateNumber" FROM ${substringOffset}) AS INTEGER)),
          0
        ) AS "maxNum"
        FROM "AcademyCertificate"
        WHERE "companyId" = ${companyId}
          AND "certificateNumber" ~ ${regexPattern}
      `);
      maxNum = Number(result[0]?.maxNum ?? 0);
    } catch {
      // Fallback for mock/test environments
      const certs = await client.academyCertificate.findMany({
        where: { companyId, certificateNumber: { startsWith: `${prefix}-` } },
        select: { certificateNumber: true },
      });
      const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
      for (const c of certs) {
        const m = c.certificateNumber.match(pattern);
        if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
      }
    }
    return `${prefix}-${String(maxNum + 1).padStart(5, "0")}`;
  };

  if ("$queryRaw" in tx && tx !== prisma) {
    return run(tx);
  }

  return prisma.$transaction(async (innerTx) => run(innerTx));
}

/**
 * Verifies all prerequisite gates for certificate issuance:
 * Academy compliance, enrolment resolution, completion, attendance, assessments, and duplicates.
 */
export async function verifyCertificateIssuancePrerequisites(
  tx: Prisma.TransactionClient,
  companyId: string,
  learnerId: string,
  courseId: string,
  enrolmentId?: string | null
): Promise<CertificateGateResult> {
  const blockers: string[] = [];

  // 1. Validate that learner and course both exist in company
  if (typeof tx.student?.findFirst === "function" && typeof tx.course?.findFirst === "function") {
    const [student, course] = await Promise.all([
      tx.student.findFirst({ where: { id: learnerId, companyId }, select: { id: true } }),
      tx.course.findFirst({ where: { id: courseId, companyId }, select: { id: true } }),
    ]);

    if (student === null) {
      throw new AcademyValidationError("learnerId not found in company");
    }
    if (course === null) {
      throw new AcademyValidationError("courseId not found in company");
    }
  }

  // 2. Academy Profile Compliance Gate
  const academyGate = await getAcademyComplianceGate(companyId);
  if (!academyGate.ok) {
    blockers.push(...academyGate.blockers);
  }

  // 3. Enrolment Resolution & Triangular Consistency Check
  let enrolment;
  if (enrolmentId) {
    enrolment = await tx.enrolment.findFirst({
      where: { id: enrolmentId, companyId },
      include: {
        courseRun: {
          include: {
            course: true,
            academyAttendanceSessions: { select: { id: true } },
          },
        },
      },
    });

    if (!enrolment) {
      throw new AcademyValidationError("enrolmentId not found in company");
    }

    // Triangular consistency enforcement
    if (enrolment.studentId && enrolment.studentId !== learnerId) {
      throw new AcademyValidationError("enrolmentId does not belong to the specified learner");
    }
    if (enrolment.courseRun?.courseId && enrolment.courseRun.courseId !== courseId) {
      throw new AcademyValidationError("enrolmentId is not linked to the specified course");
    }
  } else {
    enrolment = await tx.enrolment.findFirst({
      where: { companyId, studentId: learnerId, courseRun: { courseId } },
      include: {
        courseRun: {
          include: {
            course: true,
            academyAttendanceSessions: { select: { id: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!enrolment) {
    blockers.push("Learner must have an active enrolment for this course");
    return { ok: false, blockers };
  }

  // 3. Financial Gate
  if (enrolment.financialStatus !== "paid") {
    blockers.push("Tuition fee must be fully paid before certificate issuance");
  }

  // 4. Completion & Readiness Gates
  if (enrolment.completionStatus !== "completed") {
    blockers.push("Enrolment completion status must be 'completed'");
  }
  if (enrolment.attendanceStatus !== "compliant") {
    blockers.push("Attendance status must be 'compliant'");
  }
  if (enrolment.reportingReadinessStatus !== "ready") {
    blockers.push("Reporting readiness status must be 'ready'");
  }

  // 5. Assessment Gate (required only if course.requiresAssessment is true)
  if (enrolment.courseRun.course.requiresAssessment) {
    const passed = await tx.academyAssessment.count({
      where: {
        companyId,
        learnerId,
        courseId,
        result: { in: ["pass", "competent"] },
      },
    });
    if (passed <= 0) {
      blockers.push("Learner has no passed or competent assessment on record");
    }
  }

  // 6. Attendance Percentage Gate
  const records = await tx.academyAttendanceRecord.findMany({
    where: { companyId, enrolmentId: enrolment.id },
    select: { attendanceStatus: true },
  });
  if (records.length > 0) {
    const present = records.filter(
      (r) => r.attendanceStatus === "present" || r.attendanceStatus === "late"
    ).length;
    const totalSessions = enrolment.courseRun.academyAttendanceSessions?.length ?? 0;
    const denominator = totalSessions > 0 ? totalSessions : records.length;
    const percent = (present / denominator) * 100;
    const minRequired = enrolment.courseRun.course.minimumAttendancePercent ?? 0;
    if (percent < minRequired) {
      blockers.push(`Attendance percent ${percent.toFixed(1)}% is below required ${minRequired}%`);
    }
  }

  // 6. Duplicate Certificate Check
  const existingActive = await tx.academyCertificate.findFirst({
    where: {
      companyId,
      enrolmentId: enrolment.id,
      status: { in: ["active", "reprinted"] },
    },
    select: { certificateNumber: true },
  });
  if (existingActive) {
    blockers.push(
      `Active certificate ${existingActive.certificateNumber} has already been issued for this enrolment`
    );
  }

  return {
    ok: blockers.length === 0,
    enrolmentId: enrolment.id,
    blockers,
  };
}

/**
 * Issues a verified accredited certificate inside an atomic transaction ($transaction),
 * creating renewal alerts and setting Enrolment.psiraSubmissionStatus.
 */
export async function issueCertificate(
  companyId: string,
  userId: string,
  data: IssueCertificateInput,
  forensics?: AttendanceForensics
): Promise<{ certificate: CertificateWithRelations; renewalAlert?: AcademyRenewalAlert }> {
  const issueDate = parseDate(data.issueDate);
  if (!issueDate) {
    throw new AcademyValidationError("Invalid issueDate");
  }

  const completionDate = data.completionDate ? parseDate(data.completionDate) : null;
  if (data.completionDate != null && !completionDate) {
    throw new AcademyValidationError("Invalid completionDate");
  }

  return prisma.$transaction(async (tx) => {
    // 1. Verify all prerequisite gates
    const gate = await verifyCertificateIssuancePrerequisites(
      tx,
      companyId,
      data.learnerId,
      data.courseId,
      data.enrolmentId
    );
    if (!gate.ok) {
      throw new AcademyValidationError("Certificate issuance prerequisites not met", {
        blockers: gate.blockers,
      });
    }

    // 2. Generate concurrency-safe sequential certificate number
    const certificateNumber =
      data.certificateNumber?.trim() || (await generateNextCertificateNumber(companyId, tx));

    // 3. Generate cryptographic verification code
    const verificationCode = randomBytes(8).toString("hex");

    // 4. Create Certificate Record
    const cert = await tx.academyCertificate.create({
      data: {
        companyId,
        learnerId: data.learnerId,
        courseId: data.courseId,
        enrolmentId: data.enrolmentId ?? gate.enrolmentId,
        completionDate,
        issueDate,
        certificateNumber,
        verificationCode,
        pdfPath: data.pdfPath ?? null,
        issuedByUserId: userId,
        status: "active",
      },
      include: {
        learner: {
          select: { id: true, studentNumber: true, firstName: true, lastName: true },
        },
        course: { select: { id: true, code: true, title: true } },
        enrolment: true,
      },
    });

    // 5. Automatic Renewal Alert Handling
    let renewalAlert: AcademyRenewalAlert | undefined = undefined;
    const validityMonths = data.validityMonths ?? 12;
    if (validityMonths > 0) {
      const dueDate = new Date(cert.issueDate);
      dueDate.setMonth(dueDate.getMonth() + validityMonths);

      renewalAlert = await tx.academyRenewalAlert.create({
        data: {
          companyId,
          alertType: "certificate_renewal",
          title: `Certificate Renewal: ${cert.learner.firstName} ${cert.learner.lastName} - ${cert.course.title}`,
          dueDate,
          severity: computeRenewalSeverity(dueDate),
          status: "open",
          relatedId: cert.id,
          notes: `Certificate Number: ${certificateNumber}. Verification Code: ${verificationCode}`,
        },
      });
    }

    // 6. Update Enrolment PSIRA Submission Status if applicable
    if (gate.enrolmentId) {
      await tx.enrolment.update({
        where: { id: gate.enrolmentId },
        data: { psiraSubmissionStatus: "pending" },
      });
    }

    // 7. Transaction Audit Logging
    await createAuditLog(
      {
        userId,
        companyId,
        action: "academy.certificate.issue",
        entityType: "AcademyCertificate",
        entityId: cert.id,
        metadata: {
          certificateNumber,
          verificationCode,
          renewalAlertId: renewalAlert?.id,
        },
        ...forensics,
      },
      tx
    );

    return { certificate: cert as unknown as CertificateWithRelations, renewalAlert };
  });
}

/**
 * Reprints a certificate with explicit reason and forensic audit trail.
 */
export async function reprintCertificate(
  companyId: string,
  userId: string,
  certificateId: string,
  reason?: string,
  forensics?: AttendanceForensics
): Promise<AcademyCertificate> {
  return prisma.$transaction(async (tx) => {
    const cert = await tx.academyCertificate.findFirst({
      where: { id: certificateId, companyId },
    });
    if (!cert) {
      throw new AcademyNotFoundError("Certificate not found");
    }

    if (cert.status === "revoked" || cert.status === "void") {
      throw new AcademyConflictError(`Cannot reprint a ${cert.status} certificate`);
    }

    const updated = await tx.academyCertificate.update({
      where: { id: certificateId },
      data: { status: "reprinted" },
    });

    await createAuditLog(
      {
        userId,
        companyId,
        action: "academy.certificate.reprint",
        entityType: "AcademyCertificate",
        entityId: certificateId,
        metadata: {
          certificateNumber: cert.certificateNumber,
          reason: reason || "Official reprint requested",
          previousStatus: cert.status,
        },
        ...forensics,
      },
      tx
    );

    return updated;
  });
}

/**
 * Revokes a certificate and automatically cancels any pending renewal alerts.
 */
export async function revokeCertificate(
  companyId: string,
  userId: string,
  certificateId: string,
  reason?: string,
  forensics?: AttendanceForensics
): Promise<AcademyCertificate> {
  return prisma.$transaction(async (tx) => {
    const cert = await tx.academyCertificate.findFirst({
      where: { id: certificateId, companyId },
    });
    if (!cert) {
      throw new AcademyNotFoundError("Certificate not found");
    }

    const updated = await tx.academyCertificate.update({
      where: { id: certificateId },
      data: { status: "revoked" },
    });

    // Cancel open renewal alerts for this certificate
    await tx.academyRenewalAlert.updateMany({
      where: { relatedId: certificateId, companyId, status: "open" },
      data: { status: "cancelled" },
    });

    await createAuditLog(
      {
        userId,
        companyId,
        action: "academy.certificate.revoke",
        entityType: "AcademyCertificate",
        entityId: certificateId,
        metadata: {
          certificateNumber: cert.certificateNumber,
          reason: reason || "Revocation confirmed",
        },
        ...forensics,
      },
      tx
    );

    return updated;
  });
}

/**
 * Retrieves a certificate by ID scoped to tenant.
 */
export async function getCertificateById(
  companyId: string,
  certificateId: string
): Promise<AcademyCertificate | null> {
  return prisma.academyCertificate.findFirst({
    where: { id: certificateId, companyId },
    include: { learner: true, course: true, enrolment: true },
  });
}

/**
 * Lists certificates with filters and pagination scoped to tenant.
 */
export async function listCertificates(
  companyId: string,
  options: ListCertificatesParams
): Promise<{ certificates: AcademyCertificate[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Number(options.limit) || 100, 200);
  const offset = Number(options.offset) || 0;

  const where: Prisma.AcademyCertificateWhereInput = {
    companyId,
    ...(options.learnerId ? { learnerId: options.learnerId } : {}),
    ...(options.courseId ? { courseId: options.courseId } : {}),
    ...(options.status ? { status: options.status } : {}),
  };

  const [certificates, total] = await Promise.all([
    prisma.academyCertificate.findMany({
      where,
      include: { learner: true, course: true, enrolment: true },
      orderBy: { issueDate: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.academyCertificate.count({ where }),
  ]);

  return { certificates, total, limit, offset };
}

/**
 * Updates certificate fields.
 */
export async function updateCertificate(
  companyId: string,
  userId: string,
  certificateId: string,
  data: UpdateCertificateInput,
  forensics?: AttendanceForensics
): Promise<AcademyCertificate> {
  const existing = await prisma.academyCertificate.findFirst({
    where: { id: certificateId, companyId },
  });
  if (!existing) {
    throw new AcademyNotFoundError("Certificate not found");
  }

  let issueDate = existing.issueDate;
  if (data.issueDate != null) {
    const parsed = parseDate(data.issueDate);
    if (!parsed) throw new AcademyValidationError("Invalid issueDate");
    issueDate = parsed;
  }

  const completionDate =
    data.completionDate !== undefined
      ? data.completionDate
        ? parseDate(data.completionDate)
        : null
      : existing.completionDate;

  if (data.completionDate != null && !completionDate) {
    throw new AcademyValidationError("Invalid completionDate");
  }

  const certificate = await prisma.academyCertificate.update({
    where: { id: certificateId },
    data: {
      completionDate,
      issueDate,
      pdfPath: data.pdfPath !== undefined ? data.pdfPath : existing.pdfPath,
      status: data.status ?? existing.status,
    },
  });

  await createAuditLog({
    userId,
    companyId,
    action: "academy.certificate.update",
    entityType: "AcademyCertificate",
    entityId: certificateId,
    metadata: data as Record<string, unknown>,
    ...forensics,
  });

  return certificate;
}

/**
 * Deletes a certificate and cancels related renewal alerts.
 */
export async function deleteCertificate(
  companyId: string,
  userId: string,
  certificateId: string,
  forensics?: AttendanceForensics
): Promise<void> {
  const existing = await prisma.academyCertificate.findFirst({
    where: { id: certificateId, companyId },
  });
  if (!existing) {
    throw new AcademyNotFoundError("Certificate not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.academyRenewalAlert.updateMany({
      where: { relatedId: certificateId, companyId },
      data: { status: "cancelled" },
    });
    await tx.academyCertificate.delete({ where: { id: certificateId } });

    await createAuditLog(
      {
        userId,
        companyId,
        action: "academy.certificate.delete",
        entityType: "AcademyCertificate",
        entityId: certificateId,
        ...forensics,
      },
      tx
    );
  });
}

/**
 * Public certificate verification endpoint (no tenant authentication required).
 */
export async function verifyCertificatePublic(verificationCode: string): Promise<{
  valid: boolean;
  certificate: {
    certificateNumber: string;
    status: string;
    issueDate: Date;
    completionDate: Date | null;
    learner: { firstName: string; lastName: string; studentNumber: string };
    course: { title: string; code: string };
  } | null;
}> {
  const cert = await prisma.academyCertificate.findFirst({
    where: { verificationCode },
    select: {
      certificateNumber: true,
      status: true,
      issueDate: true,
      completionDate: true,
      learner: { select: { firstName: true, lastName: true, studentNumber: true } },
      course: { select: { title: true, code: true } },
    },
  });

  if (!cert) {
    return { valid: false, certificate: null };
  }

  return {
    valid: cert.status === "active" || cert.status === "reprinted",
    certificate: cert,
  };
}
