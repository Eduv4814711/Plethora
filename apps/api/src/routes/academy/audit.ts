import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { academyProtect } from "./constants.js";

const ACADEMY_ENTITY_TYPES = [
  "AcademyProfile",
  "AcademyInstructor",
  "AcademyClassroom",
  "AcademyAttendanceSession",
  "AcademyAttendanceRecord",
  "AcademyAssessment",
  "AcademyCertificate",
  "AcademyComplianceDocument",
  "AcademyPolicyDocument",
  "AcademyRenewalAlert",
  "Student",
  "Course",
  "CourseRun",
  "Enrolment",
  "AcademyInvoice",
  "AcademyPayment",
  "AcademyBranch",
  "StudentDocument",
  "AcademyInstructorDocument",
];

export async function academyAuditRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    const where = {
      companyId: user.companyId,
      entityType: { in: ACADEMY_ENTITY_TYPES },
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.action ? { action: { contains: q.action, mode: "insensitive" as const } } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.from || q.to
        ? {
            timestamp: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({ where, include: { user: { select: { id: true, name: true, email: true } } }, take: limit, skip: offset, orderBy: { timestamp: "desc" } }),
      prisma.auditLog.count({ where }),
    ]);
    return { logs, total, limit, offset };
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const log = await prisma.auditLog.findFirst({
      where: {
        id,
        companyId: user.companyId,
        entityType: { in: ACADEMY_ENTITY_TYPES },
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!log) {
      return reply.code(404).send({ error: "Not found", message: "Audit log not found" });
    }
    return { log };
  });
}
