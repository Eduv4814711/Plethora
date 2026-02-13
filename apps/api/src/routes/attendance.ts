import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { prisma } from "../lib/prisma.js";
import {
  validateClockIn,
  calculateHours,
} from "../services/attendance.service.js";
import { AttendanceValidationError } from "../services/attendance.service.js";

const clockInSchema = z.object({
  shiftId: z.string().min(1),
});

export async function attendanceRoutes(app: FastifyInstance) {
  const protect = [authMiddleware, requireRole(["admin", "operations_manager", "hr_payroll", "supervisor"])];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const shiftId = q.shiftId;
    const employeeId = q.employeeId;
    const startDate = q.startDate;
    const endDate = q.endDate;
    const limit = Math.min(Number(q.limit) || 50, 100);
    const offset = Number(q.offset) || 0;

    const shiftWhere: Record<string, unknown> = { companyId: user.companyId };
    if (employeeId) shiftWhere.employeeId = employeeId;
    if (startDate) shiftWhere.startTime = { gte: new Date(startDate) };
    if (endDate) shiftWhere.endTime = { lte: new Date(endDate) };

    const where: Record<string, unknown> = { shift: shiftWhere };
    if (shiftId) where.shiftId = shiftId;

    const [attendances, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        include: {
          shift: {
            include: {
              employee: { select: { id: true, firstName: true, lastName: true } },
              post: { include: { site: true } },
            },
          },
        },
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.attendance.count({ where }),
    ]);

    return reply.send({ data: attendances, total, limit, offset });
  });

  app.post("/clock-in", { preHandler: protect }, async (request, reply) => {
    const parsed = clockInSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const { shift } = await validateClockIn(parsed.data.shiftId);
      const now = new Date();

      const attendance = await prisma.attendance.create({
        data: {
          shiftId: parsed.data.shiftId,
          clockIn: now,
          status: "clocked_in",
        },
        include: {
          shift: {
            include: {
              employee: { select: { id: true, firstName: true, lastName: true } },
              post: { include: { site: true } },
            },
          },
        },
      });

      await prisma.shift.update({
        where: { id: parsed.data.shiftId },
        data: { status: "active" },
      });

      return reply.code(201).send(attendance);
    } catch (err) {
      if (err instanceof AttendanceValidationError) {
        return reply.code(400).send({
          error: "Clock-in validation failed",
          message: err.message,
        });
      }
      throw err;
    }
  });

  app.post("/clock-out", { preHandler: protect }, async (request, reply) => {
    const schema = z.object({ attendanceId: z.string().min(1) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: "attendanceId is required",
      });
    }

    const user = request.user!;

    const attendance = await prisma.attendance.findFirst({
      where: {
        id: parsed.data.attendanceId,
        shift: { companyId: user.companyId },
      },
      include: { shift: true },
    });

    if (!attendance) {
      return reply.code(404).send({ error: "Attendance record not found" });
    }

    if (!attendance.clockIn) {
      return reply.code(400).send({
        error: "Invalid state",
        message: "Cannot clock out without clock in",
      });
    }

    if (attendance.clockOut) {
      return reply.code(400).send({
        error: "Already clocked out",
        message: "Attendance already has clock out time",
      });
    }

    const now = new Date();
    const { hoursWorked, overtimeHours } = calculateHours(
      attendance.clockIn,
      now,
      attendance.shift.endTime
    );

    const updated = await prisma.attendance.update({
      where: { id: parsed.data.attendanceId },
      data: {
        clockOut: now,
        hoursWorked,
        overtimeHours,
        status: "completed",
      },
      include: {
        shift: {
          include: {
            employee: { select: { id: true, firstName: true, lastName: true } },
            post: { include: { site: true } },
          },
        },
      },
    });

    await prisma.shift.update({
      where: { id: attendance.shiftId },
      data: { status: "completed" },
    });

    return reply.send(updated);
  });
}
