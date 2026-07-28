import { addDays } from "date-fns";
import type { SiteRosterShiftCode } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { reconcileContinuityForEmployee } from "../modules/rosters/roster-continuity.service.js";

const MAX_LEAVE_RANGE_DAYS = 366;

export function normalizeLeaveDate(input: string | Date): Date {
  if (input instanceof Date && !Number.isFinite(input.getTime())) {
    throw new LeaveAvailabilityError("Invalid leave date");
  }
  const key = typeof input === "string" ? input.slice(0, 10) : input.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new LeaveAvailabilityError("Leave dates must use YYYY-MM-DD format");
  }
  const [year, month, day] = key.split("-").map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (normalized.toISOString().slice(0, 10) !== key) {
    throw new LeaveAvailabilityError(`Invalid leave date: ${key}`);
  }
  return normalized;
}

export function formatLeaveDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive calendar days from start through end. */
export function enumerateLeaveDates(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  let cursor = normalizeLeaveDate(start);
  const last = normalizeLeaveDate(end);
  while (cursor <= last) {
    dates.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function leaveTypeToRosterShiftCode(type: string): SiteRosterShiftCode {
  return type === "sick" ? "SL" : "L";
}

export function validateLeaveDateRange(startInput: string, endInput?: string): {
  start: Date;
  end: Date;
  dates: Date[];
} {
  const start = normalizeLeaveDate(startInput);
  const end = endInput ? normalizeLeaveDate(endInput) : start;
  if (end < start) {
    throw new LeaveAvailabilityError("End date must be on or after start date");
  }
  const dates = enumerateLeaveDates(start, end);
  if (dates.length > MAX_LEAVE_RANGE_DAYS) {
    throw new LeaveAvailabilityError(
      `Leave range cannot exceed ${MAX_LEAVE_RANGE_DAYS} days`
    );
  }
  return { start, end, dates };
}

export class LeaveAvailabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaveAvailabilityError";
  }
}

export async function isEmployeeOnLeave(employeeId: string, date: Date): Promise<boolean> {
  const day = normalizeLeaveDate(date);
  const record = await prisma.leaveRecord.findFirst({
    where: { employeeId, date: day },
    select: { id: true },
  });
  return record != null;
}

/** Map employeeId -> set of yyyy-MM-dd keys with approved leave in the window. */
export async function getLeaveDateKeysByEmployee(
  employeeIds: string[],
  startDate: Date,
  endDate: Date
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (employeeIds.length === 0) return result;

  const start = normalizeLeaveDate(startDate);
  const end = normalizeLeaveDate(endDate);

  const records = await prisma.leaveRecord.findMany({
    where: {
      employeeId: { in: employeeIds },
      date: { gte: start, lte: end },
    },
    select: { employeeId: true, date: true },
  });

  for (const record of records) {
    const key = formatLeaveDateKey(normalizeLeaveDate(record.date));
    const set = result.get(record.employeeId) ?? new Set<string>();
    set.add(key);
    result.set(record.employeeId, set);
  }
  return result;
}

export async function createLeaveRecordsForRange(params: {
  employeeId: string;
  startDate: string;
  endDate?: string;
  type: string;
  hours: number;
}): Promise<{ records: Awaited<ReturnType<typeof prisma.leaveRecord.create>>[]; days: number }> {
  const { start, end, dates } = validateLeaveDateRange(params.startDate, params.endDate);

  const records = await prisma.$transaction(async (tx) => {
    const existing = await tx.leaveRecord.findMany({
      where: {
        employeeId: params.employeeId,
        date: { gte: start, lte: end },
      },
      select: { date: true },
      orderBy: { date: "asc" },
    });
    if (existing.length > 0) {
      const dates = existing.map((record) => formatLeaveDateKey(record.date));
      const preview = dates.slice(0, 3).join(", ");
      const suffix = dates.length > 3 ? ` and ${dates.length - 3} more` : "";
      throw new LeaveAvailabilityError(
        `Leave already exists for this employee on ${preview}${suffix}`
      );
    }

    return tx.leaveRecord.createManyAndReturn({
      data: dates.map((date) => ({
        employeeId: params.employeeId,
        date,
        type: params.type,
        hours: params.hours,
      })),
    });
  });

  await reconcileContinuityForEmployee(params.employeeId, undefined, "leave_created").catch(() => undefined);

  return { records, days: dates.length };
}

export async function deleteLeaveRecordsForRange(params: {
  companyId: string;
  employeeId: string;
  type: string;
  startDate: string;
  endDate: string;
}): Promise<number> {
  const employee = await prisma.employee.findFirst({
    where: { id: params.employeeId, companyId: params.companyId },
    select: { id: true },
  });
  if (!employee) {
    throw new LeaveAvailabilityError("Employee not found");
  }

  const { start, end } = validateLeaveDateRange(params.startDate, params.endDate);

  const result = await prisma.leaveRecord.deleteMany({
    where: {
      employeeId: params.employeeId,
      type: params.type,
      date: { gte: start, lte: end },
    },
  });

  await reconcileContinuityForEmployee(params.employeeId, params.companyId, "leave_deleted").catch(() => undefined);

  return result.count;
}

/**
 * Resolve a duplicated legacy leave day, either by collapsing it to one row or by
 * removing the day outright.
 *
 * Payroll blocks any employee-day holding more than one legacy LeaveRecord with no
 * authoritative occurrence, because timesheet aggregation sums rows that differ and
 * would pay the day twice. Deleting by range is not a remedy for the first case — it
 * removes every row — so keeping a row has to name it explicitly.
 *
 * Omit `keepRecordId` to delete every row for the day, for imports that recorded leave
 * the employee never took.
 */
export async function resolveDuplicateLeaveDay(params: {
  companyId: string;
  employeeId: string;
  date: string;
  keepRecordId?: string | null;
}): Promise<{ kept: string | null; deleted: string[] }> {
  const employee = await prisma.employee.findFirst({
    where: { id: params.employeeId, companyId: params.companyId },
    select: { id: true },
  });
  if (!employee) {
    throw new LeaveAvailabilityError("Employee not found");
  }

  const day = normalizeLeaveDate(params.date);

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.leaveRecord.findMany({
      where: { employeeId: params.employeeId, date: day },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) {
      throw new LeaveAvailabilityError("No leave records found for this employee and date");
    }
    if (rows.length === 1) {
      throw new LeaveAvailabilityError(
        "This day already has a single leave record — nothing to resolve"
      );
    }
    if (params.keepRecordId != null && !rows.some((row) => row.id === params.keepRecordId)) {
      throw new LeaveAvailabilityError(
        "The record to keep does not belong to this employee and date"
      );
    }

    const keepRecordId = params.keepRecordId ?? null;
    const toDelete = rows.filter((row) => row.id !== keepRecordId).map((row) => row.id);
    await tx.leaveRecord.deleteMany({ where: { id: { in: toDelete } } });
    return { kept: keepRecordId, deleted: toDelete };
  });

  await reconcileContinuityForEmployee(
    params.employeeId,
    params.companyId,
    "leave_duplicates_resolved"
  ).catch(() => undefined);

  return result;
}

export async function replaceLeaveRecordRange(params: {
  companyId: string;
  employeeId: string;
  type: string;
  startDate: string;
  endDate: string;
  newStartDate: string;
  newEndDate?: string;
  newType: string;
  hours: number;
}): Promise<{ records: Awaited<ReturnType<typeof prisma.leaveRecord.create>>[]; days: number }> {
  const employee = await prisma.employee.findFirst({
    where: { id: params.employeeId, companyId: params.companyId },
    select: { id: true },
  });
  if (!employee) {
    throw new LeaveAvailabilityError("Employee not found");
  }

  const { start: newStart, end: newEnd, dates } = validateLeaveDateRange(
    params.newStartDate,
    params.newEndDate
  );
  const { start: oldStart, end: oldEnd } = validateLeaveDateRange(
    params.startDate,
    params.endDate
  );

  const records = await prisma.$transaction(async (tx) => {
    const deleted = await tx.leaveRecord.deleteMany({
      where: {
        employeeId: params.employeeId,
        type: params.type,
        date: { gte: oldStart, lte: oldEnd },
      },
    });
    if (deleted.count === 0) {
      throw new LeaveAvailabilityError("Leave record not found");
    }

    const conflicts = await tx.leaveRecord.findMany({
      where: {
        employeeId: params.employeeId,
        date: { gte: newStart, lte: newEnd },
      },
      select: { date: true },
      orderBy: { date: "asc" },
    });
    if (conflicts.length > 0) {
      const conflictDate = formatLeaveDateKey(conflicts[0]!.date);
      throw new LeaveAvailabilityError(
        `Leave already exists for this employee on ${conflictDate}`
      );
    }

    return tx.leaveRecord.createManyAndReturn({
      data: dates.map((date) => ({
        employeeId: params.employeeId,
        date,
        type: params.newType,
        hours: params.hours,
      })),
    });
  });

  await reconcileContinuityForEmployee(params.employeeId, params.companyId, "leave_changed").catch(() => undefined);

  return { records, days: dates.length };
}
