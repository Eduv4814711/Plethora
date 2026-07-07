import { addDays } from "date-fns";
import type { SiteRosterShiftCode } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const MAX_LEAVE_RANGE_DAYS = 366;

export function normalizeLeaveDate(input: string | Date): Date {
  const key =
    typeof input === "string"
      ? input.slice(0, 10)
      : input.toISOString().slice(0, 10);
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
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

  const records = await prisma.$transaction(
    dates.map((date) =>
      prisma.leaveRecord.create({
        data: {
          employeeId: params.employeeId,
          date,
          type: params.type,
          hours: params.hours,
        },
      })
    )
  );

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

  const start = normalizeLeaveDate(params.startDate);
  const end = normalizeLeaveDate(params.endDate);

  const result = await prisma.leaveRecord.deleteMany({
    where: {
      employeeId: params.employeeId,
      type: params.type,
      date: { gte: start, lte: end },
    },
  });

  return result.count;
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

  const { dates } = validateLeaveDateRange(params.newStartDate, params.newEndDate);
  const oldStart = normalizeLeaveDate(params.startDate);
  const oldEnd = normalizeLeaveDate(params.endDate);

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

    return Promise.all(
      dates.map((date) =>
        tx.leaveRecord.create({
          data: {
            employeeId: params.employeeId,
            date,
            type: params.newType,
            hours: params.hours,
          },
        })
      )
    );
  });

  return { records, days: dates.length };
}
