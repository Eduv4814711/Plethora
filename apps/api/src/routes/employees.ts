import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EmployeeStatus } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireAnyCapability, requireCapability, requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import { reconcileContinuityForEmployee } from "../modules/rosters/roster-continuity.service.js";
import { transitionEmployeeStatus } from "../services/employee.service.js";
import { createAuditLog } from "../lib/audit.js";
import {
  employeeListSelect,
  employeeDetailSelect,
  employeePayrollSelect,
  sanitizeEmployeeForList,
  sanitizeEmployeeForDetail,
  canEditEmployeeDetails,
  canViewEmployeeSensitiveFields,
  canWriteEmployeeSensitiveFields,
} from "../lib/employee-dto.js";
import { EMPLOYEE_RESTRICTED_FIELDS, hasRestrictedFields } from "../lib/sensitive-data.js";
import { hasCapability } from "../lib/capabilities.js";

function rejectEmployeeDetailEdits(request: { user?: import("../lib/types.js").AuthenticatedUser }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (request.user && canEditEmployeeDetails(request.user)) return false;
  reply.code(403).send({ error: "Forbidden", message: "Team or Payroll module access is required to edit employee details" });
  return true;
}

function rejectEmployeeCreation(request: { user?: import("../lib/types.js").AuthenticatedUser }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (
    request.user &&
    (hasCapability(request.user, "/employees", "create") ||
      hasCapability(request.user, "/payroll", "create"))
  ) {
    return false;
  }
  reply.code(403).send({ error: "Forbidden", message: "Team or Payroll create access is required to add employees" });
  return true;
}

function rejectRestrictedEmployeeFields(
  request: { user?: import("../lib/types.js").AuthenticatedUser; body: unknown },
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  action: "create" | "edit"
) {
  if (
    canWriteEmployeeSensitiveFields(request.user!, action) ||
    !hasRestrictedFields(request.body, EMPLOYEE_RESTRICTED_FIELDS)
  ) {
    return false;
  }
  reply.code(403).send({
    error: "Forbidden",
    message: `Team or Payroll ${action} access is required for sensitive employee data`,
  });
  return true;
}

const optionalString = z.string().optional();
const optionalNumber = z.number().optional();

/**
 * Normalize phone for storage so WhatsApp can match it.
 * WhatsApp sends IDs like "27821234567". We store in the same format for reliable matching.
 */
function normalizePhoneForStorage(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("27") && digits.length === 11) return digits;
  if (digits.startsWith("0") && digits.length === 10) return "27" + digits.slice(1);
  return digits;
}

/** Reject dates with year outside 1900-2100 to avoid Prisma/database errors (e.g. year 202500) */
function sanitizeDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getFullYear();
  if (y < 1900 || y > 2100) return undefined;
  return d;
}

const optionalDate = z.string().optional().transform(sanitizeDate);
const optionalBool = z.boolean().optional();

/**
 * Verify referenced group/grade IDs belong to the caller's company.
 * FKs alone don't enforce tenant boundaries, so cross-company IDs must be rejected.
 */
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

/** Generate next unique employee number for a company (e.g. EMP-0001, STAFF-0001) */
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

const createEmployeeSchema = z.object({
  employeeNumber: z.string().min(1).max(50),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  idNumber: optionalString,
  phone: optionalString.transform((v) => (v && v.trim() ? normalizePhoneForStorage(v) : undefined)),
  status: z
    .enum(["applicant", "hired", "training", "active", "reliever", "suspended", "offboarded"])
    .default("applicant"),
  hourlyRate: z.number().positive().optional(),
  monthlySalary: z.number().positive().optional(),
  gradeId: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  employeeType: z.enum(["general", "security_officer"]).default("security_officer"),
  jobRole: optionalString,
  // Labour Law (BCEA)
  dateOfBirth: optionalDate,
  gender: optionalString,
  maritalStatus: optionalString,
  email: optionalString,
  physicalAddress: optionalString,
  postalAddress: optionalString,
  postalCode: optionalString,
  taxNumber: optionalString,
  bankName: optionalString,
  bankAccountNumber: optionalString,
  bankBranchCode: optionalString,
  commencementDate: optionalDate,
  occupation: optionalString,
  placeOfWork: optionalString,
  ordinaryHours: optionalString,
  ordinaryDays: optionalString,
  overtimeRate: optionalNumber,
  payFrequency: z
    .enum(["weekly", "bi-weekly", "biweekly", "monthly"])
    .transform((value) => value === "bi-weekly" ? "biweekly" : value)
    .optional(),
  leaveEntitlement: optionalString,
  noticePeriod: optionalString,
  previousService: optionalString,
  // PSIRA
  psiraRegistrationNumber: optionalString,
  psiraRegistrationExpiry: optionalDate,
  psiraGrade: optionalString,
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
  trainingCompleted: optionalBool,
});

const createEmployeeSchemaWithRefine = createEmployeeSchema.superRefine((data, ctx) => {
  if (data.employeeType === "security_officer" && (!data.psiraRegistrationNumber || !String(data.psiraRegistrationNumber).trim())) {
    ctx.addIssue({ code: "custom", path: ["psiraRegistrationNumber"], message: "PSIRA number is required for security guards" });
  }
  if (data.employeeType === "security_officer" && (!data.gradeId || !String(data.gradeId).trim())) {
    ctx.addIssue({ code: "custom", path: ["gradeId"], message: "Pay grade is required for security guards" });
  }
  if (!data.groupId || !String(data.groupId).trim()) {
    ctx.addIssue({ code: "custom", path: ["groupId"], message: "Group is required for all employees" });
  }
  if (data.employeeType === "general" && (!data.monthlySalary || data.monthlySalary <= 0)) {
    ctx.addIssue({ code: "custom", path: ["monthlySalary"], message: "Monthly salary is required for office staff" });
  }
});

const updateEmployeeSchema = createEmployeeSchema.omit({ status: true }).partial().extend({
  employeeNumber: z.string().min(1).max(50).optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  // Create defaults must not leak into partial updates. Without this override,
  // an omitted employeeType is parsed as "security_officer" and an existing general
  // employee incorrectly fails PSIRA/pay-grade validation.
  employeeType: z.enum(["general", "security_officer"]).optional(),
  hourlyRate: z.number().positive().optional().nullable(),
  monthlySalary: z.number().positive().optional().nullable(),
  gradeId: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  phone: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v.trim() === "" ? null : normalizePhoneForStorage(v);
    }),
});

const statusTransitionSchema = z.object({
  status: z.enum(["applicant", "hired", "training", "active", "reliever", "suspended", "offboarded"]),
});

export async function employeesRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({
      anyOfModules: ["/employees", "/payroll"],
    }),
  ];
  const readProtect = [
    authMiddleware,
    requireCrudCapability({
      // Attendance controllers need the sanitized employee list for the
      // "different guard" and reliever pickers in site timesheets.
      anyOfModules: ["/employees", "/payroll", "/rostering", "/attendance"],
    }),
  ];
  const editProtect = [
    authMiddleware,
    requireAnyCapability(["/employees", "/payroll"], "edit"),
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

    const where = {
      companyId: user.companyId,
      ...(status ? { status } : {}),
      ...(employeeType ? { employeeType } : {}),
      ...(groupId ? { groupId } : {}),
      ...(searchQuery.length >= 2
        ? {
            OR: [
              { firstName: { contains: searchQuery, mode: "insensitive" as const } },
              { lastName: { contains: searchQuery, mode: "insensitive" as const } },
              { employeeNumber: { contains: searchQuery, mode: "insensitive" as const } },
              ...(canViewEmployeeSensitiveFields(user)
                ? [{ idNumber: { contains: searchQuery, mode: "insensitive" as const } }]
                : []),
            ],
          }
        : {}),
    };

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        select: {
          ...employeeListSelect,
          grade: { select: { name: true, hourlyRate: true } },
          group: { select: { id: true, name: true } },
          shifts: {
            where: {
              startTime: { gte: new Date() },
              status: { in: ["assigned", "created"] },
            },
            select: {
              site: { select: { name: true } },
              shiftType: true,
              legacyPostName: true,
            },
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
      const row = {
        ...e,
        currentSite: e.shifts?.[0]?.site?.name ?? null,
        currentPost: e.shifts?.[0]?.legacyPostName ?? null,
        assignedSites: e.siteAssignments?.map((a) => a.site.name) ?? [],
        shifts: undefined,
        siteAssignments: undefined,
      };
      return sanitizeEmployeeForList(row, user);
    });

    return reply.send({ data, total, limit, offset });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    if (rejectEmployeeCreation(request, reply)) return;
    if (rejectRestrictedEmployeeFields(request, reply, "create")) return;
    const parsed = createEmployeeSchemaWithRefine.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;

    const d = parsed.data;
    const employeeNumber = d.employeeNumber.trim();
    const existing = await prisma.employee.findFirst({
      where: { companyId, employeeNumber },
    });
    if (existing) {
      return reply.code(400).send({
        error: "Validation error",
        message: { employeeNumber: ["Employee ID already exists. Each employee must have a unique employee ID."] },
      });
    }

    const refErrors = await validateEmployeeReferences(companyId, {
      groupId: d.groupId,
      gradeId: d.gradeId,
    });
    if (refErrors) {
      return reply.code(400).send({ error: "Validation error", message: refErrors });
    }

    const employee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber,
        firstName: d.firstName,
        lastName: d.lastName,
        idNumber: d.idNumber,
        phone: d.phone,
        status: d.status,
        hourlyRate: d.hourlyRate,
        monthlySalary: d.monthlySalary,
        gradeId: d.gradeId ?? null,
        groupId: d.groupId ?? null,
        employeeType: d.employeeType ?? "security_officer",
        jobRole: d.jobRole,
        dateOfBirth: d.dateOfBirth,
        gender: d.gender,
        maritalStatus: d.maritalStatus,
        email: d.email,
        physicalAddress: d.physicalAddress,
        postalAddress: d.postalAddress,
        postalCode: d.postalCode,
        taxNumber: d.taxNumber,
        bankName: d.bankName,
        bankAccountNumber: d.bankAccountNumber,
        bankBranchCode: d.bankBranchCode,
        commencementDate: d.commencementDate,
        occupation: d.occupation,
        placeOfWork: d.placeOfWork,
        ordinaryHours: d.ordinaryHours,
        ordinaryDays: d.ordinaryDays,
        overtimeRate: d.overtimeRate,
        payFrequency: d.payFrequency,
        leaveEntitlement: d.leaveEntitlement,
        noticePeriod: d.noticePeriod,
        previousService: d.previousService,
        psiraRegistrationNumber: d.psiraRegistrationNumber,
        psiraRegistrationExpiry: d.psiraRegistrationExpiry,
        psiraGrade: d.psiraGrade,
        securityServiceType: d.securityServiceType,
        nextOfKin1Name: d.nextOfKin1Name,
        nextOfKin1Phone: d.nextOfKin1Phone,
        nextOfKin2Name: d.nextOfKin2Name,
        nextOfKin2Phone: d.nextOfKin2Phone,
        nextOfKin3Name: d.nextOfKin3Name,
        nextOfKin3Phone: d.nextOfKin3Phone,
        residedOutsideSA: d.residedOutsideSA,
        militaryPoliceService: d.militaryPoliceService,
        criminalInvestigation: d.criminalInvestigation,
        mentallyUnstable: d.mentallyUnstable,
        trainingCompleted: d.trainingCompleted,
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "employee.create",
      entityType: "employee",
      entityId: employee.id,
    });

    return reply.code(201).send(sanitizeEmployeeForDetail(employee, request.user!));
  });

  app.get("/next-number", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const companyId = user.companyId;
    const q = request.query as Record<string, string | undefined>;
    let prefix = q.prefix?.trim();

    if (!prefix) {
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { settings: true },
      });
      const settings = (company?.settings as { employeeIdPrefix?: string } | null) ?? {};
      prefix = settings.employeeIdPrefix ?? "EMP";
    }

    const nextNumber = await generateNextEmployeeNumber(companyId, prefix);
    return reply.send({ employeeNumber: nextNumber });
  });

  app.get("/:id", { preHandler: readProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const select = canViewEmployeeSensitiveFields(user)
      ? employeePayrollSelect
      : employeeDetailSelect;

    const employee = await prisma.employee.findFirst({
      where: { id, companyId: user.companyId },
      select: {
        ...select,
        grade: { select: { name: true, hourlyRate: true } },
        group: { select: { id: true, name: true } },
      },
    });

    if (!employee) {
      return reply.code(404).send({ error: "Employee not found" });
    }

    return reply.send(sanitizeEmployeeForDetail(employee, user));
  });

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
    if (rejectEmployeeDetailEdits(request, reply)) return;
    if (rejectRestrictedEmployeeFields(request, reply, "edit")) return;
    if (
      typeof request.body === "object" &&
      request.body !== null &&
      Object.prototype.hasOwnProperty.call(request.body, "status")
    ) {
      return reply.code(400).send({
        error: "Validation error",
        message: { status: ["Use the employee status transition endpoint"] },
      });
    }
    const { id } = request.params as { id: string };
    const parsed = updateEmployeeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const existing = await prisma.employee.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      return reply.code(404).send({ error: "Employee not found" });
    }

    const updateData = { ...parsed.data };
    const effectiveType = updateData.employeeType ?? existing.employeeType;
    const effectivePsira = updateData.psiraRegistrationNumber !== undefined ? updateData.psiraRegistrationNumber : existing.psiraRegistrationNumber;
    if (effectiveType === "security_officer" && (!effectivePsira || !String(effectivePsira).trim())) {
      return reply.code(400).send({
        error: "Validation error",
        message: { psiraRegistrationNumber: ["PSIRA number is required for security guards"] },
      });
    }
    const effectiveGradeId = updateData.gradeId !== undefined ? updateData.gradeId : existing.gradeId;
    if (effectiveType === "security_officer" && (!effectiveGradeId || !String(effectiveGradeId).trim())) {
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
    const effectiveMonthlySalary =
      updateData.monthlySalary !== undefined
        ? updateData.monthlySalary
        : existing.monthlySalary != null
          ? Number(existing.monthlySalary)
          : null;
    if (
      effectiveType === "general" &&
      (effectiveMonthlySalary == null || effectiveMonthlySalary <= 0)
    ) {
      return reply.code(400).send({
        error: "Validation error",
        message: { monthlySalary: ["Monthly salary is required for office staff"] },
      });
    }

    if (updateData.employeeNumber !== undefined) {
      const trimmed = updateData.employeeNumber.trim();
      if (!trimmed) {
        return reply.code(400).send({
          error: "Validation error",
          message: { employeeNumber: ["Employee ID is required and must be unique."] },
        });
      }
      const duplicate = await prisma.employee.findFirst({
        where: { companyId, employeeNumber: trimmed, id: { not: id } },
      });
      if (duplicate) {
        return reply.code(400).send({
          error: "Validation error",
          message: { employeeNumber: ["Employee ID already exists. Each employee must have a unique employee ID."] },
        });
      }
      updateData.employeeNumber = trimmed;
    }

    const refErrors = await validateEmployeeReferences(companyId, {
      groupId: updateData.groupId,
      gradeId: updateData.gradeId,
    });
    if (refErrors) {
      return reply.code(400).send({ error: "Validation error", message: refErrors });
    }

    const updated = await prisma.employee.updateMany({
      where: { id, companyId },
      data: updateData,
    });

    if (parsed.data.employeeType !== undefined) {
      void reconcileContinuityForEmployee(id, companyId, "employee_type_changed").catch(() => undefined);
    }
    if (updated.count === 0) {
      return reply.code(404).send({ error: "Employee not found" });
    }

    const hasSensitive =
      updateData.idNumber !== undefined ||
      updateData.taxNumber !== undefined ||
      updateData.bankAccountNumber !== undefined ||
      updateData.bankName !== undefined ||
      updateData.bankBranchCode !== undefined;

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: hasSensitive ? "employee.update_sensitive" : "employee.update",
      entityType: "employee",
      entityId: id,
    });

    request.log.info(
      { employeeId: id, companyId, requestId: request.requestId, sensitive: hasSensitive },
      "employee updated"
    );

    const employee = await prisma.employee.findFirst({
      where: { id, companyId },
      select: {
        ...(canViewEmployeeSensitiveFields(request.user!)
          ? employeePayrollSelect
          : employeeDetailSelect),
        grade: { select: { name: true, hourlyRate: true } },
        group: { select: { id: true, name: true } },
      },
    });

    return reply.send(sanitizeEmployeeForDetail(employee ?? {}, request.user!));
  });

  app.delete("/:id", { preHandler: [authMiddleware, requireCapability("/employees", "delete")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const employee = await prisma.employee.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!employee) {
      return reply.code(404).send({ error: "Employee not found" });
    }

    const [payrollItems, shifts, leaveApplications] = await Promise.all([
      prisma.payrollItem.count({ where: { employeeId: id } }),
      prisma.shift.count({ where: { employeeId: id } }),
      prisma.leaveRequest.count({ where: { employeeId: id, companyId: user.companyId } }),
    ]);

    if (employee.status !== "offboarded") {
      const archived = await transitionEmployeeStatus(id, user.companyId, "offboarded");
      if (!archived.success) {
        return reply.code(409).send({
          error: "Employee could not be offboarded",
          message: archived.error,
        });
      }
      void reconcileContinuityForEmployee(id, user.companyId, "employee_offboarded").catch(() => undefined);
    }

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "employee.archive",
      entityType: "employee",
      entityId: id,
      metadata: {
        employeeNumber: employee.employeeNumber,
        firstName: employee.firstName,
        lastName: employee.lastName,
        preservedDependencies: { payrollItems, shifts, leaveApplications },
      },
    });

    return reply.send({
      success: true,
      archived: true,
      status: "offboarded",
      preservedDependencies: { payrollItems, shifts, leaveApplications },
    });
  });

  app.post("/:id/status", { preHandler: editProtect }, async (request, reply) => {
    if (rejectEmployeeDetailEdits(request, reply)) return;
    const { id } = request.params as { id: string };
    const parsed = statusTransitionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const result = await transitionEmployeeStatus(id, companyId, parsed.data.status);

    if (!result.success) {
      return reply.code(400).send({
        error: "Invalid transition",
        message: result.error,
      });
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
        ...(canViewEmployeeSensitiveFields(request.user!)
          ? employeePayrollSelect
          : employeeDetailSelect),
        grade: { select: { name: true, hourlyRate: true } },
        group: { select: { id: true, name: true } },
      },
    });

    if (!employee) {
      return reply.code(404).send({ error: "Employee not found" });
    }

    return reply.send(sanitizeEmployeeForDetail(employee, request.user!));
  });
}
