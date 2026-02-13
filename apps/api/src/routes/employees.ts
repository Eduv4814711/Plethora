import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { transitionEmployeeStatus } from "../services/employee.service.js";
import { createAuditLog } from "../lib/audit.js";

const optionalString = z.string().optional();
const optionalNumber = z.number().optional();
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? new Date(v) : undefined));
const optionalBool = z.boolean().optional();

const createEmployeeSchema = z.object({
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
    const limit = Math.min(Number(request.query.limit) || 20, 100);
    const offset = Number(request.query.offset) || 0;
    const status = request.query.status as string | undefined;
    const employeeType = request.query.employeeType as string | undefined;

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

    const data = employees.map((e) => ({
      ...e,
      currentSite: e.shifts[0]?.post?.site?.name ?? null,
      currentPost: e.shifts[0]?.post?.name ?? null,
      shifts: undefined,
    }));

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
    const employee = await prisma.employee.create({
      data: {
        companyId,
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

    const employee = await prisma.employee.update({
      where: { id },
      data: parsed.data,
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
