import { describe, expect, it } from "vitest";
import type { SiteTimesheetRow } from "../roster-api";
import { isBulkConfirmable } from "../site-timesheet-row-patch";

function makeRow(overrides: Partial<SiteTimesheetRow> = {}): SiteTimesheetRow {
  return {
    id: "row-1",
    workDate: "2026-08-03",
    dayOfWeek: "Mon",
    plannedGuardId: "g1",
    plannedGuardName: "Thabo Nkosi",
    actualGuardId: null,
    actualGuardName: null,
    employeeNumber: "E-001",
    psiraRegistrationNumber: null,
    plannedShiftCode: "D",
    plannedShiftType: "day",
    actualShiftCode: null,
    actualShiftType: null,
    clockIn: null,
    clockOut: null,
    hoursWorked: null,
    overtimeHours: null,
    attendanceStatus: "pending",
    approvalStatus: "pending",
    dutyOnObNumber: null,
    dutyOffObNumber: null,
    occurrenceBookNumber: null,
    comments: null,
    discrepancyCodes: [],
    ...overrides,
  } as SiteTimesheetRow;
}

describe("isBulkConfirmable", () => {
  it("accepts a pending row that matches the roster", () => {
    expect(isBulkConfirmable(makeRow())).toBe(true);
  });

  it("accepts a row whose actual guard already equals the planned guard", () => {
    expect(isBulkConfirmable(makeRow({ actualGuardId: "g1" }))).toBe(true);
  });

  it("accepts a partially reviewed row so a saved Duty ON does not exclude it", () => {
    expect(isBulkConfirmable(makeRow({ approvalStatus: "partially_reviewed" }))).toBe(true);
  });

  it("rejects rows that are already confirmed or approved", () => {
    expect(isBulkConfirmable(makeRow({ approvalStatus: "reviewed" }))).toBe(false);
    expect(isBulkConfirmable(makeRow({ approvalStatus: "approved" }))).toBe(false);
  });

  it("rejects a row where someone else worked", () => {
    expect(isBulkConfirmable(makeRow({ actualGuardId: "g2" }))).toBe(false);
  });

  it("rejects an unrostered row", () => {
    expect(isBulkConfirmable(makeRow({ plannedGuardId: null }))).toBe(false);
  });

  it("rejects a row with no resolvable day or night shift", () => {
    expect(
      isBulkConfirmable(makeRow({ plannedShiftType: null, plannedShiftCode: "R" }))
    ).toBe(false);
  });

  it("rejects a row carrying a row-level discrepancy", () => {
    expect(
      isBulkConfirmable(makeRow({ discrepancyCodes: ["ROSTERED_NOT_WORKED"] }))
    ).toBe(false);
  });

  // A date-level shortfall says something about the day, not about this guard, so it must
  // not stop the people who did turn up from being confirmed together.
  it("still accepts a row when the only issue is a coverage shortfall on that date", () => {
    expect(
      isBulkConfirmable(makeRow({ discrepancyCodes: ["DAY_COVERAGE_SHORT"] }))
    ).toBe(true);
    expect(
      isBulkConfirmable(makeRow({ discrepancyCodes: ["NIGHT_COVERAGE_SHORT"] }))
    ).toBe(true);
  });
});
