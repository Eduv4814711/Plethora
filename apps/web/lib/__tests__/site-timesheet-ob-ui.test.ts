import { describe, expect, it } from "vitest";
import { rowRequiresObInUi } from "../site-timesheet-utils";

describe("rowRequiresObInUi", () => {
  it("requires OB under REQUIRED mode for working statuses", () => {
    expect(rowRequiresObInUi({ attendanceStatus: "present", clockIn: "2026-04-01T06:00:00Z", clockOut: "2026-04-01T18:00:00Z" }, "REQUIRED")).toBe(true);
    expect(rowRequiresObInUi({ attendanceStatus: "off" }, "REQUIRED")).toBe(false);
    expect(rowRequiresObInUi({ attendanceStatus: "leave" }, "REQUIRED")).toBe(false);
  });

  it("waives OB requirement on digitally clocked rows under OPTIONAL_WHEN_DIGITAL", () => {
    expect(rowRequiresObInUi({ attendanceStatus: "present", clockIn: "2026-04-01T06:00:00Z", clockOut: "2026-04-01T18:00:00Z" }, "OPTIONAL_WHEN_DIGITAL")).toBe(false);
    expect(rowRequiresObInUi({ attendanceStatus: "present", clockIn: null, clockOut: null }, "OPTIONAL_WHEN_DIGITAL")).toBe(true);
  });

  it("waives OB requirement on all rows under OPTIONAL mode", () => {
    expect(rowRequiresObInUi({ attendanceStatus: "present", clockIn: null, clockOut: null }, "OPTIONAL")).toBe(false);
  });
});
