import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AcademyStudentStatus, AcademyPsiraPreRegistrationStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { academyProtect } from "./constants.js";

function sanitizeDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getFullYear();
  if (y < 1900 || y > 2100) return undefined;
  return d;
}

const optionalString = z.string().optional().nullable();
const optionalDate = z.string().optional().nullable().transform((s) => (s ? sanitizeDate(s) : undefined));

async function generateNextStudentNumber(companyId: string): Promise<string> {
  const prefix = "STU";
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  const students = await prisma.student.findMany({
    where: { companyId },
    select: { studentNumber: true },
  });
  let maxNum = 0;
  for (const s of students) {
    const m = s.studentNumber.match(pattern);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  return `${prefix}-${String(maxNum + 1).padStart(4, "0")}`;
}

const studentStatuses = z.enum([
  "prospect",
  "registered",
  "active",
  "completed",
  "inactive",
  "blocked",
]) satisfies z.ZodType<AcademyStudentStatus>;

const psiraPreReg = z.enum(["unknown", "not_required", "pending", "completed"]) satisfies z.ZodType<
  AcademyPsiraPreRegistrationStatus
>;

const createStudentSchema = z.object({
  studentNumber: z.string().min(1).max(50).optional(),
  firstName: z.string().min(1),
  middleName: optionalString,
  lastName: z.string().min(1),
  preferredName: optionalString,
  idType: optionalString,
  idNumber: optionalString,
  dateOfBirth: optionalDate,
  gender: optionalString,
  nationality: optionalString,
  phone: optionalString,
  alternatePhone: optionalString,
  email: optionalString,
  addressLine1: optionalString,
  addressLine2: optionalString,
  city: optionalString,
  province: optionalString,
  postalCode: optionalString,
  nextOfKinName: optionalString,
  nextOfKinPhone: optionalString,
  psiraProfileReference: optionalString,
  psiraPreRegistrationStatus: psiraPreReg.optional(),
  status: studentStatuses.optional(),
  employeeId: z.string().optional().nullable(),
});

const updateStudentSchema = createStudentSchema.partial();

function toDecimal(v: unknown): Prisma.Decimal {
  if (typeof v === "number") return new Prisma.Decimal(v);
  return new Prisma.Decimal(String(v));
}

const recordAdminFeeSchema = z
  .object({
    status: z.enum(["paid", "waived", "unpaid"]),
    amount: z.union([z.number(), z.string()]).optional(),
    method: optionalString,
    reference: optionalString,
    notes: optionalString,
  })
  .superRefine((data, ctx) => {
    if (data.status === "paid") {
      if (data.amount === undefined || data.amount === "" || data.amount === null) {
        ctx.addIssue({ code: "custom", message: "amount is required when status is paid", path: ["amount"] });
      }
    }
    if (data.status === "waived") {
      const n = data.notes?.trim();
      if (!n) {
        ctx.addIssue({ code: "custom", message: "notes are required when status is waived", path: ["notes"] });
      }
    }
  });

export async function academyStudentsRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 50, 200);
    const offset = Number(q.offset) || 0;
    const status = q.status as AcademyStudentStatus | undefined;
    const search = (q.q ?? "").trim();

    const where = {
      companyId,
      ...(status ? { status } : {}),
      ...(search.length >= 2
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" as const } },
              { lastName: { contains: search, mode: "insensitive" as const } },
              { studentNumber: { contains: search, mode: "insensitive" as const } },
              { idNumber: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.student.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { documents: true, enrolments: true } },
        },
      }),
      prisma.student.count({ where }),
    ]);

    const students = rows.map((s) => ({
      ...s,
      adminFeeAmount: s.adminFeeAmount != null ? s.adminFeeAmount.toString() : null,
    }));

    return { students, total, limit, offset };
  });

  app.post("/", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const body = createStudentSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const data = body.data;
    if (data.employeeId) {
      const emp = await prisma.employee.findFirst({
        where: { id: data.employeeId, companyId },
      });
      if (!emp) {
        return reply.code(400).send({ error: "Validation error", message: "employeeId not found in company" });
      }
    }
    const studentNumber = data.studentNumber?.trim() || (await generateNextStudentNumber(companyId));
    try {
      const student = await prisma.student.create({
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
      await createAuditLog({
        userId,
        companyId,
        action: "academy.student.create",
        entityType: "Student",
        entityId: student.id,
        metadata: { studentNumber: student.studentNumber },
      });
      return reply.code(201).send({
        student: {
          ...student,
          adminFeeAmount: student.adminFeeAmount != null ? student.adminFeeAmount.toString() : null,
        },
      });
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Student number already exists" });
      }
      throw e;
    }
  });

  app.post("/:id/admin-fee", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const body = recordAdminFeeSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const existing = await prisma.student.findFirst({ where: { id, companyId } });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Student not found" });
    }
    const d = body.data;
    let data: Prisma.StudentUpdateInput;

    if (d.status === "paid") {
      const dec = toDecimal(d.amount);
      if (dec.lte(0)) {
        return reply.code(400).send({ error: "Validation error", message: "amount must be greater than zero" });
      }
      data = {
        adminFeeStatus: "paid",
        adminFeePaidAt: new Date(),
        adminFeeAmount: dec,
        adminFeeMethod: d.method?.trim() || null,
        adminFeeReference: d.reference?.trim() || null,
        adminFeeNotes: d.notes?.trim() || null,
        adminFeeRecordedByUserId: userId,
      };
    } else if (d.status === "waived") {
      data = {
        adminFeeStatus: "waived",
        adminFeePaidAt: null,
        adminFeeAmount: null,
        adminFeeMethod: null,
        adminFeeReference: null,
        adminFeeNotes: d.notes!.trim(),
        adminFeeRecordedByUserId: userId,
      };
    } else {
      data = {
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
      where: { id },
      data,
      include: {
        employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
        _count: { select: { documents: true, enrolments: true } },
      },
    });

    await createAuditLog({
      userId,
      companyId,
      action: "academy.student.admin_fee",
      entityType: "Student",
      entityId: student.id,
      metadata: { status: d.status, studentNumber: student.studentNumber },
    });

    const s = {
      ...student,
      adminFeeAmount: student.adminFeeAmount != null ? student.adminFeeAmount.toString() : null,
    };
    return { student: s };
  });

  app.get("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const { id } = request.params as { id: string };
    const student = await prisma.student.findFirst({
      where: { id, companyId },
      include: {
        employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
        _count: { select: { documents: true, enrolments: true } },
      },
    });
    if (!student) {
      return reply.code(404).send({ error: "Not found", message: "Student not found" });
    }
    return {
      student: {
        ...student,
        adminFeeAmount: student.adminFeeAmount != null ? student.adminFeeAmount.toString() : null,
      },
    };
  });

  app.patch("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const body = updateStudentSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation error", details: body.error.flatten() });
    }
    const existing = await prisma.student.findFirst({ where: { id, companyId } });
    if (!existing) {
      return reply.code(404).send({ error: "Not found", message: "Student not found" });
    }
    const data = body.data;
    if (data.employeeId) {
      const emp = await prisma.employee.findFirst({
        where: { id: data.employeeId, companyId },
      });
      if (!emp) {
        return reply.code(400).send({ error: "Validation error", message: "employeeId not found in company" });
      }
    }
    try {
      const student = await prisma.student.update({
        where: { id },
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
      });
      await createAuditLog({
        userId,
        companyId,
        action: "academy.student.update",
        entityType: "Student",
        entityId: student.id,
        metadata: body.data as Record<string, unknown>,
      });
      return {
        student: {
          ...student,
          adminFeeAmount: student.adminFeeAmount != null ? student.adminFeeAmount.toString() : null,
        },
      };
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
      if (code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Student number already exists" });
      }
      throw e;
    }
  });

  app.delete("/:id", { preHandler: academyProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const userId = request.user!.sub;
    const { id } = request.params as { id: string };
    const existing = await prisma.student.findFirst({ where: { id, companyId }, include: { _count: { select: { enrolments: true } } } });
    if (!existing) return reply.code(404).send({ error: "Not found", message: "Student not found" });
    if (existing._count.enrolments > 0) {
      const student = await prisma.student.update({ where: { id }, data: { status: "inactive" } });
      await createAuditLog({ userId, companyId, action: "academy.student.deactivate", entityType: "Student", entityId: id });
      return { student: { ...student, adminFeeAmount: student.adminFeeAmount != null ? student.adminFeeAmount.toString() : null }, deactivated: true };
    }
    await prisma.student.delete({ where: { id } });
    await createAuditLog({ userId, companyId, action: "academy.student.delete", entityType: "Student", entityId: id });
    return reply.code(204).send();
  });
}
