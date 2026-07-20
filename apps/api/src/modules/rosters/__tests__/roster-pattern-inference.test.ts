import { describe, expect, it } from "vitest";
import type { SiteRosterShiftCode } from "@prisma/client";
import {
  inferRepeatingRosterPattern,
  inferRosterCalendarId,
  type RosterObservation,
} from "../roster-pattern-inference.js";

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function observationsFor(
  anchor: string,
  days: number,
  guards: { id: string; sequence: SiteRosterShiftCode[] }[]
): RosterObservation[] {
  return Array.from({ length: days }, (_, dayIndex) =>
    guards.map((guard) => ({
      guardId: guard.id,
      dateKey: addDays(anchor, dayIndex),
      shiftCode: guard.sequence[dayIndex % guard.sequence.length]!,
    }))
  ).flat();
}

describe("continuous roster pattern inference", () => {
  it("infers the shortest exact six-day repeating roster", () => {
    const rows = observationsFor("2026-06-26", 30, [
      { id: "day", sequence: ["D", "D", "D", "O", "O", "O"] },
      { id: "night", sequence: ["N", "N", "N", "O", "O", "O"] },
      { id: "relief", sequence: ["O", "O", "O", "D", "D", "D"] },
    ]);

    const result = inferRepeatingRosterPattern(rows);

    expect(result?.cycleLengthDays).toBe(6);
    expect(result?.confidencePercent).toBe(100);
    expect(result?.sourceStart).toBe("2026-06-26");
    expect(result?.sourceEnd).toBe("2026-07-25");
    expect(result?.guardsEvaluated).toBe(3);
  });

  it("infers a nine-day day/night/off rotation with guard offsets", () => {
    const rows = observationsFor("2026-06-26", 36, [
      { id: "a", sequence: ["D", "D", "D", "N", "N", "N", "O", "O", "O"] },
      { id: "b", sequence: ["N", "N", "N", "O", "O", "O", "D", "D", "D"] },
      { id: "c", sequence: ["O", "O", "O", "D", "D", "D", "N", "N", "N"] },
    ]);

    const result = inferRepeatingRosterPattern(rows);

    expect(result?.cycleLengthDays).toBe(9);
    expect(result?.confidencePercent).toBe(100);
    expect(result?.cells).toHaveLength(27);
  });

  it("uses confidence instead of failing when isolated historical exceptions exist", () => {
    const rows = observationsFor("2026-06-26", 30, [
      { id: "a", sequence: ["D", "D", "D", "O", "O", "O"] },
      { id: "b", sequence: ["N", "N", "N", "O", "O", "O"] },
    ]);
    rows.find((row) => row.guardId === "a" && row.dateKey === "2026-07-08")!.shiftCode = "L";

    const result = inferRepeatingRosterPattern(rows);

    expect(result?.cycleLengthDays).toBe(6);
    expect(result?.confidencePercent).toBeGreaterThanOrEqual(98);
  });

  it("requires two complete cycles", () => {
    const rows = observationsFor("2026-07-01", 5, [
      { id: "a", sequence: ["D", "D", "O", "O", "O", "O"] },
    ]);
    expect(inferRepeatingRosterPattern(rows)).toBeNull();
  });

  it("selects the matching site roster calendar", () => {
    const calendars = [
      { id: "pay", name: "Pay aligned", startDay: 26, endDay: 25 },
      { id: "month", name: "Calendar month", startDay: 1, endDay: 31 },
    ];

    expect(inferRosterCalendarId("2026-06-26", "2026-07-25", calendars, "pay")).toEqual({
      calendarId: "pay",
      confidence: "high",
    });
    expect(inferRosterCalendarId("2026-07-01", "2026-07-31", calendars, "pay")).toEqual({
      calendarId: "month",
      confidence: "high",
    });
  });
});
