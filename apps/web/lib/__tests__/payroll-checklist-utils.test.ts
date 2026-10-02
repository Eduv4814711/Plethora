import { describe, expect, it } from "vitest";
import {
  determineAttendanceBlockerState,
  buildPayrollWorkflowSteps,
} from "../payroll-checklist-utils";

describe("determineAttendanceBlockerState", () => {
  it("flags blocked when readiness has open exceptions", () => {
    const state = determineAttendanceBlockerState({
      payrollReadiness: {
        status: "PENDING_ATTENDANCE_REVIEW",
        openExceptions: 4,
        periodStart: "2026-08-26T00:00:00Z",
        periodEnd: "2026-09-25T23:59:59Z",
      },
    });

    expect(state.isAttendanceBlocked).toBe(true);
    expect(state.isAttendanceClear).toBe(false);
    expect(state.blockerCount).toBe(4);
    expect(state.attendanceBlockerMessage).toContain("4 attendance issues must be resolved");
    expect(state.attendanceBlockerHref).toContain("/attendance/exceptions?status=OPEN&severity=CRITICAL");
    expect(state.attendanceBlockerHref).toContain("start=2026-08-26");
    expect(state.attendanceBlockerHref).toContain("end=2026-09-25");
  });

  it("marks clear when readiness is READY and 0 open exceptions", () => {
    const state = determineAttendanceBlockerState({
      payrollReadiness: {
        status: "READY",
        openExceptions: 0,
      },
      pendingSiteTimesheetRows: 0,
    });

    expect(state.isAttendanceBlocked).toBe(false);
    expect(state.isAttendanceClear).toBe(true);
    expect(state.blockerCount).toBe(0);
    expect(state.attendanceBlockerMessage).toBeNull();
  });
});

describe("buildPayrollWorkflowSteps", () => {
  it("disables and marks Calculate step as blocked when attendance is blocked on a draft run", () => {
    const steps = buildPayrollWorkflowSteps({
      openRun: {
        id: "run-1",
        periodStart: "2026-08-26",
        periodEnd: "2026-09-25",
        status: "draft",
      },
      isAttendanceClear: false,
      isAttendanceBlocked: true,
      blockerCount: 2,
      attendanceBlockerHref: "/attendance/exceptions?status=OPEN",
    });

    expect(steps).toHaveLength(5);

    // Step 1: Attendance -> Blocked
    const step1 = steps[0];
    expect(step1.step).toBe(1);
    expect(step1.status).toBe("blocked");
    expect(step1.statusLabel).toBe("Blocked");
    expect(step1.href).toBe("/attendance/exceptions?status=OPEN");

    // Step 2: Create run -> Done
    const step2 = steps[1];
    expect(step2.step).toBe(2);
    expect(step2.status).toBe("done");

    // Step 3: Calculate -> Blocked
    const step3 = steps[2];
    expect(step3.step).toBe(3);
    expect(step3.status).toBe("blocked");
    expect(step3.statusLabel).toBe("Blocked");
    expect(step3.caption).toContain("Blocked until attendance is cleared");

    // Step 4: Approve -> Waiting
    expect(steps[3].status).toBe("waiting");

    // Step 5: Mark paid -> Waiting
    expect(steps[4].status).toBe("waiting");
  });

  it("marks Calculate step as ready when attendance is clear on a draft run", () => {
    const steps = buildPayrollWorkflowSteps({
      openRun: {
        id: "run-1",
        periodStart: "2026-08-26",
        periodEnd: "2026-09-25",
        status: "draft",
      },
      isAttendanceClear: true,
      isAttendanceBlocked: false,
      blockerCount: 0,
      attendanceBlockerHref: "/attendance",
    });

    // Step 1 -> Clear/Done
    expect(steps[0].status).toBe("done");
    expect(steps[0].statusLabel).toBe("Clear");

    // Step 2 -> Done
    expect(steps[1].status).toBe("done");

    // Step 3 -> Ready
    expect(steps[2].status).toBe("ready");
    expect(steps[2].statusLabel).toBe("Ready");
    expect(steps[2].caption).toContain("Ready to calculate wages");
  });

  it("advances steps to Done and Ready through calculation and approval lifecycle", () => {
    const calculatedSteps = buildPayrollWorkflowSteps({
      openRun: {
        id: "run-1",
        periodStart: "2026-08-26",
        periodEnd: "2026-09-25",
        status: "calculated",
      },
      isAttendanceClear: true,
      isAttendanceBlocked: false,
      blockerCount: 0,
      attendanceBlockerHref: "/attendance",
    });

    // Calculate is Done, Approve is Ready
    expect(calculatedSteps[2].status).toBe("done");
    expect(calculatedSteps[3].status).toBe("ready");
    expect(calculatedSteps[4].status).toBe("waiting");

    const approvedSteps = buildPayrollWorkflowSteps({
      openRun: {
        id: "run-1",
        periodStart: "2026-08-26",
        periodEnd: "2026-09-25",
        status: "approved",
      },
      isAttendanceClear: true,
      isAttendanceBlocked: false,
      blockerCount: 0,
      attendanceBlockerHref: "/attendance",
    });

    // Approve is Done, Mark paid is Ready
    expect(approvedSteps[3].status).toBe("done");
    expect(approvedSteps[4].status).toBe("ready");
  });
});
