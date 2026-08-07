import { describe, expect, it } from "vitest";
import {
  buildConfirmAsScheduledPatch,
  combineClockOutInZone,
  combineDateTimeInZone,
  defaultShiftClockTimes,
  defaultShiftTime,
  hoursBetween,
  resolveAttendanceStatusOnConfirm,
} from "../site-timesheet-derive.js";

const SAST = "Africa/Johannesburg";

/**
 * Parity fixtures. These mirror apps/web/lib/__tests__/site-timesheet-attendance-status.test.ts —
 * the browser copy of this derivation decides the same `attendanceStatus`, and that status
 * decides whether payroll pays the row. If a case is added on one side, add it on the other.
 */
const statusCases: Array<{
  name: string;
  input: Parameters<typeof resolveAttendanceStatusOnConfirm>[0];
  expected: string;
}> = [
  {
    name: "reliever shift code wins over everything",
    input: {
      plannedGuardId: "g1",
      actualGuardId: "g2",
      plannedShiftCode: "D",
      actualShiftCode: "R",
      actualShiftType: "day",
      clockIn: new Date("2026-08-03T04:00:00Z"),
      clockOut: new Date("2026-08-03T16:00:00Z"),
    },
    expected: "reliever",
  },
  {
    name: "leave code",
    input: {
      plannedGuardId: "g1",
      actualGuardId: null,
      plannedShiftCode: "D",
      actualShiftCode: "L",
      actualShiftType: null,
      clockIn: null,
      clockOut: null,
    },
    expected: "leave",
  },
  {
    name: "sick leave code",
    input: {
      plannedGuardId: "g1",
      actualGuardId: null,
      plannedShiftCode: "D",
      actualShiftCode: "SL",
      actualShiftType: null,
      clockIn: null,
      clockOut: null,
    },
    expected: "sick_leave",
  },
  {
    name: "training code",
    input: {
      plannedGuardId: "g1",
      actualGuardId: null,
      plannedShiftCode: "D",
      actualShiftCode: "TR",
      actualShiftType: null,
      clockIn: null,
      clockOut: null,
    },
    expected: "training",
  },
  {
    name: "off code",
    input: {
      plannedGuardId: "g1",
      actualGuardId: null,
      plannedShiftCode: "D",
      actualShiftCode: "O",
      actualShiftType: null,
      clockIn: null,
      clockOut: null,
    },
    expected: "off",
  },
  {
    name: "planned off with nothing recorded stays off, not absent",
    input: {
      plannedGuardId: "g1",
      actualGuardId: null,
      plannedShiftCode: "O",
      actualShiftCode: null,
      actualShiftType: null,
      clockIn: null,
      clockOut: null,
    },
    expected: "off",
  },
  {
    name: "different guard than planned is a swap",
    input: {
      plannedGuardId: "g1",
      actualGuardId: "g2",
      plannedShiftCode: "D",
      actualShiftCode: "D",
      actualShiftType: "day",
      clockIn: new Date("2026-08-03T04:00:00Z"),
      clockOut: new Date("2026-08-03T16:00:00Z"),
    },
    expected: "shift_swapped",
  },
  {
    name: "rostered but nothing recorded is absent",
    input: {
      plannedGuardId: "g1",
      actualGuardId: null,
      plannedShiftCode: "D",
      actualShiftCode: null,
      actualShiftType: null,
      clockIn: null,
      clockOut: null,
    },
    expected: "absent",
  },
  {
    name: "same guard with times is present",
    input: {
      plannedGuardId: "g1",
      actualGuardId: "g1",
      plannedShiftCode: "D",
      actualShiftCode: "D",
      actualShiftType: "day",
      clockIn: new Date("2026-08-03T04:00:00Z"),
      clockOut: new Date("2026-08-03T16:00:00Z"),
    },
    expected: "present",
  },
  {
    name: "empty-string shift type counts as nothing recorded",
    input: {
      plannedGuardId: "g1",
      actualGuardId: null,
      plannedShiftCode: "D",
      actualShiftCode: null,
      actualShiftType: "",
      clockIn: null,
      clockOut: null,
    },
    expected: "absent",
  },
];

describe("resolveAttendanceStatusOnConfirm", () => {
  for (const testCase of statusCases) {
    it(testCase.name, () => {
      expect(resolveAttendanceStatusOnConfirm(testCase.input)).toBe(testCase.expected);
    });
  }
});

describe("defaultShiftTime", () => {
  it("maps day to 06:00-18:00 and night to 18:00-06:00", () => {
    expect(defaultShiftTime("day", "start")).toBe("06:00");
    expect(defaultShiftTime("day", "end")).toBe("18:00");
    expect(defaultShiftTime("night", "start")).toBe("18:00");
    expect(defaultShiftTime("night", "end")).toBe("06:00");
  });

  it("returns an empty string for an unknown shift type", () => {
    expect(defaultShiftTime(null, "start")).toBe("");
  });
});

describe("combineDateTimeInZone", () => {
  it("resolves wall-clock time in the company timezone, not the host zone", () => {
    // SAST is UTC+2 year-round, so 06:00 local is 04:00Z regardless of where this runs.
    expect(combineDateTimeInZone("2026-08-03", "06:00", SAST)?.toISOString()).toBe(
      "2026-08-03T04:00:00.000Z"
    );
    expect(combineDateTimeInZone("2026-08-03", "18:00", SAST)?.toISOString()).toBe(
      "2026-08-03T16:00:00.000Z"
    );
  });

  it("rejects malformed dates and times", () => {
    expect(combineDateTimeInZone("03-08-2026", "06:00", SAST)).toBeNull();
    expect(combineDateTimeInZone("2026-08-03", "6:00", SAST)).toBeNull();
    expect(combineDateTimeInZone("2026-08-03", "", SAST)).toBeNull();
  });
});

describe("combineClockOutInZone", () => {
  it("rolls a night-shift end over to the next day", () => {
    const clockIn = combineDateTimeInZone("2026-08-03", "18:00", SAST)!;
    const clockOut = combineClockOutInZone("2026-08-03", "06:00", clockIn, SAST);
    expect(clockOut?.toISOString()).toBe("2026-08-04T04:00:00.000Z");
  });

  it("leaves a day-shift end on the same day", () => {
    const clockIn = combineDateTimeInZone("2026-08-03", "06:00", SAST)!;
    const clockOut = combineClockOutInZone("2026-08-03", "18:00", clockIn, SAST);
    expect(clockOut?.toISOString()).toBe("2026-08-03T16:00:00.000Z");
  });

  it("rolls over across a month boundary", () => {
    const clockIn = combineDateTimeInZone("2026-08-31", "18:00", SAST)!;
    const clockOut = combineClockOutInZone("2026-08-31", "06:00", clockIn, SAST);
    expect(clockOut?.toISOString()).toBe("2026-09-01T04:00:00.000Z");
  });
});

describe("hoursBetween", () => {
  it("computes a 12-hour day shift", () => {
    expect(
      hoursBetween(new Date("2026-08-03T04:00:00Z"), new Date("2026-08-03T16:00:00Z"))
    ).toBe(12);
  });

  it("computes a 12-hour night shift spanning midnight", () => {
    expect(
      hoursBetween(new Date("2026-08-03T16:00:00Z"), new Date("2026-08-04T04:00:00Z"))
    ).toBe(12);
  });

  it("returns null when either end is missing", () => {
    expect(hoursBetween(null, new Date())).toBeNull();
    expect(hoursBetween(new Date(), null)).toBeNull();
  });
});

describe("defaultShiftClockTimes", () => {
  it("returns all nulls when the shift type is unknown", () => {
    expect(defaultShiftClockTimes("2026-08-03", null, SAST)).toEqual({
      clockIn: null,
      clockOut: null,
      hoursWorked: null,
    });
  });

  it("produces a 12-hour night shift", () => {
    const result = defaultShiftClockTimes("2026-08-03", "night", SAST);
    expect(result.clockIn?.toISOString()).toBe("2026-08-03T16:00:00.000Z");
    expect(result.clockOut?.toISOString()).toBe("2026-08-04T04:00:00.000Z");
    expect(result.hoursWorked).toBe(12);
  });
});

describe("buildConfirmAsScheduledPatch", () => {
  it("builds a complete patch for a rostered day shift", () => {
    const patch = buildConfirmAsScheduledPatch(
      {
        workDate: new Date("2026-08-03T00:00:00Z"),
        plannedGuardId: "g1",
        plannedShiftType: "day",
        plannedShiftCode: "D",
      },
      SAST
    );
    expect(patch).toMatchObject({
      actualGuardId: "g1",
      actualShiftType: "day",
      actualShiftCode: "D",
      hoursWorked: 12,
      attendanceStatus: "present",
    });
    expect(patch?.clockIn.toISOString()).toBe("2026-08-03T04:00:00.000Z");
    expect(patch?.clockOut.toISOString()).toBe("2026-08-03T16:00:00.000Z");
  });

  it("derives the shift type from the shift code when the type is absent", () => {
    const patch = buildConfirmAsScheduledPatch(
      {
        workDate: "2026-08-03",
        plannedGuardId: "g1",
        plannedShiftType: null,
        plannedShiftCode: "N",
      },
      SAST
    );
    expect(patch?.actualShiftType).toBe("night");
    expect(patch?.actualShiftCode).toBe("N");
  });

  it("returns null when there is no planned guard", () => {
    expect(
      buildConfirmAsScheduledPatch(
        {
          workDate: "2026-08-03",
          plannedGuardId: null,
          plannedShiftType: "day",
          plannedShiftCode: "D",
        },
        SAST
      )
    ).toBeNull();
  });

  // A null actualShiftType makes the payroll de-dupe key `...:unknown`, which stops
  // suppressing the raw Shift record and double-counts the hours. Never default to day.
  it("returns null rather than guessing when the shift type cannot be resolved", () => {
    expect(
      buildConfirmAsScheduledPatch(
        {
          workDate: "2026-08-03",
          plannedGuardId: "g1",
          plannedShiftType: null,
          plannedShiftCode: "R",
        },
        SAST
      )
    ).toBeNull();
  });
});
