import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EmployeeStatus } from "@prisma/client";
import { requireRole } from "../middleware/rbac.js";
import { authProtect } from "../middleware/auth-protect.js";
import { requirePermission, requireAnyPermission } from "../middleware/permissions.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { transitionEmployeeStatus } from "../services/employee.service.js";
import { createAuditLog } from "../lib/audit.js";
import {
  employeeOperationalSelect,
  employeeHrPrivateSelect,
  employeeCompensationSelect,
  employeeGradeOperationalSelect,
  rejectForbiddenOperationalFields,
  enrichOperationalEmployee,
} from "../lib/employee-dto.js";

const optionalString = z.string().optional();
const optionalDate = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return undefined;
    const y = d.getFullYear();
    if (y < 1900 || y > 2100) return undefined;
    return d;
  });
const optionalBool = z.boolean().optional();

function normalizePhoneForStorage(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("27") && digits.length === 11) return digits;
  if (digits.startsWith("0") && digits.length === 10) return "27" + digits.slice(1);
  return digits;
}

async function validateEmployeeReferences(
  companyId: string,
  refs: { groupId?: string | null; gradeId?: string | null }
): Promise<Record<string, string[]> | null> {
  const errors: Record<string, string[]> = {};
  if (refs.groupId) {
    const group = await prisma.employeeGroup.findFirst({
      where: { id: refs.groupId, companyId },
      select: { id: true },
    });
    if (!group) errors.groupId = ["Group not found"];
  }
  if (refs.gradeId) {
    const grade = await prisma.payGrade.findFirst({
      where: { id: refs.gradeId, companyId },
      select: { id: true },
    });
    if (!grade) errors.gradeId = ["Pay grade not found"];
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

async function generateNextEmployeeNumber(companyId: string, prefix: string = "EMP"): Promise<string> {
  const safePrefix = (prefix || "EMP").replace(/[^a-zA-Z0-9_-]/g, "").trim() || "EMP";
  const escaped = safePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}-(\\d+)$`, "i");
  const employees = await prisma.employee.findMany({
    where: { companyId },
    select: { employeeNumber: true },
  });
  let maxNum = 0;
  for (const e of employees) {
    const num = e?.employeeNumber;
    if (num == null || typeof num !== "string") continue;
    const m = num.match(pattern);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  return `${safePrefix}-${String(maxNum + 1).padStart(4, "0")}`;
}

const operationalEmployeeSchema = z.object({
  employeeNumber: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: optionalString.transform((v) => (v && v.trim() ? normalizePhoneForStorage(v) : undefined)),
  status: z
    .enum(["applicant", "hired", "training", "active", "reliever", "suspended", "offboarded"])
    .default("applicant"),
  gradeId: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  employeeType: z.enum(["office", "security"]).default("security"),
  jobRole: optionalString,
  gender: optionalString,
  commencementDate: optionalDate,
  psiraNumber: optionalString,
  psiraExpiryDate: optionalDate,
  trainingCompleted: optionalBool,
});

const operationalCreateSchema = operationalEmployeeSchema.superRefine((data, ctx) => {
  if (data.employeeType === "security" && (!data.psiraNumber || !String(data.psiraNumber).trim())) {
    ctx.addIssue({ code: "custom", path: ["psiraNumber"], message: "PSIRA number is required for security guards" });
  }
  if (data.employeeType === "security" && (!data.gradeId || !String(data.gradeId).trim())) {
    ctx.addIssue({ code: "custom", path: ["gradeId"], message: "Pay grade is required for security guards" });
  }
  if (!data.groupId || !String(data.groupId).trim()) {
    ctx.addIssue({ code: "custom", path: ["groupId"], message: "Group is required for all employees" });
  }
});

const operationalUpdateSchema = operationalEmployeeSchema.partial().extend({
  employeeNumber: z.string().min(1).max(50).optional(),
  phone: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v.trim() === "" ? null : normalizePhoneForStorage(v);
    }),
});

const hrPrivateSchema = z.object({
  idNumber: optionalString,
  dateOfBirth: optionalDate,
  maritalStatus: optionalString,
  email: optionalString,
  physicalAddress: optionalString,
  postalAddress: optionalString,
  postalCode: optionalString,
  occupation: optionalString,
  placeOfWork: optionalString,
  ordinaryHours: optionalString,
  ordinaryDays: optionalString,
  leaveEntitlement: optionalString,
  noticePeriod: optionalString,
  previousService: optionalString,
  securityServiceType: optionalString,
  nextOfKin1Name: optionalString,
  nextOfKin1Phone: optionalString,
  nextOfKin2Name: optionalString,
  nextOfKin2Phone: optionalString,
  nextOfKin3Name: optionalString,
  nextOfKin3Phone: optionalString,
  residedOutsideSA: optionalBool,
  militaryPoliceService: optionalBool,
  criminalInvestigation: optionalBool,
  mentallyUnstable: optionalBool,
});

const compensationSchema = z.object({
  hourlyRate: z.number().positive().optional().nullable(),
  monthlySalary: z.number().positive().optional().nullable(),
  overtimeRate: z.number().positive().optional().nullable(),
  payFrequency: optionalString,
  taxNumber: optionalString,
  taxDirectiveNumber: optionalString,
  taxDirectiveRate: z.number().optional().nullable(),
  bankName: optionalString,
  bankAccountNumber: optionalString,
  bankBranchCode: optionalString,
});

const statusTransitionSchema = z.object({
  status: z.enum(["applicant", "hired", "training", "active", "reliever", "suspended", "offboarded"]),
});

function rejectOperationalBody(body: unknown, reply: { code: (n: number) => { send: (o: unknown) => unknown } }) {
  if (!body || typeof body !== "object") return false;
  const rejected = rejectForbiddenOperationalFields(body as Record<string, unknown>);
  if (rejected) {
    reply.code(400).send({
      error: "Validation error",
      message: `Forbidden fields for operational endpoint: ${rejected.forbidden.join(", ")}`,
    });
    return true;
  }
  return false;
}

export async function employeesRoutes(app: FastifyInstance) {
  const readProtect = [
    ...authProtect,
    requireRole(["admin", "operations_manager", "hr_payroll", "supervisor", "controller"], {
      anyOfModules: ["/employees", "/rostering"],
    }),
    requirePermission(PERMISSIONS.EMPLOYEES_READ_OPERATIONAL),
  ];
  const manageProtect = [
    ...authProtect,
    requireRole(["admin", "operations_manager", "hr_payroll", "supervisor"], { module: "/employees" }),
    requirePermission(PERMISSIONS.EMPLOYEES_MANAGE_OPERATIONAL),
  ];

  app.get("/", { preHandler: readProtect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 20, 100);
    const offset = Number(q.offset) || 0;
    const status = q.status as EmployeeStatus | undefined;
    const employeeType = q.employeeType;
    const groupId = q.groupId;
    const searchQuery = (q.q ?? q.search ?? "").trim();

    const searchOr = searchQuery.length >= 2
      ? {
          OR: [
            { firstName: { contains: searchQuery, mode: "insensitive" as const } },
            { lastName: { contains: searchQuery, mode: "insensitive" as const } },
            { employeeNumber: { contains: searchQuery, mode: "insensitive" as const } },
            { psiraNumber: { contains: searchQuery, mode: "insensitive" as const } },
          ],
        }
      : {};

    const where = {
      companyId: user.companyId,
      ...(status ? { status } : {}),
      ...(employeeType ? { employeeType } : {}),
      ...(groupId ? { groupId } : {}),
      ...searchOr,
    };

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        select: {
          ...employeeOperationalSelect,
          hourlyRate: true,
          monthlySalary: true,
          grade: { select: employeeGradeOperationalSelect },
          group: { select: { id: true, name: true } },
          shifts: {
            where: { startTime: { gte: new Date() }, status: { in: ["assigned", "created"] } },
            select: { site: { select: { name: true } }, legacyPostName: true },
            take: 1,
          },
          siteAssignments: {
            where: { isActive: true },
            select: { site: { select: { id: true, name: true } } },
          },
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.employee.count({ where }),
    ]);

    const data = employees.map((e) => {
      const { hourlyRate, monthlySalary, shifts, siteAssignments, ...rest } = e;
      return enrichOperationalEmployee(
        {
          ...rest,
          currentSite: shifts?.[0]?.site?.name ?? null,
          currentPost: shifts?.[0]?.legacyPostName ?? null,
          assignedSites: siteAssignments?.map((a) => a.site.name) ?? [],
        },
        { hourlyRate, monthlySalary, employeeType: e.employeeType }
      );
    });

    return reply.send({ data, total, limit, offset });
  });

  app.post("/", { preHandler: manageProtect }, async (request, reply) => {
    if (rejectOperationalBody(request.body, reply)) return;
    const parsed = operationalCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    }

    const companyId = request.user!.companyId;
    const d = parsed.data;
    const employeeNumber = d.employeeNumber.trim();
    const existing = await prisma.employee.findFirst({ where: { companyId, employeeNumber } });
    if (existing) {
      return reply.code(400).send({
        error: "Validation error",
        message: { employeeNumber: ["Employee ID already exists."] },
      });
    }

    const refErrors = await validateEmployeeReferences(companyId, { groupId: d.groupId, gradeId: d.gradeId });
    if (refErrors) return reply.code(400).send({ error: "Validation error", message: refErrors });

    const employee = await prisma.employee.create({
      data: { companyId, ...d, employeeNumber, groupId: d.groupId ?? null, gradeId: d.gradeId ?? null },
      select: { ...employeeOperationalSelect, hourlyRate: true, monthlySalary: true },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "employee.create",
      entityType: "employee",
      entityId: employee.id,
    });

    return reply.code(201).send(enrichOperationalEmployee(employee, employee));
  });

  app.get("/next-number", { preHandler: manageProtect }, async (request, reply) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    let prefix = q.prefix?.trim();
    if (!prefix) {
      const company = await prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } });
      const settings = (company?.settings as { employeeIdPrefix?: string } | null) ?? {};
      prefix = settings.employeeIdPrefix ?? "EMP";
    }
    const nextNumber = await generateNextEmployeeNumber(companyId, prefix);
    return reply.send({ employeeNumber: nextNumber });
  });

  app.get("/:id", { preHandler: readProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const employee = await prisma.employee.findFirst({
      where: { id, companyId: request.user!.companyId },
      select: {
        ...employeeOperationalSelect,
        hourlyRate: true,
        monthlySalary: true,
        grade: { select: employeeGradeOperationalSelect },
        group: { select: { id: true, name: true } },
      },
    });
    if (!employee) return reply.code(404).send({ error: "Employee not found" });
    const { hourlyRate, monthlySalary, ...rest } = employee;
    return reply.send(enrichOperationalEmployee(rest, { hourlyRate, monthlySalary, employeeType: employee.employeeType }));
  });

  app.get("/:id/hr-private", {
    preHandler: [...authProtect, requirePermission(PERMISSIONS.EMPLOYEES_READ_PRIVATE)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const employee = await prisma.employee.findFirst({
      where: { id, companyId: request.user!.companyId },
      select: employeeHrPrivateSelect,
    });
    if (!employee) return reply.code(404).send({ error: "Employee not found" });
    await createAuditLog({
      userId: request.user!.sub,
      companyId: request.user!.companyId,
      action: "employee.private.view",
      entityType: "employee",
      entityId: id,
    });
    return reply.send(employee);
  });

  app.patch("/:id/hr-private", {
    preHandler: [...authProtect, requirePermission(PERMISSIONS.EMPLOYEES_MANAGE_PRIVATE)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = hrPrivateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    }
    const companyId = request.user!.companyId;
    const updated = await prisma.employee.updateMany({ where: { id, companyId }, data: parsed.data });
    if (updated.count === 0) return reply.code(404).send({ error: "Employee not found" });
    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "employee.private.update",
      entityType: "employee",
      entityId: id,
    });
    const employee = await prisma.employee.findFirst({
      where: { id, companyId },
      select: employeeHrPrivateSelect,
    });
    return reply.send(employee);
  });

  app.get("/:id/compensation", {
    preHandler: [...authProtect, requirePermission(PERMISSIONS.COMPENSATION_READ)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const employee = await prisma.employee.findFirst({
      where: { id, companyId: request.user!.companyId },
      select: employeeCompensationSelect,
    });
    if (!employee) return reply.code(404).send({ error: "Employee not found" });
    await createAuditLog({
      userId: request.user!.sub,
      companyId: request.user!.companyId,
      action: "employee.compensation.view",
      entityType: "employee",
      entityId: id,
    });
    return reply.send(employee);
  });

  app.patch("/:id/compensation", {
    preHandler: [...authProtect, requirePermission(PERMISSIONS.COMPENSATION_MANAGE)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = compensationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    }
    const companyId = request.user!.companyId;
    const updated = await prisma.employee.updateMany({ where: { id, companyId }, data: parsed.data });
    if (updated.count === 0) return reply.code(404).send({ error: "Employee not found" });
    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "employee.compensation.update",
      entityType: "employee",
      entityId: id,
    });
    const employee = await prisma.employee.findFirst({
      where: { id, companyId },
      select: employeeCompensationSelect,
    });
    return reply.send(employee);
  });

  app.put("/:id", { preHandler: manageProtect }, async (request, reply) => {
    if (rejectOperationalBody(request.body, reply)) return;
    const { id } = request.params as { id: string };
    const parsed = operationalUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    }

    const companyId = request.user!.companyId;
    const existing = await prisma.employee.findFirst({ where: { id, companyId } });
    if (!existing) return reply.code(404).send({ error: "Employee not found" });

    const updateData = { ...parsed.data };
    const effectiveType = updateData.employeeType ?? existing.employeeType;
    const effectivePsira = updateData.psiraNumber !== undefined ? updateData.psiraNumber : existing.psiraNumber;
    if (effectiveType === "security" && (!effectivePsira || !String(effectivePsira).trim())) {
      return reply.code(400).send({
        error: "Validation error",
        message: { psiraNumber: ["PSIRA number is required for security guards"] },
      });
    }
    const effectiveGradeId = updateData.gradeId !== undefined ? updateData.gradeId : existing.gradeId;
    if (effectiveType === "security" && (!effectiveGradeId || !String(effectiveGradeId).trim())) {
      return reply.code(400).send({
        error: "Validation error",
        message: { gradeId: ["Pay grade is required for security guards"] },
      });
    }
    const effectiveGroupId = updateData.groupId !== undefined ? updateData.groupId : existing.groupId;
    if (!effectiveGroupId || !String(effectiveGroupId).trim()) {
      return reply.code(400).send({
        error: "Validation error",
        message: { groupId: ["Group is required for all employees"] },
      });
    }

    if (updateData.employeeNumber !== undefined) {
      const trimmed = updateData.employeeNumber.trim();
      const duplicate = await prisma.employee.findFirst({
        where: { companyId, employeeNumber: trimmed, id: { not: id } },
      });
      if (duplicate) {
        return reply.code(400).send({
          error: "Validation error",
          message: { employeeNumber: ["Employee ID already exists."] },
        });
      }
      updateData.employeeNumber = trimmed;
    }

    const refErrors = await validateEmployeeReferences(companyId, {
      groupId: updateData.groupId,
      gradeId: updateData.gradeId,
    });
    if (refErrors) return reply.code(400).send({ error: "Validation error", message: refErrors });

    await prisma.employee.updateMany({ where: { id, companyId }, data: updateData });
    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "employee.update",
      entityType: "employee",
      entityId: id,
    });

    const employee = await prisma.employee.findFirst({
      where: { id, companyId },
      select: {
        ...employeeOperationalSelect,
        hourlyRate: true,
        monthlySalary: true,
        grade: { select: employeeGradeOperationalSelect },
        group: { select: { id: true, name: true } },
      },
    });
    if (!employee) return reply.code(404).send({ error: "Employee not found" });
    const { hourlyRate, monthlySalary, ...rest } = employee;
    return reply.send(enrichOperationalEmployee(rest, { hourlyRate, monthlySalary, employeeType: employee.employeeType }));
  });

  app.delete("/:id", {
    preHandler: [...authProtect, requirePermission(PERMISSIONS.EMPLOYEES_MANAGE_OPERATIONAL)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const employee = await prisma.employee.findFirst({ where: { id, companyId: user.companyId } });
    if (!employee) return reply.code(404).send({ error: "Employee not found" });
    await prisma.employee.deleteMany({ where: { id, companyId: user.companyId } });
    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "employee.delete",
      entityType: "employee",
      entityId: id,
      metadata: { employeeNumber: employee.employeeNumber, firstName: employee.firstName, lastName: employee.lastName },
    });
    return reply.code(204).send();
  });

  app.post("/:id/status", { preHandler: manageProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = statusTransitionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation error", message: parsed.error.flatten().fieldErrors });
    }
    const companyId = request.user!.companyId;
    const result = await transitionEmployeeStatus(id, companyId, parsed.data.status);
    if (!result.success) {
      return reply.code(400).send({ error: "Invalid transition", message: result.error });
    }
    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "employee.status_transition",
      entityType: "employee",
      entityId: id,
      metadata: { newStatus: parsed.data.status },
    });
    const employee = await prisma.employee.findFirst({
      where: { id, companyId },
      select: {
        ...employeeOperationalSelect,
        hourlyRate: true,
        monthlySalary: true,
        grade: { select: employeeGradeOperationalSelect },
        group: { select: { id: true, name: true } },
      },
    });
    if (!employee) return reply.code(404).send({ error: "Employee not found" });
    const { hourlyRate, monthlySalary, ...rest } = employee;
    return reply.send(enrichOperationalEmployee(rest, { hourlyRate, monthlySalary, employeeType: employee.employeeType }));
  });
}
