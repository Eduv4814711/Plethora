import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AcademyCourseRunStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";

const runStatusSchema = z.enum([
  "planned",
  "open",
  "in_progress",
  "completed",
  "reported",
  "closed",
]) satisfies z.ZodType<AcademyCourseRunStatus>;

function parseDateOnly(v: string): Date | undefined {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

const optionalForeignId = z
  .string()
  .refine((val) => val.trim().length > 0, {
    message: "Foreign key reference cannot be an empty string",
  })
  .optional()
  .nullable();

const createRunSchema = z.object({
  courseId: z.string().trim().min(1, "courseId is required"),
  runCode: z.string().trim().min(1).max(80),
  intakeName: z.string().optional().nullable(),
  academyBranchId: z.string().trim().min(1, "academyBranchId is required"),
  venueText: z.string().optional().nullable(),
  instructorEmployeeId: optionalForeignId,
  classroomId: optionalForeignId,
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  capacity: z.number().int().min(0).optional(),
  status: runStatusSchema.optional(),
});

const ALLOWED_RUN_STATUS_TRANSITIONS: Record<AcademyCourseRunStatus, AcademyCourseRunStatus[]> = {
  planned: ["open", "closed"],
  open: ["in_progress", "closed"],
  in_progress: ["completed", "closed"],
  completed: ["reported", "closed"],
  reported: ["closed"],
  closed: [],
};

export function canTransitionCourseRunStatus(
  current: AcademyCourseRunStatus,
  target: AcademyCourseRunStatus
): boolean {
  if (current === target) return true;
  return (ALLOWED_RUN_STATUS_TRANSITIONS[current] ?? []).includes(target);
}

const updateRunSchema = createRunSchema.partial().omit({ courseId: true });

const ENROLMENT_ALLOWED_RUN_STATUSES: AcademyCourseRunStatus[] = ["planned", "open", "in_progress"];

export async function academyCourseRunsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const courseId = q.courseId;
    const enrollable = q.enrollable === "true";
    const runs = await prisma.courseRun.findMany({
      where: {
        companyId,
        ...(courseId ? { courseId } : {}),
        ...(enrollable ? { status: { in: ENROLMENT_ALLOWED_RUN_STATUSES } } : {}),
      },
      orderBy: { startDate: "desc" },
      include: {
        course: { select: { id: true, code: true, title: true } },
        branch: { select: { id: true, name: true } },
        instructorEmployee: {
          select: { id: true, employeeNumber: true, firstName: true, lastName: true },
        },
        _count: { select: { enrolments: true } },
      },
    });
    const filtered = enrollable
      ? runs.filter((r) => r.capacity === 0 || r.enrolledCount < r.capacity)
      : runs;
    return { courseRuns: filtered };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const body = createRunSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const startDate = parseDateOnly(body.data.startDate);
    const endDate = parseDateOnly(body.data.endDate);
    if (!startDate || !endDate) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid startDate or endDate" });
    }
    if (endDate < startDate) {
      return reply.code(400).send({ error: "Validation error", message: "endDate must be on or after startDate" });
    }

    const [course, branch] = await Promise.all([
      prisma.course.findFirst({ where: { id: body.data.courseId, companyId } }),
      prisma.academyBranch.findFirst({ where: { id: body.data.academyBranchId, companyId } }),
    ]);
    if (!course) {
      return reply.code(400).send({ error: "Validation error", message: "courseId not found" });
    }
    if (!branch) {
      return reply.code(400).send({ error: "Validation error", message: "academyBranchId not found" });
    }
    if (body.data.instructorEmployeeId) {
      const emp = await prisma.employee.findFirst({
        where: { id: body.data.instructorEmployeeId, companyId },
      });
      if (!emp) {
        return reply.code(400).send({ error: "Validation error", message: "instructorEmployeeId not found" });
      }
    }
    if (body.data.classroomId) {
      const classroom = await prisma.academyClassroom.findFirst({
        where: { id: body.data.classroomId, companyId },
      });
      if (!classroom) {
        return reply.code(400).send({ error: "Validation error", message: "classroomId not found" });
      }
      if (classroom.academyBranchId !== body.data.academyBranchId) {
        return reply.code(400).send({ error: "Validation error", message: "Classroom branch does not match course run branch" });
      }
    }

    try {
      const run = await prisma.courseRun.create({
        data: {
          companyId,
          courseId: body.data.courseId,
          runCode: body.data.runCode.trim(),
          intakeName: body.data.intakeName ?? undefined,
          academyBranchId: body.data.academyBranchId,
          venueText: body.data.venueText ?? undefined,
          instructorEmployeeId: body.data.instructorEmployeeId ?? undefined,
          startDate,
          endDate,
          capacity: body.data.capacity ?? 0,
          status: body.data.status ?? "planned",
        },
        include: {
          course: { select: { code: true, title: true } },
          branch: { select: { name: true } },
        },
      });
      await createAuditLog({
        userId,
        companyId,
        action: "academy.course_run.create",
        entityType: "CourseRun",
        entityId: run.id,
        metadata: { runCode: run.runCode, courseId: run.courseId },
      });
      return reply.code(201).send({ courseRun: run });
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Run code already exists for this company" });
      }
      throw e;
    }
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const courseRun = await prisma.courseRun.findFirst({
      where: { id, companyId },
      include: {
        course: true,
        branch: true,
        instructorEmployee: {
          select: { id: true, employeeNumber: true, firstName: true, lastName: true },
        },
        _count: { select: { enrolments: true } },
      },
    });
    if (!courseRun) {
      return reply.code(404).send({ error: "Not found", message: "Course run not found" });
    }
    return {
      courseRun: {
        ...courseRun,
        course: {
          ...courseRun.course,
          feeAmount: courseRun.course.feeAmount != null ? courseRun.course.feeAmount.toString() : null,
        },
      },
    };
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const body = updateRunSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const existing = await prisma.courseRun.findFirst({ where: { id, companyId } });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Course run not found" });
    }
    const d = body.data;
    if (d.academyBranchId) {
      const branch = await prisma.academyBranch.findFirst({
        where: { id: d.academyBranchId, companyId },
      });
      if (!branch) {
        return reply.code(400).send({ error: "Validation error", message: "academyBranchId not found" });
      }
    }
    if (d.instructorEmployeeId) {
      const emp = await prisma.employee.findFirst({
        where: { id: d.instructorEmployeeId, companyId },
      });
      if (!emp) {
        return reply.code(400).send({ error: "Validation error", message: "instructorEmployeeId not found" });
      }
    }
    const targetBranchId = d.academyBranchId ?? existing.academyBranchId;
    if (d.classroomId) {
      const classroom = await prisma.academyClassroom.findFirst({
        where: { id: d.classroomId, companyId },
      });
      if (!classroom) {
        return reply.code(400).send({ error: "Validation error", message: "classroomId not found" });
      }
      if (classroom.academyBranchId !== targetBranchId) {
        return reply.code(400).send({ error: "Validation error", message: "Classroom branch does not match course run branch" });
      }
    }
    if (d.status != null && d.status !== existing.status) {
      if (!canTransitionCourseRunStatus(existing.status, d.status)) {
        return reply.code(400).send({
          error: "Validation error",
          message: `Cannot transition course run status from '${existing.status}' to '${d.status}'`,
        });
      }
    }
    const startDate = d.startDate != null ? parseDateOnly(d.startDate) : undefined;
    const endDate = d.endDate != null ? parseDateOnly(d.endDate) : undefined;
    if (d.startDate != null && !startDate) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid startDate" });
    }
    if (d.endDate != null && !endDate) {
      return reply.code(400).send({ error: "Validation error", message: "Invalid endDate" });
    }
    const nextStart = startDate ?? existing.startDate;
    const nextEnd = endDate ?? existing.endDate;
    if (nextEnd < nextStart) {
      return reply.code(400).send({ error: "Validation error", message: "endDate must be on or after startDate" });
    }

    try {
      const courseRun = await prisma.courseRun.update({
        where: { id },
        data: {
          ...(d.runCode != null ? { runCode: d.runCode.trim() } : {}),
          ...(d.intakeName !== undefined ? { intakeName: d.intakeName } : {}),
          ...(d.academyBranchId != null ? { academyBranchId: d.academyBranchId } : {}),
          ...(d.venueText !== undefined ? { venueText: d.venueText } : {}),
          ...(d.instructorEmployeeId !== undefined ? { instructorEmployeeId: d.instructorEmployeeId } : {}),
          ...(startDate != null ? { startDate } : {}),
          ...(endDate != null ? { endDate } : {}),
          ...(d.capacity !== undefined ? { capacity: d.capacity } : {}),
          ...(d.status != null ? { status: d.status } : {}),
        },
        include: {
          course: { select: { code: true, title: true } },
          branch: { select: { name: true } },
        },
      });
      await createAuditLog({
        userId,
        companyId,
        action: "academy.course_run.update",
        entityType: "CourseRun",
        entityId: courseRun.id,
        metadata: d as Record<string, unknown>,
      });
      return { courseRun };
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Run code already exists for this company" });
      }
      throw e;
    }
  });
}
