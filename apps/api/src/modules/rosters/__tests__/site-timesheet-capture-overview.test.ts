import { describe, expect, it } from "vitest";
import {
  computeSiteCaptureFromRows,
  resolveRowShiftType,
  rowMatchesShiftTypeFilter,
} from "../site-timesheets.service.js";

describe("resolveRowShiftType / rowMatchesShiftTypeFilter", () => {
  it("prefers planned shift over actual", () => {
    expect(
      resolveRowShiftType({
        plannedShiftType: "day",
        plannedShiftCode: "D",
        actualShiftType: "night",
        actualShiftCode: "N",
      })
    ).toBe("day");
  });

  it("falls back to actual when planned is missing", () => {
    expect(
      resolveRowShiftType({
        plannedShiftType: null,
        plannedShiftCode: null,
        actualShiftType: "night",
        actualShiftCode: "N",
      })
    ).toBe("night");
  });

  it("normalizes D/N codes", () => {
    expect(resolveRowShiftType({ plannedShiftCode: "D" })).toBe("day");
    expect(resolveRowShiftType({ plannedShiftCode: "N" })).toBe("night");
  });

  it("matches filter for day/night/all", () => {
    const dayRow = { plannedShiftType: "day", plannedShiftCode: "D" };
    const nightRow = { plannedShiftType: "night", plannedShiftCode: "N" };
    expect(rowMatchesShiftTypeFilter(dayRow, "day")).toBe(true);
    expect(rowMatchesShiftTypeFilter(dayRow, "night")).toBe(false);
    expect(rowMatchesShiftTypeFilter(nightRow, "night")).toBe(true);
    expect(rowMatchesShiftTypeFilter(dayRow, "all")).toBe(true);
    expect(rowMatchesShiftTypeFilter(nightRow, "all")).toBe(true);
  });
});

describe("computeSiteCaptureFromRows (shift-aware needs attention)", () => {
  const dayPending = {
    workDate: "2026-07-08",
    approvalStatus: "pending",
    plannedShiftType: "day",
    plannedShiftCode: "D",
  };
  const nightPending = {
    workDate: "2026-07-08",
    approvalStatus: "pending",
    plannedShiftType: "night",
    plannedShiftCode: "N",
  };
  const dayReviewed = {
    workDate: "2026-07-08",
    approvalStatus: "reviewed",
    plannedShiftType: "day",
    plannedShiftCode: "D",
  };
  const nightReviewed = {
    workDate: "2026-07-08",
    approvalStatus: "reviewed",
    plannedShiftType: "night",
    plannedShiftCode: "N",
  };

  it("counts only day pending when shiftType=day", () => {
    const result = computeSiteCaptureFromRows({
      siteId: "site-1",
      siteName: "Control Room",
      timesheetStatus: "draft",
      rows: [dayPending, nightPending],
      shiftType: "day",
    });
    expect(result.status).toBe("needs_capture");
    expect(result.pendingRows).toBe(1);
    // Breakdown includes the other shift even when status is day-scoped.
    expect(result.pendingDayRows).toBe(1);
    expect(result.pendingNightRows).toBe(1);
    expect(result.reviewedRows).toBe(0);
    expect(result.dueDays).toBe(1);
  });

  it("does not flag day attention when only night is pending", () => {
    const result = computeSiteCaptureFromRows({
      siteId: "site-1",
      siteName: "Control Room",
      timesheetStatus: "draft",
      rows: [dayReviewed, nightPending],
      shiftType: "day",
    });
    expect(result.status).toBe("caught_up");
    expect(result.pendingRows).toBe(0);
    expect(result.pendingDayRows).toBe(0);
    expect(result.pendingNightRows).toBe(1);
    expect(result.reviewedRows).toBe(1);
    expect(result.lastCapturedDate).toBe("2026-07-08");
  });

  it("still flags night attention when day is approved", () => {
    const result = computeSiteCaptureFromRows({
      siteId: "site-1",
      siteName: "Control Room",
      timesheetStatus: "draft",
      rows: [dayReviewed, nightPending],
      shiftType: "night",
    });
    expect(result.status).toBe("needs_capture");
    expect(result.pendingRows).toBe(1);
    expect(result.pendingDayRows).toBe(0);
    expect(result.pendingNightRows).toBe(1);
    expect(result.reviewedRows).toBe(0);
  });

  it("aggregates day+night when shiftType=all", () => {
    const result = computeSiteCaptureFromRows({
      siteId: "site-1",
      siteName: "Control Room",
      timesheetStatus: "draft",
      rows: [dayReviewed, nightPending],
      shiftType: "all",
    });
    expect(result.status).toBe("needs_capture");
    expect(result.pendingRows).toBe(1);
    expect(result.pendingDayRows).toBe(0);
    expect(result.pendingNightRows).toBe(1);
    expect(result.reviewedRows).toBe(1);
  });

  it("returns no_shifts when site has only night rows under day filter", () => {
    const result = computeSiteCaptureFromRows({
      siteId: "site-1",
      siteName: "Night-only site",
      timesheetStatus: "draft",
      rows: [nightPending],
      shiftType: "day",
    });
    expect(result.status).toBe("no_shifts");
    expect(result.pendingRows).toBe(0);
    expect(result.reviewedRows).toBe(0);
  });

  it("marks caught_up when selected shift is fully reviewed", () => {
    const result = computeSiteCaptureFromRows({
      siteId: "site-1",
      siteName: "Control Room",
      timesheetStatus: "draft",
      rows: [dayReviewed, nightReviewed],
      shiftType: "day",
    });
    expect(result.status).toBe("caught_up");
    expect(result.pendingRows).toBe(0);
    expect(result.reviewedRows).toBe(1);
  });

  it("counts dueDays from distinct dates within the selected shift only", () => {
    const result = computeSiteCaptureFromRows({
      siteId: "site-1",
      siteName: "Control Room",
      timesheetStatus: "draft",
      rows: [
        { ...dayPending, workDate: "2026-07-07" },
        { ...dayPending, workDate: "2026-07-08" },
        { ...nightPending, workDate: "2026-07-09" },
      ],
      shiftType: "day",
    });
    expect(result.dueDays).toBe(2);
    expect(result.pendingRows).toBe(2);
  });
});
