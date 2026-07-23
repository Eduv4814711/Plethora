import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { toGeoNumber } from "../../lib/geo.js";
import { upsertAlert } from "../alerts/alerts.service.js";
import { parsePayrollCalendarSettings } from "../../lib/payroll-calendar-settings.js";
import { getCurrentPayPeriod } from "../../services/payroll-period.service.js";
import { createApprovalRequest } from "../approvals/approvals.service.js";
import {
  detectExceptionsForShift,
  exceptionTypeLabel,
  type DetectedException,
} from "./exception-detection.js";
import { parseExceptionPeriodBoundary } from "./exception-period.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../../lib/timezone.js";

const EXCEPTION_SCAN_BATCH_SIZE = 500;
const PAYROLL_BLOCKING_CRITICAL_STATUSES = ["OPEN", "UNDER_REVIEW", "APPROVED"] as const;

async function persistException(params: {
  companyId: string;
  attendanceId?: string | null;
  shiftId: string;
  employeeId?: string | null;
  siteId?: string | null;
  detected: DetectedException;
}) {
  const existing = await prisma.attendanceException.findFirst({
    where: {
      companyId: params.companyId,
      dedupeKey: params.detected.dedupeKey,
      status: { in: ["OPEN", "UNDER_REVIEW"] },
    },
  });
  if (existing) return { exception: existing, created: false };

  try {
    const exception = await prisma.attendanceException.create({
      data: {
        companyId: params.companyId,
        attendanceId: params.attendanceId ?? null,
        shiftId: params.shiftId,
        employeeId: params.employeeId ?? null,
        siteId: params.siteId ?? null,
        exceptionType: params.detected.exceptionType,
        severity: params.detected.severity,
        description: params.detected.description,
        minutesLate: params.detected.minutesLate ?? null,
        minutesEarly: params.detected.minutesEarly ?? null,
        dedupeKey: params.detected.dedupeKey,
        status: "OPEN",
      },
    });

    await upsertAlert({
      companyId: params.companyId,
      title: exceptionTypeLabel(params.detected.exceptionType),
      message: params.detected.description,
      priority: params.detected.severity,
      sourceModule: "ATTENDANCE",
      dedupeKey: `alert:${params.detected.dedupeKey}`,
      sourceId: exception.id,
      siteId: params.siteId,
      employeeId: params.employeeId,
    });

    if (
      params.siteId &&
      ["MISSED_CLOCK_IN", "MISSED_CLOCK_OUT", "PENDING_SUPERVISOR_REVIEW", "ABSENT"].includes(
        params.detected.exceptionType
      )
    ) {
      const site = await prisma.site.findFirst({
        where: { id: params.siteId, companyId: params.companyId },
        select: { supervisorId: true },
      });
      if (site?.supervisorId) {
        const [company, capabilityUser] = await Promise.all([
          prisma.company.findUnique({
            where: { id: params.companyId },
            select: { ownerUserId: true },
          }),
          prisma.user.findFirst({
            where: {
              companyId: params.companyId,
              isActive: true,
              capabilities: { path: ["/approvals"], array_contains: ["create"] },
            },
            select: { id: true },
          }),
        ]);
        const requestedById = company?.ownerUserId ?? capabilityUser?.id ?? site.supervisorId;
        if (requestedById !== site.supervisorId) {
          await createApprovalRequest({
            companyId: params.companyId,
            approvalType: "ATTENDANCE_EXCEPTION",
            entityType: "AttendanceException",
            entityId: exception.id,
            requestedById,
            approverId: site.supervisorId,
            comment: params.detected.description,
          }).catch(() => undefined);
        }
      }
    }

    return { exception, created: true };
  } catch {
    const again = await prisma.attendanceException.findFirst({
      where: { companyId: params.companyId, dedupeKey: params.detected.dedupeKey },
    });
    if (again) return { exception: again, created: false };
    throw new Error("Failed to create attendance exception");
  }
}

export async function detectAndPersistExceptions(params: {
  companyId: string;
  siteId?: string;
  lookbackHours?: number;
  graceMinutes?: number;
}) {
  const lookbackHours = params.lookbackHours ?? 48;
  const graceMinutes = params.graceMinutes ?? 15;
  const since = new Date(Date.now() - lookbackHours * 3600_000);
  const now = new Date();

  let created = 0;
  let scanned = 0;
  let cursor: string | undefined;
  while (true) {
    const shifts = await prisma.shift.findMany({
      where: {
        companyId: params.companyId,
        ...(params.siteId ? { siteId: params.siteId } : {}),
        startTime: { gte: since },
        status: { in: ["assigned", "active", "completed", "verified"] },
      },
      include: {
        attendances: { orderBy: { createdAt: "desc" }, take: 1 },
        site: {
          select: {
            id: true,
            latitude: true,
            longitude: true,
            geofenceRadiusMeters: true,
          },
        },
      },
      orderBy: { id: "asc" },
      take: EXCEPTION_SCAN_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    scanned += shifts.length;

    for (const shift of shifts) {
      const att = shift.attendances[0];
      const detected = detectExceptionsForShift(
        {
          shiftId: shift.id,
          employeeId: shift.employeeId,
          siteId: shift.siteId,
          scheduledStart: shift.startTime,
          scheduledEnd: shift.endTime,
          clockIn: att?.clockIn ?? null,
          clockOut: att?.clockOut ?? null,
          clockInLat: att ? toGeoNumber(att.clockInLat) : null,
          clockInLng: att ? toGeoNumber(att.clockInLng) : null,
          geofenceLat: shift.site ? toGeoNumber(shift.site.latitude) : null,
          geofenceLng: shift.site ? toGeoNumber(shift.site.longitude) : null,
          geofenceRadiusMeters: shift.site?.geofenceRadiusMeters ?? null,
          now,
        },
        graceMinutes
      );

      for (const d of detected) {
        const result = await persistException({
          companyId: params.companyId,
          attendanceId: att?.id,
          shiftId: shift.id,
          employeeId: shift.employeeId,
          siteId: shift.siteId,
          detected: d,
        });
        if (result.created) created += 1;
      }
    }
    if (shifts.length < EXCEPTION_SCAN_BATCH_SIZE) break;
    cursor = shifts.at(-1)!.id;
  }

  await refreshPayrollReadiness(params.companyId);
  return { scanned, created };
}

async function shiftIdsForWorkedPeriod(
  companyId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<string[]> {
  const timeZone = await getCompanyTimezone(companyId);
  const startKey = periodStart.toISOString().slice(0, 10);
  const endKey = periodEnd.toISOString().slice(0, 10);
  const queryStart = new Date(periodStart.getTime() - 36 * 60 * 60 * 1000);
  const queryEnd =
    periodEnd.getUTCFullYear() >= 9999
      ? periodEnd
      : new Date(periodEnd.getTime() + 36 * 60 * 60 * 1000);
  const shifts = await prisma.shift.findMany({
    where: {
      companyId,
      startTime: { gte: queryStart, lte: queryEnd },
    },
    select: { id: true, startTime: true },
  });
  return shifts
    .filter((shift) => {
      const workedDate = dateKeyInTimeZone(shift.startTime, timeZone);
      return workedDate >= startKey && workedDate <= endKey;
    })
    .map((shift) => shift.id);
}

export async function listExceptions(
  companyId: string,
  query: {
    status?: string;
    severity?: string;
    exceptionType?: string;
    siteId?: string;
    employeeId?: string;
    periodStart?: string;
    periodEnd?: string;
    limit: number;
    offset: number;
  }
) {
  const periodStart = query.periodStart
    ? parseExceptionPeriodBoundary(query.periodStart, "start")
    : undefined;
  const periodEnd = query.periodEnd
    ? parseExceptionPeriodBoundary(query.periodEnd, "end")
    : undefined;
  const periodShiftIds =
    periodStart || periodEnd
      ? await shiftIdsForWorkedPeriod(
          companyId,
          periodStart ?? new Date(0),
          periodEnd ?? new Date("9999-12-31T23:59:59.999Z")
        )
      : undefined;
  const where: Prisma.AttendanceExceptionWhereInput = {
    companyId,
    ...(query.status ? { status: query.status as never } : {}),
    ...(query.severity ? { severity: query.severity as never } : {}),
    ...(query.exceptionType ? { exceptionType: query.exceptionType as never } : {}),
    ...(query.siteId ? { siteId: query.siteId } : {}),
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(periodShiftIds ? { shiftId: { in: periodShiftIds } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.attendanceException.findMany({
      where,
      orderBy: [{ severity: "asc" }, { detectedAt: "desc" }],
      take: query.limit,
      skip: query.offset,
      include: {
        site: { select: { id: true, name: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.attendanceException.count({ where }),
  ]);

  const shiftIds = [...new Set(items.flatMap((item) => (item.shiftId ? [item.shiftId] : [])))];
  const shifts = shiftIds.length
    ? await prisma.shift.findMany({
        where: { companyId, id: { in: shiftIds } },
        select: { id: true, startTime: true, endTime: true },
      })
    : [];
  const shiftsById = new Map(shifts.map((shift) => [shift.id, shift]));

  return {
    items: items.map((item) => ({
      ...item,
      shift: item.shiftId ? shiftsById.get(item.shiftId) : undefined,
    })),
    total,
  };
}

export async function reviewException(params: {
  companyId: string;
  exceptionId: string;
  userId: string;
  action: "approve" | "reject" | "resolve" | "under_review" | "mark_absent";
  reviewNote?: string;
}) {
  const exception = await prisma.attendanceException.findFirst({
    where: { id: params.exceptionId, companyId: params.companyId },
  });
  if (!exception) return null;

  const statusMap = {
    approve: "APPROVED",
    reject: "REJECTED",
    resolve: "RESOLVED",
    under_review: "UNDER_REVIEW",
    mark_absent: "RESOLVED",
  } as const;

  const updated = await prisma.attendanceException.update({
    where: { id: exception.id },
    data: {
      status: statusMap[params.action],
      reviewedById: params.userId,
      reviewedAt: new Date(),
      reviewNote:
        params.action === "mark_absent"
          ? [params.reviewNote, "Marked absent by supervisor"].filter(Boolean).join(" — ")
          : params.reviewNote ?? null,
      ...(params.action === "mark_absent"
        ? { exceptionType: "ABSENT" as const }
        : {}),
    },
  });

  await createAuditLog({
    userId: params.userId,
    companyId: params.companyId,
    action: `attendance_exception.${params.action}`,
    entityType: "AttendanceException",
    entityId: exception.id,
    metadata: { previousStatus: exception.status, reviewNote: params.reviewNote },
  });

  // Confirming an exception does not prove the underlying attendance was
  // corrected. Keep its alert active until it is explicitly resolved/rejected
  // or converted to an absence.
  if (["reject", "resolve", "mark_absent"].includes(params.action)) {
    await prisma.operationalAlert.updateMany({
      where: {
        companyId: params.companyId,
        sourceId: exception.id,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
      },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedById: params.userId,
      },
    });
  }

  await refreshPayrollReadiness(params.companyId);
  return updated;
}

export async function getExceptionAnalytics(
  companyId: string,
  periodStart?: Date,
  periodEnd?: Date
) {
  const periodShiftIds =
    periodStart || periodEnd
      ? await shiftIdsForWorkedPeriod(
          companyId,
          periodStart ?? new Date(0),
          periodEnd ?? new Date("9999-12-31T23:59:59.999Z")
        )
      : undefined;
  const where: Prisma.AttendanceExceptionWhereInput = {
    companyId,
    ...(periodShiftIds ? { shiftId: { in: periodShiftIds } } : {}),
  };

  const [byType, bySeverity, bySite, byEmployee, openCritical, openCount, total] =
    await Promise.all([
      prisma.attendanceException.groupBy({
        by: ["exceptionType"],
        where,
        _count: { id: true },
      }),
      prisma.attendanceException.groupBy({
        by: ["severity"],
        where,
        _count: { id: true },
      }),
      prisma.attendanceException.groupBy({
        by: ["siteId"],
        where: { ...where, siteId: { not: null } },
        _count: { id: true },
      }),
      prisma.attendanceException.groupBy({
        by: ["employeeId"],
        where: { ...where, employeeId: { not: null } },
        _count: { id: true },
      }),
      prisma.attendanceException.count({
        where: {
          ...where,
          severity: "CRITICAL",
          status: { in: [...PAYROLL_BLOCKING_CRITICAL_STATUSES] },
        },
      }),
      prisma.attendanceException.count({
        where: {
          ...where,
          OR: [
            { status: { in: ["OPEN", "UNDER_REVIEW"] } },
            { severity: "CRITICAL", status: "APPROVED" },
          ],
        },
      }),
      prisma.attendanceException.count({ where }),
    ]);

  const late = byType.find((t) => t.exceptionType === "LATE_ARRIVAL")?._count.id ?? 0;
  const missedIn = byType.find((t) => t.exceptionType === "MISSED_CLOCK_IN")?._count.id ?? 0;
  const missedOut = byType.find((t) => t.exceptionType === "MISSED_CLOCK_OUT")?._count.id ?? 0;
  const early = byType.find((t) => t.exceptionType === "EARLY_DEPARTURE")?._count.id ?? 0;
  const absent = byType.find((t) => t.exceptionType === "ABSENT")?._count.id ?? 0;

  const shiftWhere = {
    companyId,
    ...(periodStart || periodEnd
      ? {
          startTime: {
            ...(periodStart ? { gte: periodStart } : {}),
            ...(periodEnd ? { lte: periodEnd } : {}),
          },
        }
      : {}),
  };
  const [totalShifts, withClockIn] = await Promise.all([
    prisma.shift.count({ where: shiftWhere }),
    prisma.shift.count({
      where: {
        ...shiftWhere,
        attendances: { some: { clockIn: { not: null } } },
      },
    }),
  ]);

  const completionRate =
    totalShifts > 0 ? Math.round((withClockIn / totalShifts) * 1000) / 10 : 100;
  const absenteePercentage =
    totalShifts > 0 ? Math.round((absent / totalShifts) * 1000) / 10 : 0;

  return {
    total,
    openCount,
    openCritical,
    lateArrivals: late,
    missedClockIns: missedIn,
    missedClockOuts: missedOut,
    earlyDepartures: early,
    absences: absent,
    completionRate,
    absenteePercentage,
    byType: byType.map((t) => ({ type: t.exceptionType, count: t._count.id })),
    bySeverity: bySeverity.map((s) => ({ severity: s.severity, count: s._count.id })),
    bySite: bySite.map((s) => ({ siteId: s.siteId, count: s._count.id })),
    byEmployee: byEmployee.map((e) => ({ employeeId: e.employeeId, count: e._count.id })),
  };
}

export async function refreshPayrollReadiness(
  companyId: string,
  periodStart?: Date,
  periodEnd?: Date
) {
  const now = new Date();
  const start =
    periodStart ??
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end =
    periodEnd ??
    new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)
    );
  const periodShiftIds = await shiftIdsForWorkedPeriod(companyId, start, end);

  const openCritical = await prisma.attendanceException.count({
    where: {
      companyId,
      shiftId: { in: periodShiftIds },
      severity: "CRITICAL",
      status: { in: [...PAYROLL_BLOCKING_CRITICAL_STATUSES] },
    },
  });
  const openAny = await prisma.attendanceException.count({
    where: {
      companyId,
      shiftId: { in: periodShiftIds },
      OR: [
        { status: { in: ["OPEN", "UNDER_REVIEW"] } },
        { severity: "CRITICAL", status: "APPROVED" },
      ],
    },
  });

  let status: "READY" | "PENDING_ATTENDANCE_REVIEW" | "BLOCKED_BY_EXCEPTIONS" =
    "READY";
  if (openCritical > 0) status = "BLOCKED_BY_EXCEPTIONS";
  else if (openAny > 0) status = "PENDING_ATTENDANCE_REVIEW";

  await prisma.payrollPeriodReadiness.upsert({
    where: {
      companyId_periodStart_periodEnd: {
        companyId,
        periodStart: start,
        periodEnd: end,
      },
    },
    create: {
      companyId,
      periodStart: start,
      periodEnd: end,
      status,
      openExceptions: openAny,
    },
    update: {
      status: status === "READY" ? "READY" : status,
      openExceptions: openAny,
    },
  });

  if (status === "BLOCKED_BY_EXCEPTIONS") {
    await upsertAlert({
      companyId,
      title: "Payroll blocked because attendance is not approved",
      message: `${openCritical} critical attendance issue(s) must be corrected or explicitly resolved before payroll can proceed.`,
      priority: "CRITICAL",
      sourceModule: "PAYROLL",
      dedupeKey: `payroll_blocked:${start.toISOString().slice(0, 10)}`,
    });
  }

  return { status, openExceptions: openAny, openCritical };
}

/** Block payroll calculate/approve when critical attendance exceptions are unresolved for the period. */
export async function assertPayrollNotBlocked(
  companyId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<{ blocked: boolean; message?: string; status: string; openExceptions: number }> {
  const readiness = await refreshPayrollReadiness(companyId, periodStart, periodEnd);
  if (readiness.status === "BLOCKED_BY_EXCEPTIONS") {
    return {
      blocked: true,
      message: `${readiness.openCritical} critical attendance issue(s) must be corrected or explicitly resolved before payroll can proceed.`,
      status: readiness.status,
      openExceptions: readiness.openExceptions,
    };
  }
  return {
    blocked: false,
    status: readiness.status,
    openExceptions: readiness.openExceptions,
  };
}

export async function getPayrollReadiness(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  const calendarSettings = parsePayrollCalendarSettings(company?.settings);
  const period = getCurrentPayPeriod(calendarSettings);
  const start = period.periodStart;
  const end = period.periodEnd;
  let row = await prisma.payrollPeriodReadiness.findUnique({
    where: {
      companyId_periodStart_periodEnd: {
        companyId,
        periodStart: start,
        periodEnd: end,
      },
    },
  });
  if (!row) {
    await refreshPayrollReadiness(companyId, start, end);
    row = await prisma.payrollPeriodReadiness.findUnique({
      where: {
        companyId_periodStart_periodEnd: {
          companyId,
          periodStart: start,
          periodEnd: end,
        },
      },
    });
  }
  return row;
}
