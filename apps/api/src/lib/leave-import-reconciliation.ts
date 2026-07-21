import type { LeaveApplicationStatus } from "@prisma/client";

type PlannedLegacyRow = {
  id: string;
  employeeId: string;
  date: Date;
};

type ExistingLeaveApplication = {
  id: string;
  employeeId: string;
  startDate: Date;
  endDate: Date;
  status: LeaveApplicationStatus;
};

export type ExistingApplicationConflict = {
  sourceId: string;
  employeeId: string;
  date: string;
  applicationId: string;
  applicationStatus: LeaveApplicationStatus;
};

type LegacyRowForValidation = {
  source: "request" | "record";
  id: string;
  hours: unknown;
  status?: string;
};

export type InvalidLegacyRow = {
  source: "request" | "record";
  id: string;
  issues: string[];
};

const TERMINAL_APPLICATION_STATUSES = new Set<LeaveApplicationStatus>([
  "REJECTED",
  "WITHDRAWN",
  "CANCELLED",
  "EXPIRED",
]);

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

export function findExistingApplicationConflicts(
  plannedRows: PlannedLegacyRow[],
  existingApplications: ExistingLeaveApplication[]
): ExistingApplicationConflict[] {
  return plannedRows.flatMap((row) =>
    existingApplications
      .filter(
        (application) =>
          application.employeeId === row.employeeId &&
          !TERMINAL_APPLICATION_STATUSES.has(application.status) &&
          application.startDate <= row.date &&
          application.endDate >= row.date
      )
      .map((application) => ({
        sourceId: row.id,
        employeeId: row.employeeId,
        date: dateKey(row.date),
        applicationId: application.id,
        applicationStatus: application.status,
      }))
  );
}

export function legacyImportIdempotencyKey(input: { requestId?: string; recordId?: string }): string {
  if (input.requestId) return `legacy-request:${input.requestId}`;
  if (input.recordId) return `legacy-record:${input.recordId}`;
  throw new Error("A legacy request or record ID is required for an import idempotency key.");
}

export function findInvalidLegacyRows(rows: LegacyRowForValidation[]): InvalidLegacyRow[] {
  return rows.flatMap((row) => {
    const issues: string[] = [];
    const minutes = Math.round(Number(row.hours) * 60);
    if (!Number.isFinite(minutes) || minutes <= 0) issues.push("hours must round to at least one minute");
    if (row.source === "request" && !["pending", "approved", "rejected"].includes(row.status ?? "")) {
      issues.push(`unsupported request status: ${row.status || "<empty>"}`);
    }
    return issues.length ? [{ source: row.source, id: row.id, issues }] : [];
  });
}
