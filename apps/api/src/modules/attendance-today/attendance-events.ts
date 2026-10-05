import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

type EventClient = Pick<typeof prisma, "attendanceEvent">;

export type AttendanceEventType =
  | "CLOCK_IN"
  | "CLOCK_OUT"
  | "MANUAL_CAPTURE"
  | "MANUAL_CORRECTION"
  | "MARK_ABSENT"
  | "REJECTED_GEOFENCE"
  | "NO_SHIFT"
  | "DUPLICATE";

export type AttendanceEventSource = "whatsapp" | "manual" | "rest";

export interface AttendanceEventInput {
  companyId: string;
  attendanceId?: string | null;
  shiftId?: string | null;
  employeeId?: string | null;
  siteId?: string | null;
  eventType: AttendanceEventType;
  source: AttendanceEventSource;
  occurredAt?: Date | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  actorUserId?: string | null;
  whatsappMessageId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** The attendance fields that matter for pay, captured so corrections show before/after. */
export function attendanceSnapshot(
  a:
    | {
        clockIn?: Date | null;
        clockOut?: Date | null;
        hoursWorked?: unknown;
        overtimeHours?: unknown;
        status?: string | null;
        source?: string | null;
        validationStatus?: string | null;
      }
    | null
    | undefined
): Record<string, unknown> | null {
  if (!a) return null;
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    clockIn: a.clockIn ? a.clockIn.toISOString() : null,
    clockOut: a.clockOut ? a.clockOut.toISOString() : null,
    hoursWorked: num(a.hoursWorked),
    overtimeHours: num(a.overtimeHours),
    status: a.status ?? null,
    source: a.source ?? null,
    validationStatus: a.validationStatus ?? null,
  };
}

/** Append one ledger row. Pass `tx` to commit it atomically with the change it describes. */
export async function recordAttendanceEvent(input: AttendanceEventInput, tx?: EventClient) {
  const client = tx ?? prisma;
  return client.attendanceEvent.create({
    data: {
      companyId: input.companyId,
      attendanceId: input.attendanceId ?? null,
      shiftId: input.shiftId ?? null,
      employeeId: input.employeeId ?? null,
      siteId: input.siteId ?? null,
      eventType: input.eventType,
      source: input.source,
      occurredAt: input.occurredAt ?? null,
      before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: input.reason ?? null,
      actorUserId: input.actorUserId ?? null,
      whatsappMessageId: input.whatsappMessageId ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/**
 * Best-effort ledger write for events that carry no business change (duplicates,
 * no-shift, rejected). A replayed webhook hits the (wamid, eventType) unique key,
 * which is the desired outcome, so failures are swallowed deliberately.
 */
export async function recordAttendanceEventQuietly(input: AttendanceEventInput): Promise<void> {
  try {
    await recordAttendanceEvent(input);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== "P2002") console.error("[AttendanceEvent] write failed", err);
  }
}
