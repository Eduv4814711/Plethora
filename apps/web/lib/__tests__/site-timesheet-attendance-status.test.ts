import { describe, expect, it } from "vitest";
import { resolveAttendanceStatusOnApprove } from "../site-timesheet-utils";

describe("resolveAttendanceStatusOnApprove", () => {
  it("marks present when a guard worked a day/night shift", () => {
    expect(
      resolveAttendanceStatusOnApprove({
        plannedGuardId: "g1",
        actualGuardId: "g1",
        plannedShiftCode: "D",
        actualShiftCode: "D",
        actualShiftType: "day",
        clockIn: "2026-07-08T06:00:00.000Z",
        clockOut: "2026-07-08T18:00:00.000Z",
      })
    ).toBe("present");
  });

  it("marks absent when nobody worked a rostered shift", () => {
    expect(
      resolveAttendanceStatusOnApprove({
        plannedGuardId: "g1",
        actualGuardId: null,
        plannedShiftCode: "D",
        actualShiftCode: null,
        actualShiftType: null,
        clockIn: null,
        clockOut: null,
      })
    ).toBe("absent");
  });

  it("marks shift_swapped when a different guard worked", () => {
    expect(
      resolveAttendanceStatusOnApprove({
        plannedGuardId: "g1",
        actualGuardId: "g2",
        plannedShiftCode: "D",
        actualShiftCode: "D",
        actualShiftType: "day",
        clockIn: "2026-07-08T06:00:00.000Z",
        clockOut: "2026-07-08T18:00:00.000Z",
      })
    ).toBe("shift_swapped");
  });

  it("marks reliever when actual shift code is R", () => {
    expect(
      resolveAttendanceStatusOnApprove({
        plannedGuardId: "g1",
        actualGuardId: "g2",
        plannedShiftCode: "D",
        actualShiftCode: "R",
        actualShiftType: "day",
        clockIn: null,
        clockOut: null,
      })
    ).toBe("reliever");
  });

  it("marks leave / sick_leave / training from shift codes", () => {
    expect(
      resolveAttendanceStatusOnApprove({
        plannedGuardId: "g1",
        actualGuardId: "g1",
        plannedShiftCode: "L",
        actualShiftCode: "L",
      })
    ).toBe("leave");
    expect(
      resolveAttendanceStatusOnApprove({
        plannedGuardId: "g1",
        actualGuardId: "g1",
        plannedShiftCode: "SL",
        actualShiftCode: "SL",
      })
    ).toBe("sick_leave");
    expect(
      resolveAttendanceStatusOnApprove({
        plannedGuardId: "g1",
        actualGuardId: "g1",
        plannedShiftCode: "TR",
        actualShiftCode: "TR",
      })
    ).toBe("training");
  });

  it("marks off when there was no working roster", () => {
    expect(
      resolveAttendanceStatusOnApprove({
        plannedGuardId: null,
        actualGuardId: null,
        plannedShiftCode: "O",
        actualShiftCode: null,
        actualShiftType: null,
      })
    ).toBe("off");
  });
});
