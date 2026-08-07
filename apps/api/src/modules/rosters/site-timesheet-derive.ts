import { fromZonedTime } from "date-fns-tz";
import type { SiteTimesheetAttendance } from "@prisma/client";

/**
 * Server-side port of the attendance derivation that previously lived only in the
 * browser (apps/web `buildRowApprovalPatch` + `resolveAttendanceStatusOnApprove`).
 *
 * Bulk confirmation cannot reuse browser code, and two divergent copies would produce
 * different `attendanceStatus` values — which is what `PAYABLE_STATUSES` uses to decide
 * whether a row is paid. Keep this file and `apps/web/lib/site-timesheet-utils.ts` in
 * lockstep; `__tests__/site-timesheet-derive.test.ts` asserts parity.
 */

/**
 * Local copy rather than an import from site-timesheets.service.js, which imports this
 * module — keeping this file dependency-free avoids a require cycle.
 */
function normalizeShiftType(value: string | null | undefined): "day" | "night" | null {
  if (!value) return null;
  if (value === "day" || value === "D") return "day";
  if (value === "night" || value === "N") return "night";
  return null;
}

/** Day 06:00–18:00, night 18:00–06:00 — mirrors apps/web/lib/shift-times.ts. */
export const SHIFT_TIME_MORNING = "06:00";
export const SHIFT_TIME_EVENING = "18:00";

export function defaultShiftTime(
  shiftType: "day" | "night" | null,
  which: "start" | "end"
): string {
  if (shiftType === "night") return which === "start" ? SHIFT_TIME_EVENING : SHIFT_TIME_MORNING;
  if (shiftType === "day") return which === "start" ? SHIFT_TIME_MORNING : SHIFT_TIME_EVENING;
  return "";
}

const TIME_PATTERN = /^(\d{2}):(\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Combine a work date (yyyy-MM-dd) and an HH:mm wall-clock time into an instant.
 *
 * The browser helper builds `new Date(\`${date}T${time}:00\`)`, which resolves in the
 * *viewer's* zone. Payroll buckets Sunday and public-holiday hours by the shift-start
 * calendar day in company time (`classifyShiftHours`), so the company timezone — not
 * whoever happens to be logged in — is the correct basis.
 */
export function combineDateTimeInZone(
  workDate: string,
  time: string,
  timeZone: string
): Date | null {
  if (!DATE_PATTERN.test(workDate)) return null;
  if (!TIME_PATTERN.test(time)) return null;
  const instant = fromZonedTime(`${workDate}T${time}:00`, timeZone);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** A clock-out at or before clock-in belongs to the following day (night shifts). */
export function combineClockOutInZone(
  workDate: string,
  time: string,
  clockIn: Date | null,
  timeZone: string
): Date | null {
  const out = combineDateTimeInZone(workDate, time, timeZone);
  if (!out || !clockIn) return out;
  if (out.getTime() > clockIn.getTime()) return out;
  const next = new Date(`${workDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return combineDateTimeInZone(next.toISOString().slice(0, 10), time, timeZone);
}

export function hoursBetween(clockIn: Date | null, clockOut: Date | null): number | null {
  if (!clockIn || !clockOut) return null;
  const start = clockIn.getTime();
  let end = clockOut.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  // Night shifts: an end at or before the start rolls over to the next day.
  if (end <= start) end += 24 * 60 * 60 * 1000;
  return Math.round(((end - start) / (1000 * 60 * 60)) * 100) / 100;
}

/** Default clock in/out/hours for a shift type, or all-null when the type is unknown. */
export function defaultShiftClockTimes(
  workDate: string,
  shiftType: "day" | "night" | null,
  timeZone: string
): { clockIn: Date | null; clockOut: Date | null; hoursWorked: number | null } {
  if (!shiftType) return { clockIn: null, clockOut: null, hoursWorked: null };
  const clockIn = combineDateTimeInZone(workDate, defaultShiftTime(shiftType, "start"), timeZone);
  const clockOut = combineClockOutInZone(
    workDate,
    defaultShiftTime(shiftType, "end"),
    clockIn,
    timeZone
  );
  return { clockIn, clockOut, hoursWorked: hoursBetween(clockIn, clockOut) };
}

/**
 * Derive attendance status when a controller confirms a row. Controllers confirm who
 * worked / which shift / what times; the status itself is never chosen by hand.
 *
 * Port of `resolveAttendanceStatusOnApprove` in apps/web/lib/site-timesheet-utils.ts.
 */
export function resolveAttendanceStatusOnConfirm(input: {
  plannedGuardId: string | null;
  actualGuardId: string | null;
  plannedShiftCode: string | null;
  actualShiftCode: string | null;
  actualShiftType: string | null;
  clockIn: Date | string | null;
  clockOut: Date | string | null;
}): SiteTimesheetAttendance {
  if (input.actualShiftCode === "R") return "reliever";
  if (input.actualShiftCode === "L") return "leave";
  if (input.actualShiftCode === "SL") return "sick_leave";
  if (input.actualShiftCode === "TR") return "training";
  if (input.actualShiftCode === "O" || input.actualShiftCode === "blank") return "off";

  const noWorkRecorded =
    input.actualGuardId === null &&
    (input.actualShiftType === null || input.actualShiftType === "") &&
    !input.clockIn &&
    !input.clockOut;

  if (
    (input.plannedShiftCode === "O" || input.plannedShiftCode === "blank") &&
    noWorkRecorded
  ) {
    return "off";
  }

  if (
    input.plannedGuardId &&
    input.actualGuardId &&
    input.plannedGuardId !== input.actualGuardId
  ) {
    return "shift_swapped";
  }

  if (noWorkRecorded) return "absent";

  return "present";
}

export type ConfirmAsScheduledPatch = {
  /** Kept exported: the bulk path projects these fields onto rows to re-check discrepancies. */
  actualGuardId: string;
  actualShiftType: "day" | "night";
  actualShiftCode: "D" | "N";
  clockIn: Date;
  clockOut: Date;
  hoursWorked: number;
  attendanceStatus: SiteTimesheetAttendance;
};

/**
 * Build the full "worked exactly as scheduled" patch for a row.
 *
 * Returns null when the row cannot be confirmed as scheduled — no planned guard, or no
 * resolvable shift type. Callers MUST treat null as a hard rejection and never fall back
 * to a default shift: `aggregateTimesheets` and `findSitesNeedingApproval` de-duplicate
 * raw `Shift` records against timesheet rows using `siteId:guard:date:actualShiftType`,
 * so a null shift type produces the key `...:unknown`, stops suppressing the raw shift,
 * and the hours are then counted twice.
 */
export function buildConfirmAsScheduledPatch(
  row: {
    workDate: Date | string;
    plannedGuardId: string | null;
    plannedShiftType: string | null;
    plannedShiftCode: string | null;
  },
  timeZone: string
): ConfirmAsScheduledPatch | null {
  if (!row.plannedGuardId) return null;

  const shiftType = normalizeShiftType(row.plannedShiftType ?? row.plannedShiftCode);
  if (!shiftType) return null;

  const workDate =
    typeof row.workDate === "string" ? row.workDate.slice(0, 10) : row.workDate.toISOString().slice(0, 10);
  const { clockIn, clockOut, hoursWorked } = defaultShiftClockTimes(workDate, shiftType, timeZone);
  if (!clockIn || !clockOut || hoursWorked == null) return null;

  const actualShiftCode = shiftType === "night" ? "N" : "D";

  return {
    actualGuardId: row.plannedGuardId,
    actualShiftType: shiftType,
    actualShiftCode,
    clockIn,
    clockOut,
    hoursWorked,
    attendanceStatus: resolveAttendanceStatusOnConfirm({
      plannedGuardId: row.plannedGuardId,
      actualGuardId: row.plannedGuardId,
      plannedShiftCode: row.plannedShiftCode,
      actualShiftCode,
      actualShiftType: shiftType,
      clockIn,
      clockOut,
    }),
  };
}
