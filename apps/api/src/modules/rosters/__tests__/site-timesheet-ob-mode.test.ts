import { describe, expect, it } from "vitest";
import { parseLabourComplianceSettings, resolveSiteObBookMode, resolveSitePsiraMode } from "../../../lib/sa-labour-rules.config.js";
import { rowNeedsObNumbers, rowRequiresObNumbers } from "../site-timesheets.service.js";
import { siteTimesheetRowCreateSchema } from "../rosters.schemas.js";

describe("Configurable Occurrence Book (OB) Mode & PSIRA Mode", () => {
  it("defaults company and site OB mode to REQUIRED for backwards compatibility", () => {
    expect(parseLabourComplianceSettings(null).obBookMode).toBe("REQUIRED");
    expect(resolveSiteObBookMode(undefined, undefined)).toBe("REQUIRED");
    expect(resolveSiteObBookMode({ obBookMode: "OPTIONAL" }, null)).toBe("OPTIONAL");
    expect(resolveSiteObBookMode({ obBookMode: "OPTIONAL" }, "REQUIRED")).toBe("REQUIRED");
    expect(resolveSitePsiraMode({ psiraEnforcementMode: "BLOCK" }, null)).toBe("BLOCK");
  });

  it("requires OB numbers under REQUIRED, waives only digital capture under OPTIONAL_WHEN_DIGITAL, and waives all under OPTIONAL", () => {
    expect(rowNeedsObNumbers("present")).toBe(true);
    expect(rowNeedsObNumbers("off")).toBe(false);

    expect(
      rowRequiresObNumbers({
        attendanceStatus: "present",
        obBookMode: "REQUIRED",
        clockIn: "2026-04-13T04:00:00.000Z",
        clockOut: "2026-04-13T16:00:00.000Z",
        sourceAttendanceId: "att-1",
      }),
    ).toBe(true);

    expect(
      rowRequiresObNumbers({
        attendanceStatus: "present",
        obBookMode: "OPTIONAL_WHEN_DIGITAL",
        clockIn: "2026-04-13T04:00:00.000Z",
        clockOut: "2026-04-13T16:00:00.000Z",
      }),
    ).toBe(false);

    expect(
      rowRequiresObNumbers({
        attendanceStatus: "present",
        obBookMode: "OPTIONAL_WHEN_DIGITAL",
        clockIn: null,
        clockOut: null,
        sourceAttendanceId: null,
      }),
    ).toBe(true);

    expect(
      rowRequiresObNumbers({
        attendanceStatus: "present",
        obBookMode: "OPTIONAL",
        clockIn: null,
        clockOut: null,
      }),
    ).toBe(false);
  });

  it("allows siteTimesheetRowCreateSchema payloads without OB numbers so service enforces per-site mode", () => {
    const parsed = siteTimesheetRowCreateSchema.safeParse({
      workDate: "2026-04-13",
      actualGuardId: "emp_1",
      actualShiftCode: "D",
      actualShiftType: "day",
      attendanceStatus: "present",
      hoursWorked: 12,
    });
    expect(parsed.success).toBe(true);
  });
});
