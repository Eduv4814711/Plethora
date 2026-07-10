import { describe, expect, it } from "vitest";
import { computeSiteCaptureFromRows } from "../site-timesheets.service.js";

describe("computeSiteCaptureFromRows pending counts", () => {
  const base = {
    siteId: "site-1",
    siteName: "Test Site",
    timesheetStatus: "draft" as const,
  };

  it("counts pending day and night rows independently", () => {
    const result = computeSiteCaptureFromRows({
      ...base,
      rows: [
        {
          id: "r1",
          workDate: "2026-06-10",
          approvalStatus: "approved",
          plannedShiftType: "day",
        },
        {
          id: "r2",
          workDate: "2026-06-10",
          approvalStatus: "pending",
          plannedShiftType: "night",
        },
        {
          id: "r3",
          workDate: "2026-06-11",
          approvalStatus: "partially_reviewed",
          plannedShiftType: "day",
        },
      ],
      shiftType: "all",
    });

    expect(result.pendingDayRows).toBe(1);
    expect(result.pendingNightRows).toBe(1);
    expect(result.status).toBe("needs_capture");
  });

  it("does not count approved rows as pending for either shift", () => {
    const result = computeSiteCaptureFromRows({
      ...base,
      rows: [
        {
          id: "r1",
          workDate: "2026-06-10",
          approvalStatus: "approved",
          plannedShiftType: "day",
        },
        {
          id: "r2",
          workDate: "2026-06-10",
          approvalStatus: "approved",
          plannedShiftType: "night",
        },
      ],
      shiftType: "all",
    });

    expect(result.pendingDayRows).toBe(0);
    expect(result.pendingNightRows).toBe(0);
    expect(result.status).toBe("caught_up");
  });
});
