import { describe, expect, it } from "vitest";
import {
  approveSiteTimesheetRowSchema,
  siteTimesheetRowCreateSchema,
  siteTimesheetRowUpdateSchema,
} from "../rosters.schemas.js";

describe("site timesheet row schemas", () => {
  it("does not allow approval state through the generic edit contract", () => {
    const parsed = siteTimesheetRowUpdateSchema.safeParse({
      comments: "ordinary edit",
      approvalStatus: "approved",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts row confirmation data through the dedicated contract", () => {
    const parsed = approveSiteTimesheetRowSchema.safeParse({
      clockIn: "2026-07-10T06:00:00.000Z",
      clockOut: "2026-07-10T18:00:00.000Z",
      hoursWorked: 12,
      overtimeHours: 2,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects reversed clocks and impossible hours", () => {
    expect(
      siteTimesheetRowUpdateSchema.safeParse({
        clockIn: "2026-07-10T18:00:00.000Z",
        clockOut: "2026-07-10T06:00:00.000Z",
      }).success
    ).toBe(false);
    expect(
      siteTimesheetRowCreateSchema.safeParse({
        workDate: "2026-07-10",
        actualGuardId: "guard-1",
        actualShiftCode: "D",
        actualShiftType: "day",
        attendanceStatus: "present",
        dutyOnObNumber: "100",
        hoursWorked: 25,
      }).success
    ).toBe(false);
  });
});
