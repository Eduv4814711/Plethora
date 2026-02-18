import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { aggregateTimesheets } from "../services/timesheet.service.js";
import { createAuditLog } from "../lib/audit.js";

const updateTimesheetSchema = z.object({
  basicHours: z.number().min(0).optional(),
  overtimeHours: z.number().min(0).optional(),
  sundayHours: z.number().min(0).optional(),
  publicHolidayHours: z.number().min(0).optional(),
  leaveDays: z.number().min(0).optional(),
});

export async function timesheetsRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "operations_manager", "hr_payroll"])];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const periodStart = q.periodStart ?? q.startDate;
    const periodEnd = q.periodEnd ?? q.endDate;
    const employeeId = q.employeeId;

    if (!periodStart || !periodEnd) {
      return reply.code(400).send({
        error: "Validation error",
        message: "periodStart and periodEnd (or startDate and endDate) are required",
      });
    }

    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    const where: Record<string, unknown> = {
      companyId: user.companyId,
      periodStart: start,
      periodEnd: end,
    };
    if (employeeId) where.employeeId = employeeId;

    const timesheets = await prisma.timesheet.findMany({
      where,
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeNumber: true },
        },
      },
      orderBy: { employee: { lastName: "asc" } },
    });

    return reply.send({ data: timesheets });
  });

  app.get("/preview", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const periodStart = q.periodStart ?? q.startDate;
    const periodEnd = q.periodEnd ?? q.endDate;

    if (!periodStart || !periodEnd) {
      return reply.code(400).send({
        error: "Validation error",
        message: "periodStart and periodEnd are required",
      });
    }

    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    const aggregates = await aggregateTimesheets(user.companyId, start, end);

    const employees = await prisma.employee.findMany({
      where: { companyId: user.companyId, id: { in: aggregates.map((a) => a.employeeId) } },
      select: { id: true, firstName: true, lastName: true, employeeNumber: true },
    });
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const data = aggregates.map((a) => ({
      ...a,
      employee: empMap.get(a.employeeId),
    }));

    return reply.send({ data });
  });

  app.put("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateTimesheetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const timesheet = await prisma.timesheet.findFirst({
      where: { id, companyId },
      include: { payrollRun: true },
    });

    if (!timesheet) {
      return reply.code(404).send({ error: "Timesheet not found" });
    }

    if (timesheet.payrollRunId && timesheet.payrollRun) {
      if (timesheet.payrollRun.status !== "draft") {
        return reply.code(400).send({
          error: "Cannot edit",
          message: "Timesheet is linked to a payroll run that is not in draft status",
        });
      }
    }

    const updated = await prisma.timesheet.update({
      where: { id },
      data: {
        ...parsed.data,
        source: "manual",
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "timesheet.update",
      entityType: "timesheet",
      entityId: id,
    });

    return reply.send(updated);
  });
}
