import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { getAcademyReceivablesSummary } from "../../services/academy-finance.service.js";
import { academyProtect } from "./constants.js";

const ACTIVE_COURSE_RUN_STATUSES = ["planned", "open", "in_progress"] as const;

function startOfMonthUtc(ref: Date): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1, 0, 0, 0, 0));
}

function startOfNextMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/**
 * (current - previous) / |previous| for signed trend; if previous is 0, return null.
 */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export async function academyHubRoutes(app: FastifyInstance) {
  app.get("/summary", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const now = new Date();
    const thisMonthStart = startOfMonthUtc(now);
    const nextMonthStart = startOfNextMonthUtc(thisMonthStart);
    const lastMonthStart = new Date(
      Date.UTC(thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth() - 1, 1, 0, 0, 0, 0)
    );
    const lastMonthEnd = thisMonthStart;

    const [
      totalStudents,
      studentsAtStartThisMonth,
      newStudentsThisMonth,
      newStudentsLastMonth,
      activeCourseRunCount,
      newCourseRunsThisMonth,
      newCourseRunsLastMonth,
      enrolmentsThisMonth,
      enrolmentsLastMonth,
      receivables,
    ] = await Promise.all([
      prisma.student.count({ where: { companyId } }),
      prisma.student.count({ where: { companyId, createdAt: { lt: thisMonthStart } } }),
      prisma.student.count({
        where: { companyId, createdAt: { gte: thisMonthStart, lt: nextMonthStart } },
      }),
      prisma.student.count({
        where: { companyId, createdAt: { gte: lastMonthStart, lt: lastMonthEnd } },
      }),
      prisma.courseRun.count({
        where: { companyId, status: { in: [...ACTIVE_COURSE_RUN_STATUSES] } },
      }),
      prisma.courseRun.count({
        where: { companyId, createdAt: { gte: thisMonthStart, lt: nextMonthStart } },
      }),
      prisma.courseRun.count({
        where: { companyId, createdAt: { gte: lastMonthStart, lt: lastMonthEnd } },
      }),
      prisma.enrolment.count({
        where: {
          companyId,
          enrolmentDate: { gte: thisMonthStart, lt: nextMonthStart },
        },
      }),
      prisma.enrolment.count({
        where: {
          companyId,
          enrolmentDate: { gte: lastMonthStart, lt: lastMonthEnd },
        },
      }),
      getAcademyReceivablesSummary(companyId),
    ]);

    const studentsThisMonth = totalStudents - studentsAtStartThisMonth;
    const studentsStockAtStartOfMonth = studentsAtStartThisMonth;
    const totalStudentsDeltaPct =
      studentsStockAtStartOfMonth > 0
        ? (studentsThisMonth / studentsStockAtStartOfMonth) * 100
        : null;

    return {
      totalStudents,
      activeCourseRunCount,
      enrolmentsInCurrentMonth: enrolmentsThisMonth,
      outstanding: receivables.outstanding.toString(),
      overdueInvoiceCount: receivables.overdueInvoiceCount,
      summary: {
        totalBilled: receivables.totalBilled.toString(),
        totalCollected: receivables.totalCollected.toString(),
        activeInvoiceCount: receivables.activeInvoiceCount,
      },
      deltas: {
        totalStudents: totalStudentsDeltaPct,
        newEnrolments: pctChange(enrolmentsThisMonth, enrolmentsLastMonth),
        activeCourseRuns: pctChange(newCourseRunsThisMonth, newCourseRunsLastMonth),
        newStudents: pctChange(newStudentsThisMonth, newStudentsLastMonth),
        /** Outstanding amount trend not computed (no historical store). */
        outstanding: null as null,
      },
    };
  });
}
