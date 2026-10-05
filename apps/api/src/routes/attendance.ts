import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { requireCrudCapability } from "../middleware/authorization.js";
import { prisma } from "../lib/prisma.js";
import {
  validateClockIn,
  calculateHours,
  calculateManualEntryHours,
  assertWithinSiteGeofence,
  findApprovedLeaveConflict,
} from "../services/attendance.service.js";
import { AttendanceValidationError } from "../services/attendance.service.js";
import { createAuditLog } from "../lib/audit.js";
import { triggerPostClockExceptionSync } from "../modules/attendance-exceptions/post-clock-sync.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../lib/timezone.js";
import { normalizeLeaveDate } from "../services/leave-availability.service.js";
import { getTodayAttendance } from "../modules/attendance-today/attendance-today.service.js";
import { syncAttendanceToTimesheetRow } from "../modules/attendance-today/attendance-timesheet-sync.js";
import { recordAttendanceEvent, attendanceSnapshot } from "../modules/attendance-today/attendance-events.js";
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

  // ==========================================
  // Controller Daily Workspace Endpoints
  // ==========================================

  app.get("/today", { preHandler: protect }, async (request, reply) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;
    const date = q.date;
    const shiftType = (q.shiftType as "day" | "night" | "all") || "all";
    const siteId = q.siteId;
    const searchQuery = q.q || q.search;

    const result = await getTodayAttendance(user.companyId, {
      date,
      shiftType,
      siteId,
      searchQuery,
    });

    return reply.send(result);
  });

  const quickClockInSchema = z.object({
    shiftId: z.string().min(1),
    timestamp: z.string().datetime().optional(),
    reason: z.string().min(3).optional(),
  }).and(optionalCoords);

  app.post("/quick-clock-in", { preHandler: protect }, async (request, reply) => {
    const parsed = quickClockInSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const companyId = user.companyId;
    const { shiftId, timestamp, reason, latitude, longitude } = parsed.data;

    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, companyId },
      include: {
        site: true,
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!shift) {
      return reply.code(404).send({ error: "Shift not found" });
    }

    const clockInTime = timestamp ? new Date(timestamp) : new Date();

    // Check geofence if coordinates are provided
    if (shift.site && latitude !== undefined && longitude !== undefined) {
      try {
        assertWithinSiteGeofence(shift.site, latitude, longitude);
      } catch (err) {
        if (err instanceof AttendanceValidationError) {
          return reply.code(400).send({
            error: "Clock-in validation failed",
            message: err.message,
          });
        }
        throw err;
      }
    }

    // Leave conflict check
    const shiftDate = normalizeLeaveDate(dateKeyInTimeZone(shift.startTime, await getCompanyTimezone(companyId)));
    const leaveConflict = await findApprovedLeaveConflict(companyId, shift.employeeId, shiftDate);
    if (leaveConflict) {
      return reply.code(409).send({
        error: "Approved leave conflict",
        code: "APPROVED_LEAVE_CONFLICT",
        message: "Guard has approved leave on this date.",
      });
    }

    // Check existing attendance
    const existing = await prisma.attendance.findFirst({
      where: { shiftId },
    });

    if (existing && existing.clockIn) {
      return reply.code(409).send({
        error: "Already clocked in",
        message: "This guard has already clocked in for this shift.",
      });
    }

    const beforeSnapshot = attendanceSnapshot(existing);

    const attendance = await prisma.$transaction(async (tx) => {
      let rec;
      if (existing) {
        rec = await tx.attendance.update({
          where: { id: existing.id },
          data: {
            clockIn: clockInTime,
            clockInLat: latitude,
            clockInLng: longitude,
            status: "clocked_in",
            source: "manual",
          },
        });
      } else {
        rec = await tx.attendance.create({
          data: {
            shiftId,
            clockIn: clockInTime,
            clockInLat: latitude,
            clockInLng: longitude,
            status: "clocked_in",
            source: "manual",
          },
        });
      }

      await tx.shift.update({
        where: { id: shiftId },
        data: { status: "active" },
      });

      return rec;
    });

    // Record audit event
    await recordAttendanceEvent({
      companyId,
      attendanceId: attendance.id,
      shiftId: shift.id,
      employeeId: shift.employeeId,
      siteId: shift.siteId,
      eventType: "CLOCK_IN",
      source: "manual",
      occurredAt: clockInTime,
      actorUserId: user.sub,
      reason: reason || "Controller quick clock-in",
      before: beforeSnapshot,
      after: attendanceSnapshot(attendance),
    });

    await createAuditLog({
      userId: user.sub,
      companyId,
      action: "attendance.quick_clock_in",
      entityType: "attendance",
      entityId: attendance.id,
      metadata: { shiftId, reason: reason || "Controller quick clock-in" },
    });

    // Sync to site timesheet row if exists
    await syncAttendanceToTimesheetRow(shift, attendance).catch((err) => {
      request.log.warn({ err, shiftId }, "Failed to sync attendance to site timesheet row");
    });

    triggerPostClockExceptionSync(companyId, shift.siteId);

    return reply.code(200).send(attendance);
  });

  const quickClockOutSchema = z.object({
    shiftId: z.string().min(1),
    timestamp: z.string().datetime().optional(),
    reason: z.string().min(3).optional(),
  }).and(optionalCoords);

  app.post("/quick-clock-out", { preHandler: protect }, async (request, reply) => {
    const parsed = quickClockOutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const companyId = user.companyId;
    const { shiftId, timestamp, reason, latitude, longitude } = parsed.data;

    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, companyId },
      include: {
        site: true,
        attendances: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!shift) {
      return reply.code(404).send({ error: "Shift not found" });
    }

    const attendance = shift.attendances[0];
    if (!attendance || !attendance.clockIn) {
      return reply.code(400).send({
        error: "Invalid state",
        message: "Guard has not clocked in yet. Cannot clock out.",
      });
    }

    if (attendance.clockOut) {
      return reply.code(409).send({
        error: "Already clocked out",
        message: "Guard has already clocked out for this shift.",
      });
    }

    const clockOutTime = timestamp ? new Date(timestamp) : new Date();

    if (clockOutTime <= attendance.clockIn) {
      return reply.code(400).send({
        error: "Validation error",
        message: "Clock-out time must be after clock-in time.",
      });
    }

    if (shift.site && latitude !== undefined && longitude !== undefined) {
      try {
        assertWithinSiteGeofence(shift.site, latitude, longitude);
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

    const { hoursWorked, overtimeHours } = calculateHours(
      attendance.clockIn,
      clockOutTime,
      shift.startTime,
      shift.endTime
    );

    const beforeSnapshot = attendanceSnapshot(attendance);

    const updated = await prisma.$transaction(async (tx) => {
      const rec = await tx.attendance.update({
        where: { id: attendance.id },
        data: {
          clockOut: clockOutTime,
          clockOutLat: latitude,
          clockOutLng: longitude,
          hoursWorked,
          overtimeHours,
          status: "completed",
        },
      });

      await tx.shift.update({
        where: { id: shiftId },
        data: { status: "completed" },
      });

      return rec;
    });

    // Record audit event
    await recordAttendanceEvent({
      companyId,
      attendanceId: updated.id,
      shiftId: shift.id,
      employeeId: shift.employeeId,
      siteId: shift.siteId,
      eventType: "CLOCK_OUT",
      source: "manual",
      occurredAt: clockOutTime,
      actorUserId: user.sub,
      reason: reason || "Controller quick clock-out",
      before: beforeSnapshot,
      after: attendanceSnapshot(updated),
    });

    await createAuditLog({
      userId: user.sub,
      companyId,
      action: "attendance.quick_clock_out",
      entityType: "attendance",
      entityId: updated.id,
      metadata: { shiftId, hoursWorked, overtimeHours, reason: reason || "Controller quick clock-out" },
    });

    // Sync to site timesheet row if exists
    await syncAttendanceToTimesheetRow(shift, updated).catch((err) => {
      request.log.warn({ err, shiftId }, "Failed to sync attendance to site timesheet row");
    });

    triggerPostClockExceptionSync(companyId, shift.siteId);

    return reply.code(200).send(updated);
  });

  const markAbsentSchema = z.object({
    shiftId: z.string().min(1),
    reason: z.string().min(3, "A reason of at least 3 characters is required to mark absent"),
  });

  app.post("/mark-absent", { preHandler: protect }, async (request, reply) => {
    const parsed = markAbsentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const companyId = user.companyId;
    const { shiftId, reason } = parsed.data;

    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, companyId },
      include: {
        attendances: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!shift) {
      return reply.code(404).send({ error: "Shift not found" });
    }

    const existingAttendance = shift.attendances[0];
    if (existingAttendance && existingAttendance.clockIn) {
      return reply.code(400).send({
        error: "Cannot mark absent",
        message: "Guard has already clocked in for this shift. Mark absent is not allowed.",
      });
    }

    const beforeSnapshot = attendanceSnapshot(existingAttendance);

    const result = await prisma.$transaction(async (tx) => {
      let attRec;
      if (existingAttendance) {
        attRec = await tx.attendance.update({
          where: { id: existingAttendance.id },
          data: {
            status: "absent",
            hoursWorked: 0,
            overtimeHours: 0,
            source: "manual",
          },
        });
      } else {
        attRec = await tx.attendance.create({
          data: {
            shiftId,
            status: "absent",
            hoursWorked: 0,
            overtimeHours: 0,
            source: "manual",
          },
        });
      }

      // ShiftStatus enum values: created | assigned | active | completed | verified
      // Attendance status is set to "absent" and 0 hours. We mark the shift completed.
      await tx.shift.update({
        where: { id: shiftId },
        data: { status: "completed" },
      });

      return attRec;
    });

    await recordAttendanceEvent({
      companyId,
      attendanceId: result.id,
      shiftId: shift.id,
      employeeId: shift.employeeId,
      siteId: shift.siteId,
      eventType: "MARK_ABSENT",
      source: "manual",
      occurredAt: new Date(),
      actorUserId: user.sub,
      reason,
      before: beforeSnapshot,
      after: attendanceSnapshot(result),
    });

    await createAuditLog({
      userId: user.sub,
      companyId,
      action: "attendance.mark_absent",
      entityType: "attendance",
      entityId: result.id,
      metadata: { shiftId, reason },
    });

    // Sync absent status to SiteTimesheetRow if exists
    const timeZone = await getCompanyTimezone(shift.companyId);
    const workDate = new Date(`${dateKeyInTimeZone(shift.startTime, timeZone)}T00:00:00.000Z`);
    const row = await prisma.siteTimesheetRow.findFirst({
      where: {
        OR: [
          { sourceShiftId: shift.id },
          { siteId: shift.siteId, workDate, plannedGuardId: shift.employeeId },
        ],
      },
      include: { siteTimesheet: { select: { status: true } } },
    });

    if (row && row.approvalStatus !== "approved" && row.siteTimesheet?.status !== "locked") {
      await prisma.siteTimesheetRow.update({
        where: { id: row.id },
        data: {
          attendanceStatus: "absent",
          hoursWorked: 0,
          overtimeHours: 0,
          sourceAttendanceId: result.id,
          sourceShiftId: shift.id,
        },
      });
    }

    return reply.code(200).send(result);
  });

  const replaceGuardSchema = z.object({
    shiftId: z.string().min(1),
    replacementEmployeeId: z.string().min(1),
    reason: z.string().min(3, "A reason of at least 3 characters is required to assign a replacement guard"),
  });

  app.post("/replace-guard", { preHandler: protect }, async (request, reply) => {
    const parsed = replaceGuardSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation error",
        message: parsed.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const companyId = user.companyId;
    const { shiftId, replacementEmployeeId, reason } = parsed.data;

    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, companyId },
      include: {
        site: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        attendances: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!shift) {
      return reply.code(404).send({ error: "Shift not found" });
    }

    if (shift.status === "verified") {
      return reply.code(400).send({
        error: "Cannot replace guard",
        message: "This shift has already been verified for payroll and cannot be reassigned.",
      });
    }

    const replacementEmployee = await prisma.employee.findFirst({
      where: { id: replacementEmployeeId, companyId },
      select: { id: true, firstName: true, lastName: true, employeeNumber: true, status: true },
    });

    if (!replacementEmployee) {
      return reply.code(404).send({
        error: "Replacement guard not found",
        message: "Selected replacement guard does not exist.",
      });
    }

    if (replacementEmployee.id === shift.employeeId) {
      return reply.code(400).send({
        error: "Invalid replacement",
        message: "Replacement guard is already the scheduled guard for this shift.",
      });
    }

    // Leave conflict check for replacement guard
    const shiftDate = normalizeLeaveDate(dateKeyInTimeZone(shift.startTime, await getCompanyTimezone(companyId)));
    const leaveConflict = await findApprovedLeaveConflict(companyId, replacementEmployeeId, shiftDate);
    if (leaveConflict) {
      return reply.code(409).send({
        error: "Approved leave conflict",
        code: "APPROVED_LEAVE_CONFLICT",
        message: `Replacement guard ${replacementEmployee.firstName} ${replacementEmployee.lastName} has approved leave on this date.`,
      });
    }

    // Check if replacement is already scheduled on an overlapping active shift
    const overlappingShift = await prisma.shift.findFirst({
      where: {
        companyId,
        employeeId: replacementEmployeeId,
        id: { not: shiftId },
        startTime: { lt: shift.endTime },
        endTime: { gt: shift.startTime },
        status: { in: ["assigned", "active"] },
      },
      include: { site: { select: { name: true } } },
    });

    if (overlappingShift) {
      return reply.code(409).send({
        error: "Double booking warning",
        message: `Guard ${replacementEmployee.firstName} ${replacementEmployee.lastName} is already rostered at ${overlappingShift.site?.name || "another site"} during this time window.`,
      });
    }

    const originalGuardName = shift.employee
      ? `${shift.employee.firstName} ${shift.employee.lastName}`.trim()
      : "Unknown";

    const replacementGuardName = `${replacementEmployee.firstName} ${replacementEmployee.lastName}`.trim();

    // Update shift to assign the replacement guard
    const updatedShift = await prisma.shift.update({
      where: { id: shiftId },
      data: {
        employeeId: replacementEmployeeId,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, phone: true } },
        site: true,
      },
    });

    // Record immutable audit event
    await recordAttendanceEvent({
      companyId,
      shiftId: shift.id,
      employeeId: replacementEmployeeId,
      siteId: shift.siteId,
      eventType: "REPLACE_GUARD",
      source: "manual",
      occurredAt: new Date(),
      actorUserId: user.sub,
      reason,
      metadata: {
        originalGuardId: shift.employeeId,
        originalGuardName,
        replacementGuardId: replacementEmployeeId,
        replacementGuardName,
        reason,
      },
    });

    await createAuditLog({
      userId: user.sub,
      companyId,
      action: "attendance.replace_guard",
      entityType: "shift",
      entityId: shift.id,
      metadata: {
        originalGuardId: shift.employeeId,
        originalGuardName,
        replacementGuardId: replacementEmployeeId,
        replacementGuardName,
        reason,
      },
    });

    // Sync to draft SiteTimesheetRow: planned stays original, actual becomes replacement with reliever status
    const timeZone = await getCompanyTimezone(companyId);
    const workDate = new Date(`${dateKeyInTimeZone(shift.startTime, timeZone)}T00:00:00.000Z`);
    const row = await prisma.siteTimesheetRow.findFirst({
      where: {
        OR: [
          { sourceShiftId: shift.id },
          { siteId: shift.siteId, workDate, plannedGuardId: shift.employeeId },
        ],
      },
      include: { siteTimesheet: { select: { status: true } } },
    });

    if (row && row.approvalStatus !== "approved" && row.siteTimesheet?.status !== "locked") {
      await prisma.siteTimesheetRow.update({
        where: { id: row.id },
        data: {
          actualGuardId: replacementEmployeeId,
          attendanceStatus: "reliever",
          sourceShiftId: shift.id,
        },
      });
    }

    return reply.code(200).send({
      success: true,
      shift: updatedShift,
      message: `Guard ${originalGuardName} replaced with ${replacementGuardName}.`,
    });
  });

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
      const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
      if (code === "P2002") {
        return reply.code(409).send({
          error: "Clock-in validation failed",
          message: "Attendance has already been recorded for this shift",
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

    triggerPostClockExceptionSync(user.companyId, attendance.shift.siteId);

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

    const { hoursWorked, overtimeHours } = calculateManualEntryHours(clockIn, clockOut);

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
      clockIn: z.string().datetime().optional().nullable(),
      clockOut: z.string().datetime().optional().nullable(),
      reason: z.string().min(3, "A valid reason of at least 3 characters is required for manual adjustments"),
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

    const beforeSnapshot = attendanceSnapshot(attendance);

    const updateData: {
      clockIn?: Date | null;
      clockOut?: Date | null;
      hoursWorked?: number | null;
      overtimeHours?: number | null;
      status?: string;
    } = {};
    let newClockIn = attendance.clockIn ? new Date(attendance.clockIn) : null;
    let newClockOut = attendance.clockOut ? new Date(attendance.clockOut) : null;

    if (parsed.data.clockIn !== undefined) {
      newClockIn = parsed.data.clockIn ? new Date(parsed.data.clockIn) : null;
      updateData.clockIn = newClockIn;
    }
    if (parsed.data.clockOut !== undefined) {
      newClockOut = parsed.data.clockOut ? new Date(parsed.data.clockOut) : null;
      updateData.clockOut = newClockOut;
    }

    if (newClockOut && !newClockIn) {
      return reply.code(400).send({
        error: "Validation error",
        message: "Cannot set clockOut without clockIn",
      });
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
    } else if (newClockIn && !newClockOut) {
      updateData.hoursWorked = null;
      updateData.overtimeHours = null;
      updateData.status = "clocked_in";
    } else {
      updateData.hoursWorked = null;
      updateData.overtimeHours = null;
      updateData.status = "pending";
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

    // Record audit event with before and after snapshots
    await recordAttendanceEvent({
      companyId: user.companyId,
      attendanceId: id,
      shiftId: attendance.shiftId,
      employeeId: attendance.shift.employeeId,
      siteId: attendance.shift.siteId,
      eventType: "MANUAL_CORRECTION",
      source: "manual",
      occurredAt: new Date(),
      actorUserId: user.sub,
      reason: parsed.data.reason,
      before: beforeSnapshot,
      after: attendanceSnapshot(updated),
    });

    await createAuditLog({
      userId: user.sub,
      companyId: user.companyId,
      action: "attendance.update",
      entityType: "attendance",
      entityId: id,
      metadata: {
        clockIn: parsed.data.clockIn,
        clockOut: parsed.data.clockOut,
        reason: parsed.data.reason,
      },
    });

    // Sync changes to draft SiteTimesheetRow
    await syncAttendanceToTimesheetRow(attendance.shift, updated).catch((err) => {
      request.log.warn({ err, attendanceId: id }, "Failed to sync manual correction to timesheet row");
    });

    triggerPostClockExceptionSync(user.companyId, attendance.shift.siteId);

    return reply.send(updated);
  });
}
