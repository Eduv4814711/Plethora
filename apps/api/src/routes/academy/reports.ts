import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { academyProtect } from "./constants.js";

function toNum(d: Prisma.Decimal | null | undefined): number {
  return d ? Number(d.toString()) : 0;
}

export async function academyReportsRoutes(app: FastifyInstance) {
  app.get("/dashboard", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const now = new Date();
    const from = q.from ? new Date(q.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = q.to ? new Date(q.to) : now;
    const [
      activeLearners,
      monthlyEnrolments,
      invoices,
      attendance,
      assessments,
      certificatesIssued,
      expiringDocs,
      instructorStatus,
      renewalsDue,
    ] = await Promise.all([
      prisma.student.count({ where: { companyId, status: { in: ["registered", "active"] } } }),
      prisma.enrolment.count({ where: { companyId, createdAt: { gte: from, lte: to } } }),
      prisma.academyInvoice.findMany({ where: { companyId, status: { notIn: ["draft", "cancelled"] }, createdAt: { gte: from, lte: to } }, include: { payments: { where: { verificationStatus: "verified" } } } }),
      prisma.academyAttendanceRecord.findMany({ where: { companyId, createdAt: { gte: from, lte: to } } }),
      prisma.academyAssessment.findMany({ where: { companyId, createdAt: { gte: from, lte: to } } }),
      prisma.academyCertificate.count({ where: { companyId, createdAt: { gte: from, lte: to } } }),
      prisma.academyComplianceDocument.count({ where: { companyId, expiryDate: { lte: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) } } }),
      prisma.academyInstructor.groupBy({ by: ["status"], where: { companyId }, _count: { _all: true } }),
      prisma.academyRenewalAlert.count({ where: { companyId, dueDate: { lte: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) } } }),
    ]);

    let billed = 0;
    let collected = 0;
    for (const inv of invoices) {
      billed += toNum(inv.totalAmount);
      for (const p of inv.payments) collected += toNum(p.amount);
    }

    const presentLike = attendance.filter((a) => a.attendanceStatus === "present" || a.attendanceStatus === "late").length;
    const attendanceRate = attendance.length ? (presentLike / attendance.length) * 100 : 0;
    const passLike = assessments.filter((a) => a.result === "pass" || a.result === "competent").length;
    const passRate = assessments.length ? (passLike / assessments.length) * 100 : 0;

    return {
      activeLearners,
      monthlyEnrolments,
      revenueCollected: collected,
      outstandingFees: billed - collected,
      attendanceRate,
      passFailRate: { pass: passRate, fail: 100 - passRate },
      certificatesIssued,
      expiringDocuments: expiringDocs,
      instructorStatus,
      renewalsDue,
      filter: { from, to },
    };
  });

  app.get("/dashboard/export", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const from = q.from ? new Date(q.from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = q.to ? new Date(q.to) : new Date();
    const [enrolments, certificates, assessments] = await Promise.all([
      prisma.enrolment.findMany({ where: { companyId, createdAt: { gte: from, lte: to } }, include: { student: true, courseRun: { include: { course: true } } } }),
      prisma.academyCertificate.findMany({ where: { companyId, createdAt: { gte: from, lte: to } }, include: { learner: true, course: true } }),
      prisma.academyAssessment.findMany({ where: { companyId, createdAt: { gte: from, lte: to } }, include: { learner: true, course: true } }),
    ]);
    return { from, to, counts: { enrolments: enrolments.length, certificates: certificates.length, assessments: assessments.length }, rows: { enrolments, certificates, assessments } };
  });
}
