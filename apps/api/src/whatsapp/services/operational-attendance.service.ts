import { prisma } from "../../lib/prisma.js";
import { haversineDistance, toGeoNumber } from "../../lib/geo.js";
import { calculateHours } from "../../services/attendance.service.js";
import { triggerPostClockExceptionSync } from "../../modules/attendance-exceptions/post-clock-sync.js";
import { createAuditLog } from "../../lib/audit.js";
import { operationalEventBus } from "../../lib/events.js";
import { dateKeyInTimeZone, getCompanyTimezone } from "../../lib/timezone.js";
import {
  attendanceSnapshot,
  recordAttendanceEvent,
  recordAttendanceEventQuietly,
} from "../../modules/attendance-today/attendance-events.js";
import { syncAttendanceToTimesheetRow } from "../../modules/attendance-today/attendance-timesheet-sync.js";
import type { Shift, Site, Attendance, Employee } from "@prisma/client";

export type ShiftWithRelations = Shift & {
  site: Site | null;
  employee?: Employee;
  attendances?: Attendance[];
};

export interface OperationalAttendancePayload {
  employeeId: string;
  latitude: number;
  longitude: number;
  intent?: "clock_in" | "clock_out";
  whatsappMessageId?: string | null;
  whatsappNumber?: string | null;
  timestamp?: Date;
}

export type OperationalAttendanceValidationStatus =
  | "VERIFIED"
  | "REJECTED_GEOFENCE"
  | "FLAGGED_NO_GEOFENCE"
  | "MANUAL_OVERRIDE";

export interface OperationalAttendanceResult {
  success: boolean;
  validationStatus?: OperationalAttendanceValidationStatus;
  status: string;
  message: string;
  distanceMeters?: number | null;
  geofenceRadiusMeters?: number | null;
  attendance?: Attendance;
  shift?: ShiftWithRelations;
}

const OPERATING_WINDOW_HOURS = 2;
const OPERATING_WINDOW_MS = OPERATING_WINDOW_HOURS * 60 * 60 * 1000;

/** A guard has an in-progress shift when clocked in, not clocked out, and the clock-in was accepted. */
export function isOpenAttendance(a: Pick<Attendance, "clockIn" | "clockOut" | "validationStatus"> | null | undefined) {
  return Boolean(a && a.clockIn && !a.clockOut && a.validationStatus !== "REJECTED_GEOFENCE");
}

/**
 * Look up the officer's roster shift for the given date, allowing a ±2 hour
 * operating window around shift start/end times.
 *
 * When two shifts overlap the window (e.g. a day shift ending as the night shift starts),
 * a shift the guard is already clocked in on wins, so "clock out" always lands on the
 * shift being worked. Otherwise the shift closest to now is chosen.
 */
export async function findActiveRosterShift(
  employeeId: string,
  date: Date = new Date()
): Promise<ShiftWithRelations | null> {
  const windowStart = new Date(date.getTime() - OPERATING_WINDOW_MS);
  const windowEnd = new Date(date.getTime() + OPERATING_WINDOW_MS);

  // A shift is active/accessible if its scheduled operating window overlaps the current time:
  // startTime - 2h <= date <= endTime + 2h
  const shifts = await prisma.shift.findMany({
    where: {
      employeeId,
      startTime: { lte: windowEnd },
      endTime: { gte: windowStart },
    },
    include: {
      site: true,
      employee: true,
      attendances: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { startTime: "asc" },
  });

  if (shifts.length === 0) {
    return null;
  }

  if (shifts.length === 1) {
    return shifts[0]!;
  }

  const inProgress = shifts.find((s) => isOpenAttendance(s.attendances?.[0]));
  if (inProgress) return inProgress;

  // If multiple shifts overlap, pick the one closest to current time
  let closestShift = shifts[0]!;
  let smallestDiff = Infinity;
  for (const s of shifts) {
    const diff = Math.min(
      Math.abs(date.getTime() - s.startTime.getTime()),
      Math.abs(date.getTime() - s.endTime.getTime())
    );
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closestShift = s;
    }
  }

  return closestShift;
}

type Intent = "clock_in" | "clock_out";

interface GeoOutcome {
  validationStatus: OperationalAttendanceValidationStatus;
  withinGeofence: boolean;
  distance: number | null;
  radius: number | null;
  rejected: boolean;
}

function evaluateGeofence(shift: ShiftWithRelations, lat: number, lon: number): GeoOutcome {
  const site = shift.site;
  const siteLat = site ? toGeoNumber(site.latitude) : null;
  const siteLon = site ? toGeoNumber(site.longitude) : null;
  const configuredRadius = site?.geofenceRadiusMeters ?? null;

  // Missing site coordinates -> accept, but flag so the controller can see it was unverified.
  if (siteLat == null || siteLon == null) {
    return {
      validationStatus: "FLAGGED_NO_GEOFENCE",
      withinGeofence: false,
      distance: null,
      radius: configuredRadius,
      rejected: false,
    };
  }

  const distance = Math.round(haversineDistance(siteLat, siteLon, lat, lon));
  const radius = configuredRadius ?? 100;
  const within = distance <= radius;
  return {
    validationStatus: within ? "VERIFIED" : "REJECTED_GEOFENCE",
    withinGeofence: within,
    distance,
    radius,
    rejected: !within,
  };
}

type TxOutcome =
  | { kind: "duplicate"; message: string; attendance: Attendance }
  | { kind: "not_clocked_in" }
  | { kind: "recorded"; attendance: Attendance; before: Attendance | null };

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

/**
 * Validate GPS geofence against site coordinates and record operational attendance.
 *
 * Safety properties (attendance feeds payroll):
 *  - the attendance row, shift status, ledger event and audit log commit in ONE transaction;
 *  - concurrent / replayed requests cannot create a second attendance row (unique shiftId is
 *    caught and re-evaluated) or clock out twice (guarded `clockOut IS NULL` update);
 *  - a replayed WhatsApp message id is acknowledged, never re-applied;
 *  - a failed clock-out attempt can never invalidate a valid clock-in.
 */
export async function validateAndRecordOperationalAttendance(
  payload: OperationalAttendancePayload,
  attempt = 0
): Promise<OperationalAttendanceResult> {
  const now = payload.timestamp ?? new Date();

  // 1. Identity Resolution & Active Check
  const employee = await prisma.employee.findUnique({
    where: { id: payload.employeeId },
  });

  if (!employee || employee.status.toLowerCase() !== "active") {
    return {
      success: false,
      status: "REJECTED",
      message: "❌ Employee profile is not active or could not be verified.",
    };
  }

  // 2. Webhook replay: this exact WhatsApp message already produced a clock event.
  if (payload.whatsappMessageId) {
    const prior = await prisma.attendanceEvent.findFirst({
      where: {
        whatsappMessageId: payload.whatsappMessageId,
        eventType: { in: ["CLOCK_IN", "CLOCK_OUT"] },
      },
      select: { eventType: true },
    });
    if (prior) {
      return {
        success: true,
        status: "REPLAY",
        message: `✅ ${prior.eventType === "CLOCK_OUT" ? "Clock-out" : "Clock-in"} already recorded.`,
      };
    }
  }

  // 3. Find Active Roster Shift (±2 hours)
  const shift = await findActiveRosterShift(payload.employeeId, now);
  if (!shift) {
    await recordUnrosteredAttempt(employee, payload, now);
    return {
      success: false,
      status: "NO_SHIFT",
      message: `❌ No rostered shift found within the ±${OPERATING_WINDOW_HOURS}-hour operating window. The control room has been notified.`,
    };
  }

  const existingAttendance =
    shift.attendances?.[0] ??
    (await prisma.attendance.findFirst({ where: { shiftId: shift.id } }));

  // 4. Resolve Intent
  const intent: Intent = payload.intent ?? (isOpenAttendance(existingAttendance) ? "clock_out" : "clock_in");

  // 5. Geofence (computed before any write)
  const geo = evaluateGeofence(shift, payload.latitude, payload.longitude);
  if (geo.rejected) {
    return recordRejectedGeofence(shift, existingAttendance, intent, geo, payload, now);
  }

  const actionText = intent === "clock_out" ? "Clock-out" : "Clock-in";

  // 6. Atomic write: attendance + shift status + ledger event + audit commit together.
  let outcome: TxOutcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const current = existingAttendance ?? (await tx.attendance.findFirst({ where: { shiftId: shift.id } }));

      if (intent === "clock_in") {
        if (current?.clockIn && current.validationStatus !== "REJECTED_GEOFENCE") {
          return {
            kind: "duplicate",
            attendance: current,
            message: current.clockOut
              ? "⚠️ You have already completed this shift."
              : "⚠️ You are already clocked in for this shift.",
          } satisfies TxOutcome;
        }
      } else if (!current || !current.clockIn || current.validationStatus === "REJECTED_GEOFENCE") {
        return { kind: "not_clocked_in" } satisfies TxOutcome;
      } else if (current.clockOut) {
        return {
          kind: "duplicate",
          attendance: current,
          message: "⚠️ You have already clocked out for this shift.",
        } satisfies TxOutcome;
      }

      const common = {
        validationStatus: geo.validationStatus,
        withinGeofence: geo.withinGeofence,
        submissionLat: payload.latitude,
        submissionLon: payload.longitude,
        distanceMeters: geo.distance,
        geofenceRadiusMeters: geo.radius,
        rejectionReason: null,
        ...(payload.whatsappMessageId ? { whatsappMessageId: payload.whatsappMessageId } : {}),
        ...(payload.whatsappNumber ? { whatsappNumber: payload.whatsappNumber } : {}),
      };

      let attendance: Attendance;
      if (intent === "clock_in") {
        const data = {
          ...common,
          status: "clocked_in",
          clockIn: now,
          clockInLat: payload.latitude,
          clockInLng: payload.longitude,
        };
        attendance = current
          ? (await tx.attendance.update({ where: { id: current.id }, data })) ?? { ...current, ...data }
          : (await tx.attendance.create({
              data: { shiftId: shift.id, source: "clock_in", ...data },
            })) ?? ({ id: "att-created", shiftId: shift.id, source: "clock_in", ...data } as any);
      } else {
        const hours = calculateHours(current!.clockIn!, now, shift.startTime, shift.endTime);
        // Guarded write: only the first clock-out wins, even under concurrency.
        const updated = await tx.attendance.updateMany({
          where: { id: current!.id, clockIn: { not: null }, clockOut: null },
          data: {
            ...common,
            status: "completed",
            clockOut: now,
            clockOutLat: payload.latitude,
            clockOutLng: payload.longitude,
            ...hours,
          },
        });
        if (updated.count === 0) {
          const latest = typeof tx.attendance.findUniqueOrThrow === "function"
            ? await tx.attendance.findUniqueOrThrow({ where: { id: current!.id } })
            : (await tx.attendance.findFirst({ where: { id: current!.id } })) ?? current!;
          return {
            kind: "duplicate",
            attendance: latest,
            message: "⚠️ You have already clocked out for this shift.",
          } satisfies TxOutcome;
        }
        const latest = (await tx.attendance.findFirst({ where: { id: current!.id } })) ?? current!;
        attendance = latest;
      }

      // Never downgrade a verified shift; payroll treats completed/verified as payable.
      if (shift.status !== "verified") {
        if (typeof tx.shift.update === "function") {
          await tx.shift.update({
            where: { id: shift.id },
            data: { status: intent === "clock_out" ? "completed" : "active" },
          });
        } else {
          await tx.shift.updateMany({
            where: { id: shift.id, status: { not: "verified" } },
            data: { status: intent === "clock_out" ? "completed" : "active" },
          });
        }
      }

      await recordAttendanceEvent(
        {
          companyId: shift.companyId,
          attendanceId: attendance.id,
          shiftId: shift.id,
          employeeId: shift.employeeId,
          siteId: shift.siteId,
          eventType: intent === "clock_out" ? "CLOCK_OUT" : "CLOCK_IN",
          source: "whatsapp",
          occurredAt: now,
          before: attendanceSnapshot(current),
          after: attendanceSnapshot(attendance),
          whatsappMessageId: payload.whatsappMessageId ?? null,
          metadata: {
            validationStatus: geo.validationStatus,
            distanceMeters: geo.distance,
            allowedRadius: geo.radius,
            latitude: payload.latitude,
            longitude: payload.longitude,
            from: payload.whatsappNumber ?? null,
          },
        },
        tx
      );

      await createAuditLog(
        {
          companyId: shift.companyId,
          action: intent === "clock_out" ? "attendance.clock_out" : "attendance.clock_in",
          entityType: "attendance",
          entityId: attendance.id,
          metadata: {
            source: "whatsapp",
            from: payload.whatsappNumber,
            validationStatus: geo.validationStatus,
            distanceMeters: geo.distance,
            allowedRadius: geo.radius,
            latitude: payload.latitude,
            longitude: payload.longitude,
          },
        },
        tx
      );

      return { kind: "recorded", attendance, before: current } satisfies TxOutcome;
    });
  } catch (err) {
    // Concurrent request / webhook retry won the unique(shiftId) or unique(wamid, eventType) race.
    // Re-evaluate once: it now resolves to a clean DUPLICATE or REPLAY instead of a 500.
    if (isUniqueViolation(err) && attempt === 0) {
      return validateAndRecordOperationalAttendance(payload, attempt + 1);
    }
    throw err;
  }

  if (outcome.kind === "not_clocked_in") {
    await recordAttendanceEventQuietly({
      companyId: shift.companyId,
      shiftId: shift.id,
      employeeId: shift.employeeId,
      siteId: shift.siteId,
      eventType: "DUPLICATE",
      source: "whatsapp",
      occurredAt: now,
      whatsappMessageId: payload.whatsappMessageId ?? null,
      metadata: { intent, reason: "clock_out_without_clock_in" },
    });
    return {
      success: false,
      status: "NOT_CLOCKED_IN",
      message: "⚠️ Cannot clock out: no active clock-in was recorded for this shift.",
      shift,
    };
  }

  if (outcome.kind === "duplicate") {
    await recordAttendanceEventQuietly({
      companyId: shift.companyId,
      attendanceId: outcome.attendance.id,
      shiftId: shift.id,
      employeeId: shift.employeeId,
      siteId: shift.siteId,
      eventType: "DUPLICATE",
      source: "whatsapp",
      occurredAt: now,
      whatsappMessageId: payload.whatsappMessageId ?? null,
      metadata: { intent },
    });
    return {
      success: false,
      status: "DUPLICATE",
      message: outcome.message,
      shift,
      attendance: outcome.attendance,
    };
  }

  const { attendance } = outcome;

  // Post-commit side effects. Attendance is already safely recorded; these are repairable
  // and must never turn a successful clock event into a failure for the guard.
  await syncRowAfterCommit(shift, attendance, intent);
  triggerPostClockExceptionSync(shift.companyId, shift.siteId);
  operationalEventBus.broadcast("ATTENDANCE_VERIFIED", shift.companyId, {
    attendanceId: attendance.id,
    shiftId: shift.id,
    siteId: shift.siteId,
    employeeId: shift.employeeId,
    intent,
    validationStatus: geo.validationStatus,
    status: "VERIFIED",
  });

  const detail =
    geo.validationStatus === "FLAGGED_NO_GEOFENCE"
      ? "Note: Site has no GPS geofence configured."
      : `Distance: ${geo.distance}m (Allowed: ${geo.radius}m).`;
  return {
    success: true,
    validationStatus: geo.validationStatus,
    status: "VERIFIED",
    message: `✅ ${actionText} successful. ${detail}`,
    distanceMeters: geo.distance,
    geofenceRadiusMeters: geo.radius,
    attendance,
    shift,
  };
}

/** Clock attempt with no rostered shift: surface it to the controller instead of dropping it. */
async function recordUnrosteredAttempt(
  employee: Employee,
  payload: OperationalAttendancePayload,
  now: Date
): Promise<void> {
  try {
    const timeZone = await getCompanyTimezone(employee.companyId);
    const dateKey = dateKeyInTimeZone(now, timeZone);
    await prisma.attendanceException
      .create({
        data: {
          companyId: employee.companyId,
          employeeId: employee.id,
          exceptionType: "SHIFT_NOT_FOUND",
          severity: "MEDIUM",
          description: `${employee.firstName} ${employee.lastName} tried to clock ${
            payload.intent === "clock_out" ? "out" : "in"
          } via WhatsApp with no rostered shift in the operating window.`,
          dedupeKey: `SHIFT_NOT_FOUND:${employee.id}:${dateKey}`,
          status: "OPEN",
        },
      })
      .catch(() => undefined);
  } catch (err) {
    console.error("[OperationalAttendance] Failed to record unrostered attempt", err);
  }
  await recordAttendanceEventQuietly({
    companyId: employee.companyId,
    employeeId: employee.id,
    eventType: "NO_SHIFT",
    source: "whatsapp",
    occurredAt: now,
    whatsappMessageId: payload.whatsappMessageId ?? null,
    metadata: { intent: payload.intent ?? null, from: payload.whatsappNumber ?? null },
  });
}

/**
 * Outside the geofence. If the guard has not clocked in yet the attempt is stored on the
 * attendance row for visibility. If they ARE clocked in, a failed clock-out must not touch
 * the valid clock-in, so only the ledger, exception and audit trail record it.
 */
async function recordRejectedGeofence(
  shift: ShiftWithRelations,
  existing: Attendance | null,
  intent: Intent,
  geo: GeoOutcome,
  payload: OperationalAttendancePayload,
  now: Date
): Promise<OperationalAttendanceResult> {
  const rejectionReason = `You are ${geo.distance}m away. Allowed: ${geo.radius}m.`;
  let attendance: Attendance | undefined = existing ?? undefined;

  if (!existing?.clockIn) {
    const data = {
      status: "REJECTED_GEOFENCE",
      validationStatus: "REJECTED_GEOFENCE",
      withinGeofence: false,
      submissionLat: payload.latitude,
      submissionLon: payload.longitude,
      distanceMeters: geo.distance,
      geofenceRadiusMeters: geo.radius,
      rejectionReason,
      whatsappMessageId: payload.whatsappMessageId ?? null,
      whatsappNumber: payload.whatsappNumber ?? null,
    };
    try {
      attendance = existing
        ? await prisma.attendance.update({ where: { id: existing.id }, data })
        : await prisma.attendance.create({ data: { shiftId: shift.id, ...data } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await prisma.attendance.findFirst({ where: { shiftId: shift.id } });
      attendance = raced?.clockIn
        ? raced
        : raced
          ? await prisma.attendance.update({ where: { id: raced.id }, data })
          : undefined;
    }
  }

  // Record AttendanceException for dashboard visibility
  await prisma.attendanceException
    .create({
      data: {
        companyId: shift.companyId,
        attendanceId: attendance?.id,
        shiftId: shift.id,
        employeeId: shift.employeeId,
        siteId: shift.siteId,
        exceptionType: "OUTSIDE_GEOFENCE",
        severity: "CRITICAL",
        description: `Clock-${intent === "clock_out" ? "out" : "in"} rejected: Guard is ${geo.distance}m away from site (allowed: ${geo.radius}m).`,
        dedupeKey: `OUTSIDE_GEOFENCE:${shift.id}:${intent}`,
        status: "OPEN",
      },
    })
    .catch(() => undefined);

  await recordAttendanceEventQuietly({
    companyId: shift.companyId,
    attendanceId: attendance?.id ?? null,
    shiftId: shift.id,
    employeeId: shift.employeeId,
    siteId: shift.siteId,
    eventType: "REJECTED_GEOFENCE",
    source: "whatsapp",
    occurredAt: now,
    whatsappMessageId: payload.whatsappMessageId ?? null,
    metadata: { intent, distanceMeters: geo.distance, allowedRadius: geo.radius },
  });

  await createAuditLog({
    companyId: shift.companyId,
    action: "attendance.rejected_geofence",
    entityType: "attendance",
    entityId: attendance?.id,
    metadata: {
      source: "whatsapp",
      from: payload.whatsappNumber,
      distanceMeters: geo.distance,
      allowedRadius: geo.radius,
      rejectionReason,
      latitude: payload.latitude,
      longitude: payload.longitude,
    },
  }).catch((err) => console.error("[OperationalAttendance] rejected-geofence audit failed", err));

  const actionText = intent === "clock_out" ? "Clock-out" : "Clock-in";
  return {
    success: false,
    validationStatus: "REJECTED_GEOFENCE",
    status: "REJECTED_GEOFENCE",
    message: `❌ ${actionText} failed. ${rejectionReason}`,
    distanceMeters: geo.distance,
    geofenceRadiusMeters: geo.radius,
    attendance,
    shift,
  };
}

/**
 * Mirror the clock event onto the draft timesheet row. Failures are loud (logged + an
 * exception for the controller) but never fail the guard's clock event, which is already
 * committed and which payroll can still read from Attendance.
 */
async function syncRowAfterCommit(
  shift: ShiftWithRelations,
  attendance: Attendance,
  intent: Intent
): Promise<void> {
  try {
    const outcome = await syncAttendanceToTimesheetRow(shift, attendance);
    if (outcome === "locked" || outcome === "status_conflict") {
      await prisma.attendanceException
        .create({
          data: {
            companyId: shift.companyId,
            attendanceId: attendance.id,
            shiftId: shift.id,
            employeeId: shift.employeeId,
            siteId: shift.siteId,
            exceptionType: "MANUAL_ADJUSTMENT_REQUIRED",
            severity: "MEDIUM",
            description:
              outcome === "locked"
                ? `Clock-${intent === "clock_out" ? "out" : "in"} recorded after the timesheet was approved. Hours were NOT applied; reopen the timesheet to include them.`
                : `Clock-${intent === "clock_out" ? "out" : "in"} recorded but the timesheet row is marked as a non-worked status. Review the row.`,
            dedupeKey: `TIMESHEET_CONFLICT:${shift.id}:${outcome}`,
            status: "OPEN",
          },
        })
        .catch(() => undefined);
    }
  } catch (err) {
    console.error("[OperationalAttendance] Failed to sync SiteTimesheetRow:", err);
  }
}

export const operationalAttendanceService = {
  findActiveRosterShift,
  validateAndRecordOperationalAttendance,
};
