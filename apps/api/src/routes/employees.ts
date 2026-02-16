import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EmployeeStatus } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { transitionEmployeeStatus } from "../services/employee.service.js";
import { createAuditLog } from "../lib/audit.js";

const optionalString = z.string().optional();
const optionalNumber = z.number().optional();

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

/** Generate next unique employee number for a company (e.g. EMP-0001, EMP-0002) */
async function generateNextEmployeeNumber(companyId: string): Promise<string> {
  const employees = await prisma.employee.findMany({
    where: { companyId },
    select: { employeeNumber: true },
  });
  let maxNum = 0;
  for (const e of employees) {
    const m = e.employeeNumber.match(/^EMP-(\d+)$/i);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  return `EMP-${String(maxNum + 1).padStart(4, "0")}`;
}

const createEmployeeSchema = z.object({
  employeeNumber: z.string().min(1).max(50).optional(), // Optional: auto-generated if not provided
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  idNumber: optionalString,
  phone: optionalString,
  status: z.enum(["applicant", "hired", "training", "active", "suspended", "offboarded"]).default("applicant"),
  hourlyRate: z.number().positive().optional(),
  monthlySalary: z.number().positive().optional(),
  employeeType: z.enum(["office", "security"]).default("security"),
  // Labour Law (BCEA)
  dateOfBirth: optionalDate,
  gender: optionalString,
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
  payFrequency: optionalString,
  leaveEntitlement: optionalString,
  noticePeriod: optionalString,
  previousService: optionalString,
  // PSIRA
  psiraNumber: optionalString,
  psiraExpiryDate: optionalDate,
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

const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  employeeNumber: z.string().min(1).max(50).optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  status: z.enum(["applicant", "hired", "training", "active", "suspended", "offboarded"]).optional(),
  hourlyRate: z.number().positive().optional().nullable(),
  monthlySalary: z.number().positive().optional().nullable(),
});

const statusTransitionSchema = z.object({
  status: z.enum(["applicant", "hired", "training", "active", "suspended", "offboarded"]),
});

export async function employeesRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "operations_manager", "hr_payroll", "supervisor"])];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const limit = Math.min(Number(q.limit) || 20, 100);
    const offset = Number(q.offset) || 0;
    const status = q.status as EmployeeStatus | undefined;
    const employeeType = q.employeeType;

    const where = {
      companyId: user.companyId,
      ...(status ? { status } : {}),
      ...(employeeType ? { employeeType } : {}),
    };

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        include: {
          shifts: {
            where: {
              startTime: { gte: new Date() },
              status: { in: ["assigned", "created"] },
            },
            include: { post: { include: { site: true } } },
            take: 1,
          },
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.employee.count({ where }),
    ]);

    const data = employees.map((e: (typeof employees)[number]) => {
      const emp = e as typeof e & { shifts?: Array<{ post?: { site?: { name?: string }; name?: string } }> };
      return {
        ...e,
        currentSite: emp.shifts?.[0]?.post?.site?.name ?? null,
        currentPost: emp.shifts?.[0]?.post?.name ?? null,
        shifts: undefined,
      };
    });

    return reply.send({ data, total, limit, offset });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createEmployeeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;

    const d = parsed.data;
    let employeeNumber: string;
    if (d.employeeNumber?.trim()) {
      const existing = await prisma.employee.findFirst({
        where: { companyId, employeeNumber: d.employeeNumber.trim() },
      });
      if (existing) {
        return reply.code(400).send({
          error: "Validation error",
          message: { employeeNumber: ["Employee ID already exists. Each employee must have a unique employee ID."] },
        });
      }
      employeeNumber = d.employeeNumber.trim();
    } else {
      employeeNumber = await generateNextEmployeeNumber(companyId);
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
        employeeType: d.employeeType ?? "security",
        dateOfBirth: d.dateOfBirth,
        gender: d.gender,
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
        psiraNumber: d.psiraNumber,
        psiraExpiryDate: d.psiraExpiryDate,
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

    return reply.code(201).send(employee);
  });

  app.get("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const employee = await prisma.employee.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!employee) {
      return reply.code(404).send({ error: "Employee not found" });
    }

    return reply.send(employee);
  });

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
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

    const employee = await prisma.employee.update({
      where: { id },
      data: updateData,
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "employee.update",
      entityType: "employee",
      entityId: id,
    });

    return reply.send(employee);
  });

  app.post("/:id/status", { preHandler: protect }, async (request, reply) => {
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

    const employee = await prisma.employee.findUnique({
      where: { id },
    });

    return reply.send(employee);
  });
}
