import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  AcademyEnrolmentFinancialStatus,
  AcademyEnrolmentAttendanceStatus,
  AcademyEnrolmentCompletionStatus,
  AcademyReportingReadinessStatus,
  AcademyPsiraSubmissionStatus,
  AcademyCourseRunStatus,
  AcademyAdminFeeStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { ensureLearnerDocumentGate, getAcademyComplianceGate } from "../../services/academy-compliance.service.js";
import { academyProtect } from "./constants.js";

const ENROLMENT_ALLOWED_RUN_STATUSES: AcademyCourseRunStatus[] = ["planned", "open", "in_progress"];

function studentMayEnrol(adminFeeStatus: AcademyAdminFeeStatus): boolean {
  return adminFeeStatus === "paid" || adminFeeStatus === "waived";
}

function runAcceptsNewEnrolments(status: AcademyCourseRunStatus): boolean {
  return ENROLMENT_ALLOWED_RUN_STATUSES.includes(status);
}

function parseEnrolmentDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

const financialSchema = z.enum(["unpaid", "partial", "paid"]) satisfies z.ZodType<AcademyEnrolmentFinancialStatus>;
const attendanceSchema = z.enum(["pending", "in_progress", "compliant", "non_compliant"]) satisfies z.ZodType<
  AcademyEnrolmentAttendanceStatus
>;
const completionSchema = z.enum(["pending", "in_progress", "completed", "failed"]) satisfies z.ZodType<
  AcademyEnrolmentCompletionStatus
>;
const readinessSchema = z.enum(["not_started", "incomplete", "ready", "blocked"]) satisfies z.ZodType<
  AcademyReportingReadinessStatus
>;
const psiraSubmissionSchema = z.enum([
  "not_applicable",
  "not_started",
  "pending",
  "submitted",
  "approved",
  "rejected",
]) satisfies z.ZodType<AcademyPsiraSubmissionStatus>;

const createEnrolmentSchema = z.object({
  studentId: z.string().min(1),
  courseRunId: z.string().min(1),
  enrolmentDate: z.string().optional(),
  feePlanId: z.string().optional().nullable(),
  financialStatus: financialSchema.optional(),
  attendanceStatus: attendanceSchema.optional(),
  completionStatus: completionSchema.optional(),
  reportingReadinessStatus: readinessSchema.optional(),
  psiraSubmissionStatus: psiraSubmissionSchema.optional(),
  remarks: z.string().optional().nullable(),
});

const updateEnrolmentSchema = createEnrolmentSchema.partial().omit({ studentId: true, courseRunId: true });

const batchEnrolmentSchema = z.object({
  studentId: z.string().min(1),
  courseRunIds: z.array(z.string().min(1)).min(1).max(25),
});

export async function academyEnrolmentsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const courseRunId = q.courseRunId;
    const studentId = q.studentId;
    const limit = Math.min(Number(q.limit) || 100, 200);
    const offset = Number(q.offset) || 0;

    const where = {
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

    return { enrolments, total, limit, offset };
  });

  app.post("/batch", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const academyGate = await getAcademyComplianceGate(companyId);
    if (!academyGate.ok) {
      return reply.code(400).send({
        error: "Validation error",
        message: "Academy profile is not compliant for enrolments",
        blockers: academyGate.blockers,
      });
    }
    const body = batchEnrolmentSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const studentId = body.data.studentId;
    const courseRunIds = [...new Set(body.data.courseRunIds)];

    const student = await prisma.student.findFirst({
      where: { id: studentId, companyId },
      select: { id: true, adminFeeStatus: true, studentNumber: true, psiraPreRegistrationStatus: true },
    });
    if (!student) {
      return reply.code(400).send({ error: "Validation error", message: "studentId not found" });
    }
    if (!studentMayEnrol(student.adminFeeStatus)) {
      return reply.code(400).send({
        error: "Validation error",
        message: "Admin fee must be paid or waived before enrolling this student",
      });
    }
    const docGate = await ensureLearnerDocumentGate(companyId, student.id);
    if (!docGate.ok) {
      return reply.code(400).send({ error: "Validation error", message: docGate.reason });
    }

    const runs = await prisma.courseRun.findMany({
      where: { companyId, id: { in: courseRunIds } },
      select: { id: true, status: true, capacity: true, enrolledCount: true, course: { select: { psiraCategory: true } } },
    });
    if (runs.length !== courseRunIds.length) {
      const found = new Set(runs.map((r) => r.id));
      const missing = courseRunIds.filter((id) => !found.has(id));
      return reply.code(400).send({
        error: "Validation error",
        message: `courseRunId not found: ${missing.join(", ")}`,
      });
    }

    for (const r of runs) {
      if (r.course.psiraCategory && student.psiraPreRegistrationStatus !== "completed") {
        return reply.code(400).send({
          error: "Validation error",
          message: `Learner must complete PSIRA pre-registration before enrolling in PSIRA-linked course run ${r.id}`,
        });
      }
      if (!runAcceptsNewEnrolments(r.status)) {
        return reply.code(400).send({
          error: "Validation error",
          message: `Course run ${r.id} does not accept new enrolments (status: ${r.status})`,
        });
      }
      if (r.capacity > 0 && r.enrolledCount >= r.capacity) {
        return reply.code(409).send({
          error: "Conflict",
          message: `Course run ${r.id} is at capacity`,
        });
      }
    }

    const existing = await prisma.enrolment.findMany({
      where: { studentId, courseRunId: { in: courseRunIds } },
      select: { courseRunId: true },
    });
    if (existing.length > 0) {
      return reply.code(409).send({
        error: "Conflict",
        message: `Student is already enrolled in course run(s): ${existing.map((e) => e.courseRunId).join(", ")}`,
      });
    }

    const enrolmentDate = new Date();

    try {
      const created = await prisma.$transaction(async (tx) => {
        const results: Awaited<ReturnType<typeof tx.enrolment.create>>[] = [];
        for (const runId of courseRunIds) {
          const r = await tx.courseRun.findFirst({
            where: { id: runId, companyId },
            select: { id: true, status: true, capacity: true, enrolledCount: true },
          });
          if (!r || !runAcceptsNewEnrolments(r.status)) {
            throw new Error(`INVALID_RUN:${runId}`);
          }
          if (r.capacity > 0 && r.enrolledCount >= r.capacity) {
            throw new Error(`CAPACITY:${runId}`);
          }
          const e = await tx.enrolment.create({
            data: {
              companyId,
              studentId,
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
          results.push(e);
        }
        return results;
      });

      await createAuditLog({
        userId,
        companyId,
        action: "academy.enrolment.batch_create",
        entityType: "Enrolment",
        entityId: created[0]?.id ?? studentId,
        metadata: { studentId, courseRunIds, count: created.length },
      });

      return reply.code(201).send({ enrolments: created });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("INVALID_RUN:")) {
        return reply.code(400).send({ error: "Validation error", message: "Course run no longer accepts enrolments" });
      }
      if (msg.startsWith("CAPACITY:")) {
        return reply.code(409).send({ error: "Conflict", message: "Course run is at capacity" });
      }
      const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return reply.code(409).send({
          error: "Conflict",
          message: "Student is already enrolled in one of these course runs",
        });
      }
      throw e;
    }
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const academyGate = await getAcademyComplianceGate(companyId);
    if (!academyGate.ok) {
      return reply.code(400).send({
        error: "Validation error",
        message: "Academy profile is not compliant for enrolments",
        blockers: academyGate.blockers,
      });
    }
    const body = createEnrolmentSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }

    const [student, run] = await Promise.all([
      prisma.student.findFirst({
        where: { id: body.data.studentId, companyId },
        select: { id: true, adminFeeStatus: true, psiraPreRegistrationStatus: true },
      }),
      prisma.courseRun.findFirst({
        where: { id: body.data.courseRunId, companyId },
        select: { id: true, status: true, capacity: true, enrolledCount: true, course: { select: { psiraCategory: true } } },
      }),
    ]);
    if (!student) {
      return reply.code(400).send({ error: "Validation error", message: "studentId not found" });
    }
    if (!studentMayEnrol(student.adminFeeStatus)) {
      return reply.code(400).send({
        error: "Validation error",
        message: "Admin fee must be paid or waived before enrolling this student",
      });
    }
    const docGate = await ensureLearnerDocumentGate(companyId, student.id);
    if (!docGate.ok) {
      return reply.code(400).send({ error: "Validation error", message: docGate.reason });
    }
    if (!run) {
      return reply.code(400).send({ error: "Validation error", message: "courseRunId not found" });
    }
    if (!runAcceptsNewEnrolments(run.status)) {
      return reply.code(400).send({
        error: "Validation error",
        message: `Course run does not accept new enrolments (status: ${run.status})`,
      });
    }
    if (run.course.psiraCategory && student.psiraPreRegistrationStatus !== "completed") {
      return reply.code(400).send({
        error: "Validation error",
        message: "Learner must complete PSIRA pre-registration before enrolling in this course run",
      });
    }
    if (body.data.feePlanId) {
      const plan = await prisma.feePlan.findFirst({
        where: { id: body.data.feePlanId, companyId },
      });
      if (!plan) {
        return reply.code(400).send({ error: "Validation error", message: "feePlanId not found" });
      }
    }

    const enrolmentDate = parseEnrolmentDate(body.data.enrolmentDate) ?? new Date();

    try {
      const enrolment = await prisma.$transaction(async (tx) => {
        const r = await tx.courseRun.findFirst({
          where: { id: body.data.courseRunId, companyId },
          select: { id: true, status: true, capacity: true, enrolledCount: true },
        });
        if (!r || !runAcceptsNewEnrolments(r.status)) {
          throw new Error("RUN_CLOSED");
        }
        if (r.capacity > 0 && r.enrolledCount >= r.capacity) {
          throw new Error("AT_CAPACITY");
        }
        const e = await tx.enrolment.create({
          data: {
            companyId,
            studentId: body.data.studentId,
            courseRunId: body.data.courseRunId,
            enrolmentDate,
            feePlanId: body.data.feePlanId ?? undefined,
            financialStatus: body.data.financialStatus,
            attendanceStatus: body.data.attendanceStatus,
            completionStatus: body.data.completionStatus,
            reportingReadinessStatus: body.data.reportingReadinessStatus,
            psiraSubmissionStatus: body.data.psiraSubmissionStatus,
            remarks: body.data.remarks ?? undefined,
          },
          include: {
            student: { select: { studentNumber: true, firstName: true, lastName: true } },
            courseRun: { select: { runCode: true } },
          },
        });
        await tx.courseRun.update({
          where: { id: body.data.courseRunId },
          data: { enrolledCount: { increment: 1 } },
        });
        return e;
      });

      await createAuditLog({
        userId,
        companyId,
        action: "academy.enrolment.create",
        entityType: "Enrolment",
        entityId: enrolment.id,
        metadata: {
          studentId: enrolment.studentId,
          courseRunId: enrolment.courseRunId,
        },
      });

      return reply.code(201).send({ enrolment });
    } catch (e: unknown) {
      if (e instanceof Error) {
        if (e.message === "RUN_CLOSED") {
          return reply.code(400).send({
            error: "Validation error",
            message: "Course run does not accept new enrolments",
          });
        }
        if (e.message === "AT_CAPACITY") {
          return reply.code(409).send({ error: "Conflict", message: "Course run is at capacity" });
        }
      }
      const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return reply.code(409).send({
          error: "Conflict",
          message: "Student is already enrolled in this course run",
        });
      }
      throw e;
    }
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const enrolment = await prisma.enrolment.findFirst({
      where: { id, companyId },
      include: {
        student: true,
        courseRun: { include: { course: true, branch: true } },
        feePlan: true,
      },
    });
    if (!enrolment) {
      return reply.code(404).send({ error: "Not found", message: "Enrolment not found" });
    }
    return {
      enrolment: {
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
      },
    };
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const body = updateEnrolmentSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const existing = await prisma.enrolment.findFirst({ where: { id, companyId } });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Enrolment not found" });
    }
    const d = body.data;
    if (d.feePlanId) {
      const plan = await prisma.feePlan.findFirst({ where: { id: d.feePlanId, companyId } });
      if (!plan) {
        return reply.code(400).send({ error: "Validation error", message: "feePlanId not found" });
      }
    }
    const enrolmentDate = d.enrolmentDate != null ? parseEnrolmentDate(d.enrolmentDate) : undefined;
    if (d.enrolmentDate != null && !enrolmentDate) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid enrolmentDate" });
    }

    const enrolment = await prisma.enrolment.update({
      where: { id },
      data: {
        ...(enrolmentDate != null ? { enrolmentDate } : {}),
        ...(d.feePlanId !== undefined ? { feePlanId: d.feePlanId } : {}),
        ...(d.financialStatus != null ? { financialStatus: d.financialStatus } : {}),
        ...(d.attendanceStatus != null ? { attendanceStatus: d.attendanceStatus } : {}),
        ...(d.completionStatus != null ? { completionStatus: d.completionStatus } : {}),
        ...(d.reportingReadinessStatus != null ? { reportingReadinessStatus: d.reportingReadinessStatus } : {}),
        ...(d.psiraSubmissionStatus != null ? { psiraSubmissionStatus: d.psiraSubmissionStatus } : {}),
        ...(d.remarks !== undefined ? { remarks: d.remarks } : {}),
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
      metadata: d as Record<string, unknown>,
    });

    return { enrolment };
  });

  app.delete("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };

    const existing = await prisma.enrolment.findFirst({
      where: { id, companyId },
      select: { id: true, courseRunId: true, studentId: true },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Enrolment not found" });
    }

    await prisma.$transaction([
      prisma.enrolment.delete({ where: { id } }),
      prisma.courseRun.update({
        where: { id: existing.courseRunId },
        data: { enrolledCount: { decrement: 1 } },
      }),
    ]);

    await createAuditLog({
      userId,
      companyId,
      action: "academy.enrolment.delete",
      entityType: "Enrolment",
      entityId: id,
      metadata: { courseRunId: existing.courseRunId, studentId: existing.studentId },
    });

    return reply.code(204).send();
  });
}
