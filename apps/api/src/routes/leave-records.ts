import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import {
  createLeaveRecordsForRange,
  deleteLeaveRecordsForRange,
  LeaveAvailabilityError,
  replaceLeaveRecordRange,
} from "../services/leave-availability.service.js";

const SA_LEAVE_TYPES = ["annual", "sick", "family_responsibility", "maternity", "parental", "unpaid"] as const;

const createLeaveRecordSchema = z.object({
  employeeId: z.string().min(1),
  /** Start date (inclusive). For a single day, omit endDate or set it equal to date. */
  date: z.string(),
  /** End date (inclusive). When set, one leave record is created per calendar day in the range. */
  endDate: z.string().optional(),
  type: z.enum(SA_LEAVE_TYPES),
  hours: z.number().min(0).max(24).default(8),
});

const leaveRangeSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(SA_LEAVE_TYPES),
  startDate: z.string(),
  endDate: z.string(),
});

const updateLeaveRangeSchema = leaveRangeSchema.extend({
  newStartDate: z.string(),
  newEndDate: z.string().optional(),
  newType: z.enum(SA_LEAVE_TYPES),
  hours: z.number().min(0).max(24).default(8),
});

export async function leaveRecordsRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireRole(["admin", "operations_manager", "hr_payroll"], {
      anyOfModules: ["/employees", "/payroll"],
    }),
  ];

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

    try {
      const { records, days } = await createLeaveRecordsForRange({
        employeeId: parsed.data.employeeId,
        startDate: parsed.data.date,
        endDate: parsed.data.endDate,
        type: parsed.data.type,
        hours: parsed.data.hours,
      });

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "leave_record.create",
        entityType: "leave_record",
        entityId: records[0]?.id ?? "",
        metadata: {
          employeeId: parsed.data.employeeId,
          days,
          startDate: parsed.data.date,
          endDate: parsed.data.endDate ?? parsed.data.date,
        },
      });

      if (records.length === 1) {
        return reply.code(201).send(records[0]);
      }
      return reply.code(201).send({ data: records, days });
    } catch (err) {
      if (err instanceof LeaveAvailabilityError) {
        return reply.code(400).send({ error: "Validation error", message: err.message });
      }
      throw err;
    }
  });

  app.put("/range", { preHandler: protect }, async (request, reply) => {
    const parsed = updateLeaveRangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;

    try {
      const { records, days } = await replaceLeaveRecordRange({
        companyId,
        employeeId: parsed.data.employeeId,
        type: parsed.data.type,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        newStartDate: parsed.data.newStartDate,
        newEndDate: parsed.data.newEndDate,
        newType: parsed.data.newType,
        hours: parsed.data.hours,
      });

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "leave_record.update",
        entityType: "leave_record",
        entityId: records[0]?.id ?? "",
        metadata: {
          employeeId: parsed.data.employeeId,
          days,
          previous: {
            startDate: parsed.data.startDate,
            endDate: parsed.data.endDate,
            type: parsed.data.type,
          },
          updated: {
            startDate: parsed.data.newStartDate,
            endDate: parsed.data.newEndDate ?? parsed.data.newStartDate,
            type: parsed.data.newType,
          },
        },
      });

      return reply.send({ data: records, days });
    } catch (err) {
      if (err instanceof LeaveAvailabilityError) {
        return reply.code(400).send({ error: "Validation error", message: err.message });
      }
      throw err;
    }
  });

  app.delete("/range", { preHandler: protect }, async (request, reply) => {
    const parsed = leaveRangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const companyId = request.user!.companyId;

    try {
      const deleted = await deleteLeaveRecordsForRange({
        companyId,
        employeeId: parsed.data.employeeId,
        type: parsed.data.type,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
      });

      if (deleted === 0) {
        return reply.code(404).send({ error: "Leave record not found" });
      }

      await createAuditLog({
        userId: request.user!.sub,
        companyId,
        action: "leave_record.delete",
        entityType: "leave_record",
        entityId: parsed.data.employeeId,
        metadata: {
          employeeId: parsed.data.employeeId,
          days: deleted,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          type: parsed.data.type,
        },
      });

      return reply.send({ deleted });
    } catch (err) {
      if (err instanceof LeaveAvailabilityError) {
        return reply.code(400).send({ error: "Validation error", message: err.message });
      }
      throw err;
    }
  });
}
