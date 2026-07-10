import { describe, expect, it } from "vitest";
import {
  CAPTURED_APPROVAL_STATUSES,
  ON_DUTY_ATTENDANCE_STATUSES,
} from "../dashboard-guards-on-duty.service.js";

describe("dashboard guards on duty semantics", () => {
  it("includes partially reviewed rows in captured approval statuses", () => {
    expect(CAPTURED_APPROVAL_STATUSES).toContain("partially_reviewed");
    expect(CAPTURED_APPROVAL_STATUSES).toContain("reviewed");
    expect(CAPTURED_APPROVAL_STATUSES).toContain("approved");
  });

  it("counts working attendance statuses for on-duty", () => {
    expect(ON_DUTY_ATTENDANCE_STATUSES).toContain("present");
    expect(ON_DUTY_ATTENDANCE_STATUSES).toContain("late");
    expect(ON_DUTY_ATTENDANCE_STATUSES).toContain("reliever");
    expect(ON_DUTY_ATTENDANCE_STATUSES).not.toContain("pending");
    expect(ON_DUTY_ATTENDANCE_STATUSES).not.toContain("off");
  });
});
