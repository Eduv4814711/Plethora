import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";

const SA_LEAVE_TYPES = ["annual", "sick", "family_responsibility", "maternity", "parental", "unpaid"] as const;

const createLeaveRecordSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string(),
  type: z.enum(SA_LEAVE_TYPES),
  hours: z.number().min(0).max(24).default(8),
});

export async function leaveRecordsRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "operations_manager", "hr_payroll"])];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const employeeId = q.employeeId;
    const start = q.start ? new Date(q.start) : undefined;
    const end = q.end ? new Date(q.end) : undefined;

    const where: Record<string, unknown> = {
      employee: { companyId: user.companyId },
    };
    if (employeeId) where.employeeId = employeeId;
    if (start && end) where.date = { gte: start, lte: end };
    else if (start) where.date = { gte: start };
    else if (end) where.date = { lte: end };

    const records = await prisma.leaveRecord.findMany({
      where,
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeNumber: true },
        },
      },
      orderBy: { date: "asc" },
    });

    return reply.send({ data: records });
  });

  app.post("/", { preHandler: protect }, async (request, reply) => {
    const parsed = createLeaveRecordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;
    const employee = await prisma.employee.findFirst({
      where: { id: parsed.data.employeeId, companyId },
    });
    if (!employee) {
      return reply.code(404).send({ error: "Employee not found" });
    }

    const date = new Date(parsed.data.date);
    date.setHours(0, 0, 0, 0);

    const record = await prisma.leaveRecord.create({
      data: {
        employeeId: parsed.data.employeeId,
        date,
        type: parsed.data.type,
        hours: parsed.data.hours,
      },
    });

    await createAuditLog({
      userId: request.user!.sub,
      companyId,
      action: "leave_record.create",
      entityType: "leave_record",
      entityId: record.id,
      metadata: { employeeId: parsed.data.employeeId },
    });

    return reply.code(201).send(record);
  });
}
