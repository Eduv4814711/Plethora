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
import { createAuditLog } from "../lib/audit.js";

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

    const siteId = q.siteId;
    const shiftWhere: Record<string, unknown> = { companyId: user.companyId };
    if (employeeId) shiftWhere.employeeId = employeeId;
    if (siteId) shiftWhere.post = { siteId };
    // Overlap: shift overlaps [startDate, endDate] when startTime < endDate AND endTime > startDate
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      shiftWhere.startTime = { lt: end };
      shiftWhere.endTime = { gt: start };
    } else if (startDate) {
      shiftWhere.endTime = { gt: new Date(startDate) };
    } else if (endDate) {
      shiftWhere.startTime = { lt: new Date(endDate) };
    }

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

  app.get("/missed", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const employeeId = q.employeeId;
    const siteId = q.siteId;
    const limit = Math.min(Number(q.limit) || 50, 100);
    const offset = Number(q.offset) || 0;

    const now = new Date();
    const where: Record<string, unknown> = {
      companyId: user.companyId,
      status: { in: ["assigned", "created"] },
      endTime: { lt: now },
      attendances: { none: { clockIn: { not: null } } },
    };
    if (employeeId) where.employeeId = employeeId;
    if (siteId) where.post = { siteId };

    const [missedShifts, total] = await Promise.all([
      prisma.shift.findMany({
        where,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          post: { include: { site: true } },
        },
        take: limit,
        skip: offset,
        orderBy: { endTime: "desc" },
      }),
      prisma.shift.count({ where }),
    ]);

    return reply.send({ data: missedShifts, total, limit, offset });
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
      const { shift } = await validateClockIn(parsed.data.shiftId, request.user!.companyId);
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

      await createAuditLog({
        userId: request.user!.sub,
        companyId: request.user!.companyId,
        action: "attendance.clock_in",
        entityType: "attendance",
        entityId: attendance.id,
        metadata: { shiftId: parsed.data.shiftId },
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
      now,
      attendance.shift.startTime,
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

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "attendance.clock_out",
      entityType: "attendance",
      entityId: parsed.data.attendanceId,
      metadata: { shiftId: attendance.shiftId, hoursWorked, overtimeHours },
    });

    return reply.send(updated);
  });

  app.post("/clock-out-by-shift", { preHandler: protect }, async (request, reply) => {
    const schema = z.object({ shiftId: z.string().min(1) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: "shiftId is required",
      });
    }

    const user = request.user!;

    const attendance = await prisma.attendance.findFirst({
      where: {
        shiftId: parsed.data.shiftId,
        shift: { companyId: user.companyId },
        clockIn: { not: null },
        clockOut: null,
        status: "clocked_in",
      },
      include: { shift: true },
    });

    if (!attendance) {
      return reply.code(404).send({
        error: "No active attendance",
        message: "No clocked-in attendance found for this shift",
      });
    }

    const now = new Date();
    const { hoursWorked, overtimeHours } = calculateHours(
      now,
      attendance.shift.startTime,
      attendance.shift.endTime
    );

    const updated = await prisma.attendance.update({
      where: { id: attendance.id },
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

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "attendance.clock_out",
      entityType: "attendance",
      entityId: attendance.id,
      metadata: { shiftId: parsed.data.shiftId, hoursWorked, overtimeHours },
    });

    return reply.send(updated);
  });

  app.get("/:id", { preHandler: protect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const attendance = await prisma.attendance.findFirst({
      where: {
        id,
        shift: { companyId: user.companyId },
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

    if (!attendance) {
      return reply.code(404).send({ error: "Attendance record not found" });
    }

    return reply.send(attendance);
  });

  const updateAttendanceProtect = [authMiddleware, requireRole(["admin", "hr_payroll"])];

  app.put("/:id", { preHandler: updateAttendanceProtect }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({
      clockIn: z.string().datetime().optional(),
      clockOut: z.string().datetime().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;

    const attendance = await prisma.attendance.findFirst({
      where: {
        id,
        shift: { companyId: user.companyId },
      },
      include: { shift: true },
    });

    if (!attendance) {
      return reply.code(404).send({ error: "Attendance record not found" });
    }

    if (attendance.shift.status === "verified") {
      return reply.code(400).send({
        error: "Cannot edit",
        message: "Attendance for verified shifts cannot be modified",
      });
    }

    const timesheet = await prisma.timesheet.findFirst({
      where: {
        employeeId: attendance.shift.employeeId,
        payrollRunId: { not: null },
        periodStart: { lte: attendance.shift.endTime },
        periodEnd: { gte: attendance.shift.startTime },
      },
      include: { payrollRun: true },
    });

    if (timesheet?.payrollRun && timesheet.payrollRun.status !== "draft") {
      return reply.code(400).send({
        error: "Cannot edit",
        message: "Attendance is linked to a payroll run that is not in draft",
      });
    }

    const updateData: { clockIn?: Date; clockOut?: Date; hoursWorked?: number; overtimeHours?: number; status?: string } = {};
    let newClockIn = attendance.clockIn ? new Date(attendance.clockIn) : null;
    let newClockOut = attendance.clockOut ? new Date(attendance.clockOut) : null;

    if (parsed.data.clockIn) {
      newClockIn = new Date(parsed.data.clockIn);
      updateData.clockIn = newClockIn;
    }
    if (parsed.data.clockOut) {
      newClockOut = new Date(parsed.data.clockOut);
      updateData.clockOut = newClockOut;
    }

    if (newClockIn && newClockOut && newClockOut <= newClockIn) {
      return reply.code(400).send({
        error: "Validation error",
        message: "clockOut must be after clockIn",
      });
    }

    if (newClockIn && newClockOut) {
      const { hoursWorked, overtimeHours } = calculateHours(
        newClockOut,
        attendance.shift.startTime,
        attendance.shift.endTime
      );
      updateData.hoursWorked = hoursWorked;
      updateData.overtimeHours = overtimeHours;
      updateData.status = "completed";
    }

    const updated = await prisma.attendance.update({
      where: { id },
      data: updateData,
      include: {
        shift: {
          include: {
            employee: { select: { id: true, firstName: true, lastName: true } },
            post: { include: { site: true } },
          },
        },
      },
    });

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "attendance.update",
      entityType: "attendance",
      entityId: id,
      metadata: { clockIn: parsed.data.clockIn, clockOut: parsed.data.clockOut },
    });

    return reply.send(updated);
  });
}
