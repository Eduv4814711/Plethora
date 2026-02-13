import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import {
  calculatePayroll,
  canTransitionPayrollStatus,
} from "../services/payroll.service.js";
import { PayrollServiceError } from "../services/payroll.service.js";
import { createAuditLog } from "../lib/audit.js";

const createPayrollRunSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});

export async function payrollRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "operations_manager", "hr_payroll"])];

  app.get("/runs", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const limit = Math.min(Number(request.query.limit) || 20, 100);
    const offset = Number(request.query.offset) || 0;

    const [runs, total] = await Promise.all([
      prisma.payrollRun.findMany({
        where: { companyId: user.companyId },
        orderBy: { periodStart: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.payrollRun.count({ where: { companyId: user.companyId } }),
    ]);

    return reply.send({ data: runs, total, limit, offset });
  });

  app.post("/runs", { preHandler: protect }, async (request, reply) => {
    const parsed = createPayrollRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const periodStart = new Date(parsed.data.periodStart);
    const periodEnd = new Date(parsed.data.periodEnd);

    if (periodStart >= periodEnd) {
      return reply.code(400).send({
        error: "Validation error",
        message: "periodEnd must be after periodStart",
      });
    }

    const run = await prisma.payrollRun.create({
      data: {
        companyId,
        periodStart,
        periodEnd,
        status: "draft",
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "payroll_run.create",
      entityType: "payroll_run",
      entityId: run.id,
    });

    return reply.code(201).send(run);
  });

  app.get("/runs/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    return reply.send(run);
  });

  app.get("/runs/:id/items", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    const items = await prisma.payrollItem.findMany({
      where: { payrollRunId: id },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { employee: { lastName: "asc" } },
    });

    return reply.send({ data: items });
  });

  app.post("/runs/:id/calculate", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = request.user!.companyId;

    try {
      await calculatePayroll(id, companyId);
    } catch (err) {
      if (err instanceof PayrollServiceError) {
        return reply.code(400).send({
          error: "Calculation failed",
          message: err.message,
        });
      }
      throw err;
    }

    const run = await prisma.payrollRun.findUnique({
      where: { id },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "payroll_run.calculate",
      entityType: "payroll_run",
      entityId: id,
    });

    return reply.send(run);
  });

  app.post("/runs/:id/approve", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    if (!canTransitionPayrollStatus(run.status, "approved")) {
      return reply.code(400).send({
        error: "Invalid transition",
        message: `Cannot approve payroll in status ${run.status}. Must be calculated first.`,
      });
    }

    const updated = await prisma.payrollRun.update({
      where: { id },
      data: { status: "approved" },
    });

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "payroll_run.approve",
      entityType: "payroll_run",
      entityId: id,
    });

    return reply.send(updated);
  });

  app.post("/runs/:id/mark-paid", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const run = await prisma.payrollRun.findFirst({
      where: { id, companyId: user.companyId },
    });

    if (!run) {
      return reply.code(404).send({ error: "Payroll run not found" });
    }

    if (!canTransitionPayrollStatus(run.status, "paid")) {
      return reply.code(400).send({
        error: "Invalid transition",
        message: `Cannot mark as paid. Payroll must be approved first. Current status: ${run.status}`,
      });
    }

    const updated = await prisma.payrollRun.update({
      where: { id },
      data: { status: "paid" },
    });

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "payroll_run.mark_paid",
      entityType: "payroll_run",
      entityId: id,
    });

    return reply.send(updated);
  });
}
