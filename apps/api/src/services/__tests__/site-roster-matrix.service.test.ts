import { describe, expect, it } from "vitest";
import { cellForEmployeeDay, isMissedShift } from "../site-roster-matrix.service.js";

const emp = (id: string) => ({
  id,
  firstName: "A",
  lastName: "B",
  gender: "M" as string | null,
  phone: null as string | null,
});

function shift(partial: {
  id: string;
  employeeId: string;
  startTime: Date;
  endTime: Date;
  status: string;
  supersededEmployeeIds?: string[];
  shiftType?: string | null;
  attendances?: { clockIn: Date | null }[];
}): Parameters<typeof cellForEmployeeDay>[1][number] {
  return {
    id: partial.id,
    employeeId: partial.employeeId,
    startTime: partial.startTime,
    endTime: partial.endTime,
    status: partial.status,
    supersededEmployeeIds: partial.supersededEmployeeIds ?? [],
    post: { shiftType: partial.shiftType ?? "day" },
    employee: emp(partial.employeeId),
    attendances: partial.attendances ?? [],
  };
}

describe("site-roster-matrix.service", () => {
  const pastEnd = new Date("2020-01-01T12:00:00.000Z");
  const futureEnd = new Date("2099-01-01T12:00:00.000Z");
  const now = new Date("2025-06-15T12:00:00.000Z");

  it("isMissedShift matches ended assigned shift with no clock-in", () => {
    const s = shift({
      id: "1",
      employeeId: "e1",
      startTime: new Date("2025-06-14T06:00:00.000Z"),
      endTime: pastEnd,
      status: "assigned",
      attendances: [],
    });
    expect(isMissedShift(s, now)).toBe(true);
  });

  it("isMissedShift is false for future shift", () => {
    const s = shift({
      id: "1",
      employeeId: "e1",
      startTime: new Date("2025-06-15T06:00:00.000Z"),
      endTime: futureEnd,
      status: "assigned",
      attendances: [],
    });
    expect(isMissedShift(s, now)).toBe(false);
  });

  it("isMissedShift is false when clock-in exists", () => {
    const s = shift({
      id: "1",
      employeeId: "e1",
      startTime: new Date("2025-06-14T06:00:00.000Z"),
      endTime: pastEnd,
      status: "assigned",
      attendances: [{ clockIn: new Date("2025-06-14T06:05:00.000Z") }],
    });
    expect(isMissedShift(s, now)).toBe(false);
  });

  it("cellForEmployeeDay returns D for day post", () => {
    const s = shift({
      id: "1",
      employeeId: "e1",
      startTime: new Date("2025-06-14T06:00:00.000Z"),
      endTime: futureEnd,
      status: "assigned",
      shiftType: "day",
    });
    expect(cellForEmployeeDay("e1", [s], now)).toBe("D");
  });

  it("cellForEmployeeDay returns N for night post", () => {
    const s = shift({
      id: "1",
      employeeId: "e1",
      startTime: new Date("2025-06-14T06:00:00.000Z"),
      endTime: futureEnd,
      status: "assigned",
      shiftType: "night",
    });
    expect(cellForEmployeeDay("e1", [s], now)).toBe("N");
  });

  it("cellForEmployeeDay returns A for missed current assignee", () => {
    const s = shift({
      id: "1",
      employeeId: "e1",
      startTime: new Date("2025-06-14T06:00:00.000Z"),
      endTime: pastEnd,
      status: "assigned",
      shiftType: "day",
      attendances: [],
    });
    expect(cellForEmployeeDay("e1", [s], now)).toBe("A");
  });

  it("cellForEmployeeDay returns R for superseded employee without current shift", () => {
    const s = shift({
      id: "1",
      employeeId: "e2",
      startTime: new Date("2025-06-14T06:00:00.000Z"),
      endTime: futureEnd,
      status: "assigned",
      supersededEmployeeIds: ["e1"],
      shiftType: "day",
    });
    expect(cellForEmployeeDay("e1", [s], now)).toBe("R");
    expect(cellForEmployeeDay("e2", [s], now)).toBe("D");
  });

  it("current assignee wins over superseded when same employee has both roles (only current applies)", () => {
    const s = shift({
      id: "1",
      employeeId: "e1",
      startTime: new Date("2025-06-14T06:00:00.000Z"),
      endTime: futureEnd,
      status: "assigned",
      supersededEmployeeIds: ["e1"],
      shiftType: "day",
    });
    expect(cellForEmployeeDay("e1", [s], now)).toBe("D");
  });

  it("multi-hop superseded: original guard shows R", () => {
    const s = shift({
      id: "1",
      employeeId: "e3",
      startTime: new Date("2025-06-14T06:00:00.000Z"),
      endTime: futureEnd,
      status: "assigned",
      supersededEmployeeIds: ["e1", "e2"],
      shiftType: "night",
    });
    expect(cellForEmployeeDay("e1", [s], now)).toBe("R");
    expect(cellForEmployeeDay("e2", [s], now)).toBe("R");
    expect(cellForEmployeeDay("e3", [s], now)).toBe("N");
  });

  it("combines D+N when two assignments same day", () => {
    const dayS = shift({
      id: "1",
      employeeId: "e1",
      startTime: new Date("2025-06-14T06:00:00.000Z"),
      endTime: futureEnd,
      status: "assigned",
      shiftType: "day",
    });
    const nightS = shift({
      id: "2",
      employeeId: "e1",
      startTime: new Date("2025-06-14T18:00:00.000Z"),
      endTime: futureEnd,
      status: "assigned",
      shiftType: "night",
    });
    expect(cellForEmployeeDay("e1", [dayS, nightS], now)).toBe("D+N");
  });

  it("returns O when no shifts", () => {
    expect(cellForEmployeeDay("e1", [], now)).toBe("O");
  });
});
