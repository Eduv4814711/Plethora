import { describe, expect, it } from "vitest";
import {
  findExistingApplicationConflicts,
  findInvalidLegacyRows,
  legacyImportIdempotencyKey,
} from "../leave-import-reconciliation.js";

describe("leave import reconciliation safeguards", () => {
  it("blocks a pending legacy row that falls within an existing active application", () => {
    const conflicts = findExistingApplicationConflicts(
      [{ id: "record:record-1", employeeId: "employee-1", date: new Date("2026-07-15T00:00:00.000Z") }],
      [{
        id: "application-1",
        employeeId: "employee-1",
        startDate: new Date("2026-07-14T00:00:00.000Z"),
        endDate: new Date("2026-07-16T00:00:00.000Z"),
        status: "APPROVED",
      }]
    );

    expect(conflicts).toEqual([{
      sourceId: "record:record-1",
      employeeId: "employee-1",
      date: "2026-07-15",
      applicationId: "application-1",
      applicationStatus: "APPROVED",
    }]);
  });

  it("ignores terminal, other-employee, and out-of-range applications", () => {
    const row = { id: "request:request-1", employeeId: "employee-1", date: new Date("2026-07-15T00:00:00.000Z") };
    expect(findExistingApplicationConflicts([row], [
      {
        id: "cancelled",
        employeeId: "employee-1",
        startDate: row.date,
        endDate: row.date,
        status: "CANCELLED",
      },
      {
        id: "other-employee",
        employeeId: "employee-2",
        startDate: row.date,
        endDate: row.date,
        status: "APPROVED",
      },
      {
        id: "other-date",
        employeeId: "employee-1",
        startDate: new Date("2026-07-16T00:00:00.000Z"),
        endDate: new Date("2026-07-16T00:00:00.000Z"),
        status: "APPROVED",
      },
    ])).toEqual([]);
  });

  it("uses a stable request key for matched or request-only imports", () => {
    expect(legacyImportIdempotencyKey({ requestId: "request-1", recordId: "record-1" }))
      .toBe("legacy-request:request-1");
  });

  it("uses a stable record key for record-only imports", () => {
    expect(legacyImportIdempotencyKey({ recordId: "record-1" })).toBe("legacy-record:record-1");
  });

  it("reports unsupported request statuses before import", () => {
    expect(findInvalidLegacyRows([{
      source: "request",
      id: "request-1",
      hours: "8.00",
      status: "cancelled",
    }])).toEqual([{
      source: "request",
      id: "request-1",
      issues: ["unsupported request status: cancelled"],
    }]);
  });

  it("reports non-positive and non-numeric hours before import", () => {
    expect(findInvalidLegacyRows([
      { source: "record", id: "record-zero", hours: 0 },
      { source: "record", id: "record-invalid", hours: "not-a-number" },
    ])).toEqual([
      { source: "record", id: "record-zero", issues: ["hours must round to at least one minute"] },
      { source: "record", id: "record-invalid", issues: ["hours must round to at least one minute"] },
    ]);
  });

  it("accepts the three supported request statuses and positive record hours", () => {
    expect(findInvalidLegacyRows([
      { source: "request", id: "pending", hours: "8.00", status: "pending" },
      { source: "request", id: "approved", hours: "8.00", status: "approved" },
      { source: "request", id: "rejected", hours: "8.00", status: "rejected" },
      { source: "record", id: "record", hours: "0.02" },
    ])).toEqual([]);
  });
});
