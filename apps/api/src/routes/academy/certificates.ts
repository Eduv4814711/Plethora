import type { FastifyInstance } from "fastify";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { getAcademyComplianceGate } from "../../services/academy-compliance.service.js";
import { academyProtect } from "./constants.js";

const createSchema = z.object({
  learnerId: z.string().min(1),
  courseId: z.string().min(1),
  enrolmentId: z.string().optional().nullable(),
  completionDate: z.string().optional().nullable(),
  issueDate: z.string().min(1),
  certificateNumber: z.string().optional().nullable(),
  pdfPath: z.string().optional().nullable(),
});

const updateSchema = z.object({
  completionDate: z.string().optional().nullable(),
  issueDate: z.string().optional(),
  pdfPath: z.string().optional().nullable(),
  status: z.enum(["active", "reprinted", "revoked", "void"]).optional(),
});

function parseDate(v?: string | null): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function enforceCertificateGate(companyId: string, learnerId: string, courseId: string, enrolmentId?: string | null) {
  const academyGate = await getAcademyComplianceGate(companyId);
  if (!academyGate.ok) return { ok: false, message: "Academy profile is not compliant", blockers: academyGate.blockers } as const;

  const enrolment = enrolmentId
    ? await prisma.enrolment.findFirst({ where: { id: enrolmentId, companyId }, include: { courseRun: { include: { course: true } } } })
    : await prisma.enrolment.findFirst({ where: { companyId, studentId: learnerId, courseRun: { courseId } }, include: { courseRun: { include: { course: true } } }, orderBy: { createdAt: "desc" } });

  if (!enrolment) return { ok: false, message: "Learner must be enrolled in this course before certificate issue" } as const;
  if (enrolment.completionStatus !== "completed") return { ok: false, message: "Enrolment completion status must be completed" } as const;
  if (enrolment.attendanceStatus !== "compliant") return { ok: false, message: "Attendance must be compliant before certificate issue" } as const;
  if (enrolment.reportingReadinessStatus !== "ready") return { ok: false, message: "Reporting readiness must be ready before certificate issue" } as const;

  if (enrolment.courseRun.course.requiresAssessment) {
    const passed = await prisma.academyAssessment.count({
      where: {
        companyId,
        learnerId,
        courseId,
        result: { in: ["pass", "competent"] },
      },
    });
    if (passed <= 0) return { ok: false, message: "A passed/competent assessment is required before certificate issue" } as const;
  }

  const records = await prisma.academyAttendanceRecord.findMany({ where: { companyId, enrolmentId: enrolment.id } });
  if (records.length > 0) {
    const present = records.filter((r) => r.attendanceStatus === "present" || r.attendanceStatus === "late").length;
    const percent = (present / records.length) * 100;
    const min = enrolment.courseRun.course.minimumAttendancePercent ?? 0;
    if (percent < min) return { ok: false, message: `Attendance percent ${percent.toFixed(1)}% is below required ${min}%` } as const;
  }

  return { ok: true, enrolmentId: enrolment.id } as const;
}

export async function academyCertificatesRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 100, 200);
    const offset = Number(q.offset) || 0;
    const where = {
      companyId,
      ...(q.learnerId ? { learnerId: q.learnerId } : {}),
      ...(q.courseId ? { courseId: q.courseId } : {}),
      ...(q.status ? { status: q.status as "active" | "reprinted" | "revoked" | "void" } : {}),
    };
    const [certificates, total] = await Promise.all([
      prisma.academyCertificate.findMany({ where, include: { learner: true, course: true, enrolment: true }, orderBy: { issueDate: "desc" }, take: limit, skip: offset }),
      prisma.academyCertificate.count({ where }),
    ]);
    return { certificates, total, limit, offset };
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const certificate = await prisma.academyCertificate.findFirst({ where: { id, companyId }, include: { learner: true, course: true, enrolment: true } });
    if (!certificate) return reply.code(404).send({ error: "Not found", message: "Certificate not found" });
    return { certificate };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const d = parsed.data;

    const gate = await enforceCertificateGate(companyId, d.learnerId, d.courseId, d.enrolmentId);
    if (!gate.ok) {
      return reply.code(400).send({ error: "Validation error", message: gate.message, blockers: "blockers" in gate ? gate.blockers : undefined });
    }

    const count = await prisma.academyCertificate.count({ where: { companyId } });
    const certificateNumber = d.certificateNumber?.trim() || `CERT-${String(count + 1).padStart(5, "0")}`;
    const verificationCode = randomBytes(8).toString("hex");
    const cert = await prisma.academyCertificate.create({
      data: {
        companyId,
        learnerId: d.learnerId,
        courseId: d.courseId,
        enrolmentId: d.enrolmentId ?? gate.enrolmentId,
        completionDate: parseDate(d.completionDate),
        issueDate: new Date(d.issueDate),
        certificateNumber,
        verificationCode,
        pdfPath: d.pdfPath,
        issuedByUserId: userId,
      },
    });
    await createAuditLog({ userId, companyId, action: "academy.certificate.issue", entityType: "AcademyCertificate", entityId: cert.id, metadata: { certificateNumber } });
    return reply.code(201).send({ certificate: cert });
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation error", details: parsed.error.flatten() });
    const existing = await prisma.academyCertificate.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Certificate not found" });
    const d = parsed.data;
    const certificate = await prisma.academyCertificate.update({
      where: { id },
      data: {
        completionDate: d.completionDate === undefined ? undefined : parseDate(d.completionDate),
        issueDate: d.issueDate ? new Date(d.issueDate) : undefined,
        pdfPath: d.pdfPath,
        status: d.status,
      },
    });
    await createAuditLog({ userId, companyId, action: "academy.certificate.update", entityType: "AcademyCertificate", entityId: id });
    return { certificate };
  });

  app.delete("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const existing = await prisma.academyCertificate.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Certificate not found" });
    await prisma.academyCertificate.delete({ where: { id } });
    await createAuditLog({ userId, companyId, action: "academy.certificate.delete", entityType: "AcademyCertificate", entityId: id });
    return reply.code(204).send();
  });

  app.post("/:id/reprint", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const cert = await prisma.academyCertificate.findFirst({ where: { id, companyId } });
    if (!cert) return reply.code(404).send({ error: "Not found", message: "Certificate not found" });
    const next = await prisma.academyCertificate.update({ where: { id }, data: { status: "reprinted" } });
    await createAuditLog({ userId, companyId, action: "academy.certificate.reprint", entityType: "AcademyCertificate", entityId: id });
    return { certificate: next };
  });

  app.post("/:id/revoke", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const cert = await prisma.academyCertificate.findFirst({ where: { id, companyId } });
    if (!cert) return reply.code(404).send({ error: "Not found", message: "Certificate not found" });
    const next = await prisma.academyCertificate.update({ where: { id }, data: { status: "revoked" } });
    await createAuditLog({ userId, companyId, action: "academy.certificate.revoke", entityType: "AcademyCertificate", entityId: id });
    return { certificate: next };
  });

  app.get("/verify/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const cert = await prisma.academyCertificate.findFirst({
      where: { verificationCode: code },
      select: {
        certificateNumber: true,
        status: true,
        issueDate: true,
        completionDate: true,
        learner: { select: { firstName: true, lastName: true, studentNumber: true } },
        course: { select: { title: true, code: true } },
      },
    });
    if (!cert) return reply.code(404).send({ error: "Not found", message: "Certificate verification failed" });
    return { valid: cert.status === "active" || cert.status === "reprinted", certificate: cert };
  });
}
