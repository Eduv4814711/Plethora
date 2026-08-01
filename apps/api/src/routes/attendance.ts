import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import {
  validateClockIn,
  calculateHours,
  assertWithinSiteGeofence,
  findApprovedLeaveConflict,
} from "../services/attendance.service.js";
import { AttendanceValidationError } from "../services/attendance.service.js";
import { createAuditLog } from "../lib/audit.js";
import { triggerPostClockExceptionSync } from "../modules/attendance-exceptions/post-clock-sync.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../lib/timezone.js";
import { normalizeLeaveDate } from "../services/leave-availability.service.js";
const optionalCoords = z
  .object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .refine(
    (d) =>
      (d.latitude === undefined && d.longitude === undefined) ||
      (d.latitude !== undefined && d.longitude !== undefined),
    { message: "latitude and longitude must both be provided together" }
  );

const clockInSchema = z
  .object({
    shiftId: z.string().min(1),
  })
  .and(optionalCoords);

const manualAttendanceSchema = z.object({
  employeeId: z.string().min(1),
  postId: z.string().min(1),
  clockIn: z.string().datetime(),
  clockOut: z.string().datetime(),
});

export async function attendanceRoutes(app: FastifyInstance) {
  const protect = [
    authMiddleware,
    requireCrudCapability({ module: "/attendance" }),
  ];

  app.get("/", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const shiftId = q.shiftId;
    const employeeId = q.employeeId;
    const startDate = q.startDate;
    const endDate = q.endDate;
    const source = q.source;
    const limit = Math.min(Number(q.limit) || 50, source === "manual" ? 500 : 100);
    const offset = Number(q.offset) || 0;

    const siteId = q.siteId;
    const shiftWhere: Record<string, unknown> = { companyId: user.companyId };
    if (employeeId) shiftWhere.employeeId = employeeId;
    if (siteId) shiftWhere.siteId = siteId;
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
    if (source === "manual") where.source = "manual";

    const [attendances, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        include: {
          shift: {
            include: {
              employee: { select: { id: true, firstName: true, lastName: true } },
              site: true,
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
    const startDate = q.startDate;
    const endDate = q.endDate;
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
    if (siteId) where.siteId = siteId;
    if (startDate && endDate) {
      const endBound = new Date(endDate);
      where.startTime = { gte: new Date(startDate) };
      where.endTime = { lt: endBound < now ? endBound : now };
    } else if (startDate) {
      where.startTime = { gte: new Date(startDate) };
    } else if (endDate) {
      const endBound = new Date(endDate);
      where.endTime = { lt: endBound < now ? endBound : now };
    }

    const [missedShifts, total] = await Promise.all([
      prisma.shift.findMany({
        where,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          site: true,
        },
        take: limit,
        skip: offset,
        orderBy: { endTime: "desc" },
      }),
      prisma.shift.count({ where }),
    ]);

    return reply.send({ data: missedShifts, total, limit, offset });
  });

  const recordMissedShiftSchema = z.object({
    clockIn: z.string().datetime().optional(),
    clockOut: z.string().datetime().optional(),
  });

  app.post("/missed/:shiftId/record", { preHandler: protect }, async (request, reply) => {
    const { shiftId } = request.params as { shiftId: string };
    const parsed = recordMissedShiftSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const companyId = user.companyId;

    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, companyId },
    });

    if (!shift) {
      return reply.code(404).send({ error: "Shift not found" });
    }

    if (shift.status !== "assigned" && shift.status !== "created") {
      return reply.code(400).send({
        error: "Invalid shift",
        message: "Only assigned or created shifts can be recorded as missed.",
      });
    }

    const existingAttendance = await prisma.attendance.findFirst({
      where: { shiftId, clockIn: { not: null } },
    });

    if (existingAttendance) {
      return reply.code(400).send({
        error: "Already recorded",
        message: "This shift already has attendance recorded.",
      });
    }
    const shiftDate = normalizeLeaveDate(dateKeyInTimeZone(shift.startTime, await getCompanyTimezone(companyId)));
    const leaveConflict = await findApprovedLeaveConflict(companyId, shift.employeeId, shiftDate);
    if (leaveConflict) {
      const applicationId = leaveConflict.requestId;
      return reply.code(409).send({
        error: "Approved leave conflict",
        code: "APPROVED_LEAVE_CONFLICT",
        message: "Record an early return, amend, or cancel the approved leave before recording attendance.",
        action: applicationId ? { type: "REVIEW_APPROVED_LEAVE", applicationId, href: `/employees/leave?approved=${applicationId}` } : undefined,
      });
    }

    const clockIn = parsed.data.clockIn
      ? new Date(parsed.data.clockIn)
      : new Date(shift.startTime);
    const clockOut = parsed.data.clockOut
      ? new Date(parsed.data.clockOut)
      : new Date(shift.endTime);

    if (clockOut <= clockIn) {
      return reply.code(400).send({
        error: "Validation error",
        message: "clockOut must be after clockIn",
      });
    }

    const { hoursWorked, overtimeHours } = calculateHours(
      clockIn,
      clockOut,
      shift.startTime,
      shift.endTime
    );

    const attendance = await prisma.$transaction(async (tx) => {
      const created = await tx.attendance.create({ data: { shiftId, clockIn, clockOut, hoursWorked, overtimeHours, status: "completed", source: "manual" }, include: { shift: { include: { employee: { select: { id: true, firstName: true, lastName: true } }, site: true } } } });
      await tx.shift.update({ where: { id: shiftId }, data: { status: "completed" } });
      return created;
    });

    await createAuditLog({
      userId: user.sub,
      companyId,
      action: "attendance.manual",
      entityType: "attendance",
      entityId: attendance.id,
      metadata: { shiftId, source: "missed_shift_record" },
    });

    return reply.code(201).send(attendance);
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
      await validateClockIn(parsed.data.shiftId, request.user!.companyId);
      const now = new Date();

      const shiftWithSite = await prisma.shift.findFirst({
        where: { id: parsed.data.shiftId, companyId: request.user!.companyId },
        include: { site: true },
      });
      const site = shiftWithSite?.site;
      const lat = parsed.data.latitude;
      const lng = parsed.data.longitude;
      if (site && lat !== undefined && lng !== undefined) {
        assertWithinSiteGeofence(site, lat, lng);
      }

      const attendance = await prisma.$transaction(async (tx) => {
        const created = await tx.attendance.create({
          data: {
            shiftId: parsed.data.shiftId,
            clockIn: now,
            status: "clocked_in",
            clockInLat: lat !== undefined ? lat : undefined,
            clockInLng: lng !== undefined ? lng : undefined,
          },
          include: { shift: { include: { employee: { select: { id: true, firstName: true, lastName: true } }, site: true } } },
        });
        await tx.shift.update({ where: { id: parsed.data.shiftId }, data: { status: "active" } });
        return created;
      });

      await createAuditLog({
        userId: request.user!.sub,
        companyId: request.user!.companyId,
        action: "attendance.clock_in",
        entityType: "attendance",
        entityId: attendance.id,
        metadata: { shiftId: parsed.data.shiftId },
      });

      triggerPostClockExceptionSync(request.user!.companyId, shiftWithSite?.siteId);

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
    const schema = z
      .object({ attendanceId: z.string().min(1) })
      .and(optionalCoords);
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
      include: { shift: { include: { site: true } } },
    });

    if (!attendance) {
      return reply.code(404).send({ error: "Attendance record not found" });
    }

    const outLat = parsed.data.latitude;
    const outLng = parsed.data.longitude;
    const outSite = attendance.shift.site;
    if (outSite && outLat !== undefined && outLng !== undefined) {
      try {
        assertWithinSiteGeofence(outSite, outLat, outLng);
      } catch (err) {
        if (err instanceof AttendanceValidationError) {
          return reply.code(400).send({
            error: "Clock-out validation failed",
            message: err.message,
          });
        }
        throw err;
      }
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
        clockOutLat: outLat !== undefined ? outLat : undefined,
        clockOutLng: outLng !== undefined ? outLng : undefined,
      },
      include: {
        shift: {
          include: {
            employee: { select: { id: true, firstName: true, lastName: true } },
            site: true,
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

    triggerPostClockExceptionSync(user.companyId, attendance.shift.siteId);

    return reply.send(updated);
  });

  app.post("/clock-out-by-shift", { preHandler: protect }, async (request, reply) => {
    const schema = z.object({ shiftId: z.string().min(1) }).and(optionalCoords);
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
      include: { shift: { include: { site: true } } },
    });

    if (!attendance) {
      return reply.code(404).send({
        error: "No active attendance",
        message: "No clocked-in attendance found for this shift",
      });
    }

    const byShiftLat = parsed.data.latitude;
    const byShiftLng = parsed.data.longitude;
    const byShiftSite = attendance.shift.site;
    if (byShiftSite && byShiftLat !== undefined && byShiftLng !== undefined) {
      try {
        assertWithinSiteGeofence(byShiftSite, byShiftLat, byShiftLng);
      } catch (err) {
        if (err instanceof AttendanceValidationError) {
          return reply.code(400).send({
            error: "Clock-out validation failed",
            message: err.message,
          });
        }
        throw err;
      }
    }

    if (!attendance.clockIn) {
      return reply.code(400).send({
        error: "Invalid state",
        message: "Cannot clock out without clock in",
      });
    }

    const now = new Date();
    const { hoursWorked, overtimeHours } = calculateHours(
      attendance.clockIn,
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
        clockOutLat: byShiftLat !== undefined ? byShiftLat : undefined,
        clockOutLng: byShiftLng !== undefined ? byShiftLng : undefined,
      },
      include: {
        shift: {
          include: {
            employee: { select: { id: true, firstName: true, lastName: true } },
            site: true,
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

  app.post("/manual", { preHandler: protect }, async (request, reply) => {
    const parsed = manualAttendanceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const companyId = user.companyId;
    const { employeeId, postId, clockIn: clockInStr, clockOut: clockOutStr } = parsed.data;

    const clockIn = new Date(clockInStr);
    const clockOut = new Date(clockOutStr);

    if (clockOut <= clockIn) {
      return reply.code(400).send({
        error: "Validation error",
        message: "clockOut must be after clockIn",
      });
    }

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
    });
    if (!employee) {
      return reply.code(404).send({ error: "Employee not found" });
    }

    const post = await prisma.sitePost.findFirst({
      where: { id: postId, site: { companyId } },
      include: { site: true, coverageRequirements: { where: { isEnabled: true } } },
    });
    if (!post) {
      return reply.code(400).send({
        error: "Validation error",
        message: "Invalid site or post. Select a valid site and post.",
      });
    }
    const leaveDate = normalizeLeaveDate(dateKeyInTimeZone(clockIn, await getCompanyTimezone(companyId)));
    const leaveConflict = await findApprovedLeaveConflict(companyId, employeeId, leaveDate);
    if (leaveConflict) {
      const applicationId = leaveConflict.requestId;
      return reply.code(409).send({
        error: "Approved leave conflict",
        code: "APPROVED_LEAVE_CONFLICT",
        message: "Record an early return, amend, or cancel the approved leave before creating manual attendance.",
        action: applicationId ? { type: "REVIEW_APPROVED_LEAVE", applicationId, href: `/employees/leave?approved=${applicationId}` } : undefined,
      });
    }

    const { hoursWorked, overtimeHours } = calculateHours(clockIn, clockOut, clockIn, clockOut);

    const { shift, attendance } = await prisma.$transaction(async (tx) => {
      const shift = await tx.shift.create({ data: { companyId, employeeId, siteId: post.siteId, shiftType: post.coverageRequirements[0]?.shiftTypeCode ?? "day", legacyPostName: post.name, startTime: clockIn, endTime: clockOut, status: "completed" } });
      const attendance = await tx.attendance.create({ data: { shiftId: shift.id, clockIn, clockOut, hoursWorked, overtimeHours, status: "completed", source: "manual" }, include: { shift: { include: { employee: { select: { id: true, firstName: true, lastName: true } }, site: true } } } });
      return { shift, attendance };
    });

    await createAuditLog({
      userId: user.sub,
      companyId,
      action: "attendance.manual",
      entityType: "attendance",
      entityId: attendance.id,
      metadata: { shiftId: shift.id, employeeId, source: "manual" },
    });

    return reply.code(201).send(attendance);
  });

  // Timesheet image import removed - will be re-added later

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
            site: true,
          },
        },
      },
    });

    if (!attendance) {
      return reply.code(404).send({ error: "Attendance record not found" });
    }

    return reply.send(attendance);
  });

  const updateAttendanceProtect = [
    authMiddleware,
    requireCrudCapability({ module: "/attendance" }),
  ];

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
        companyId: user.companyId,
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
        newClockIn,
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
            site: true,
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
