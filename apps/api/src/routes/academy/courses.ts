import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";

const optionalString = z.string().optional().nullable();
const optionalInt = z.number().int().optional().nullable();
const optionalDecimal = z.union([z.number(), z.string()]).optional().nullable();

const createCourseSchema = z.object({
  code: z.string().min(1).max(80),
  title: z.string().min(1),
  description: optionalString,
  psiraCategory: optionalString,
  durationDays: optionalInt,
  deliveryMode: optionalString,
  feeAmount: optionalDecimal,
  minimumAttendancePercent: optionalInt,
  requiresAssessment: z.boolean().optional(),
  requiresDocuments: z.boolean().optional(),
  active: z.boolean().optional(),
});

const updateCourseSchema = createCourseSchema.partial();

function feeToDecimal(v: z.infer<typeof optionalDecimal>): Prisma.Decimal | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "number") return new Prisma.Decimal(v);
  const s = String(v).trim();
  if (!s) return null;
  return new Prisma.Decimal(s);
}

export async function academyCoursesRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const activeOnly = q.active === "true";
    const limit = Math.min(Number(q.limit) || 100, 200);
    const offset = Number(q.offset) || 0;
    const where = {
      companyId,
      ...(activeOnly ? { active: true } : {}),
      ...(q.q ? { OR: [{ code: { contains: q.q, mode: "insensitive" as const } }, { title: { contains: q.q, mode: "insensitive" as const } }] } : {}),
    };
    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        orderBy: [{ active: "desc" }, { code: "asc" }],
        take: limit,
        skip: offset,
      }),
      prisma.course.count({ where }),
    ]);
    return {
      courses: courses.map((c) => ({
        ...c,
        feeAmount: c.feeAmount != null ? c.feeAmount.toString() : null,
      })),
      total,
      limit,
      offset,
    };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const body = createCourseSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const feeAmount = feeToDecimal(body.data.feeAmount);
    try {
      const course = await prisma.course.create({
        data: {
          companyId,
          code: body.data.code.trim(),
          title: body.data.title,
          description: body.data.description ?? undefined,
          psiraCategory: body.data.psiraCategory ?? undefined,
          durationDays: body.data.durationDays ?? undefined,
          deliveryMode: body.data.deliveryMode ?? undefined,
          feeAmount: feeAmount === undefined ? undefined : feeAmount,
          minimumAttendancePercent: body.data.minimumAttendancePercent ?? undefined,
          requiresAssessment: body.data.requiresAssessment,
          requiresDocuments: body.data.requiresDocuments,
          active: body.data.active,
        },
      });
      await createAuditLog({
        userId,
        companyId,
        action: "academy.course.create",
        entityType: "Course",
        entityId: course.id,
        metadata: { code: course.code, title: course.title },
      });
      return reply.code(201).send({
        course: { ...course, feeAmount: course.feeAmount != null ? course.feeAmount.toString() : null },
      });
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Course code already exists" });
      }
      throw e;
    }
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const course = await prisma.course.findFirst({
      where: { id, companyId },
      include: { _count: { select: { courseRuns: true } } },
    });
    if (!course) {
      return reply.code(404).send({ error: "Not found", message: "Course not found" });
    }
    return { course: { ...course, feeAmount: course.feeAmount != null ? course.feeAmount.toString() : null } };
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const body = updateCourseSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const existing = await prisma.course.findFirst({ where: { id, companyId } });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Course not found" });
    }
    const d = body.data;
    const feeAmount = "feeAmount" in d ? feeToDecimal(d.feeAmount) : undefined;
    try {
      const course = await prisma.course.update({
        where: { id },
        data: {
          ...(d.code != null ? { code: d.code.trim() } : {}),
          ...(d.title != null ? { title: d.title } : {}),
          ...(d.description !== undefined ? { description: d.description } : {}),
          ...(d.psiraCategory !== undefined ? { psiraCategory: d.psiraCategory } : {}),
          ...(d.durationDays !== undefined ? { durationDays: d.durationDays } : {}),
          ...(d.deliveryMode !== undefined ? { deliveryMode: d.deliveryMode } : {}),
          ...(feeAmount !== undefined ? { feeAmount } : {}),
          ...(d.minimumAttendancePercent !== undefined ? { minimumAttendancePercent: d.minimumAttendancePercent } : {}),
          ...(d.requiresAssessment !== undefined ? { requiresAssessment: d.requiresAssessment } : {}),
          ...(d.requiresDocuments !== undefined ? { requiresDocuments: d.requiresDocuments } : {}),
          ...(d.active !== undefined ? { active: d.active } : {}),
        },
      });
      await createAuditLog({
        userId,
        companyId,
        action: "academy.course.update",
        entityType: "Course",
        entityId: course.id,
        metadata: d as Record<string, unknown>,
      });
      return { course: { ...course, feeAmount: course.feeAmount != null ? course.feeAmount.toString() : null } };
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Course code already exists" });
      }
      throw e;
    }
  });

  app.delete("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const existing = await prisma.course.findFirst({ where: { id, companyId }, include: { _count: { select: { courseRuns: true } } } });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Course not found" });
    if (existing._count.courseRuns > 0) {
      const course = await prisma.course.update({ where: { id }, data: { active: false } });
      await createAuditLog({ userId, companyId, action: "academy.course.deactivate", entityType: "Course", entityId: id });
      return { course: { ...course, feeAmount: course.feeAmount != null ? course.feeAmount.toString() : null }, deactivated: true };
    }
    await prisma.course.delete({ where: { id } });
    await createAuditLog({ userId, companyId, action: "academy.course.delete", entityType: "Course", entityId: id });
    return reply.code(204).send();
  });
}
