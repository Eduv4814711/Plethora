import { prisma } from "../lib/prisma.js";

export class LeaveAvailabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaveAvailabilityError";
  }
}

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

  const requests = await prisma.leaveRequest.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: "APPROVED",
      startDate: { lte: end },
      endDate: { gte: start },
    },
    select: { employeeId: true, startDate: true, endDate: true },
  });

  for (const request of requests) {
    const rangeStart = request.startDate > start ? request.startDate : start;
    const rangeEnd = request.endDate < end ? request.endDate : end;
    const set = result.get(request.employeeId) ?? new Set<string>();
    for (let cursor = normalizeLeaveDate(rangeStart); cursor <= rangeEnd; cursor = new Date(cursor.getTime() + 86_400_000)) {
      set.add(formatLeaveDateKey(cursor));
    }
    result.set(request.employeeId, set);
  }
  return result;
}
