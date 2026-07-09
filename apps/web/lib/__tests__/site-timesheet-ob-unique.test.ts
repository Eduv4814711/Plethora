import { describe, expect, it } from "vitest";
import {
  findDuplicateOccurrenceBookRow,
  occurrenceBookNumbersMatch,
} from "../site-timesheet-utils";

describe("occurrenceBookNumbersMatch", () => {
  it("matches case-insensitively after trim", () => {
    expect(occurrenceBookNumbersMatch(" 1234 ", "1234")).toBe(true);
    expect(occurrenceBookNumbersMatch("OB-1", "ob-1")).toBe(true);
    expect(occurrenceBookNumbersMatch("1234", "5678")).toBe(false);
  });
});

describe("findDuplicateOccurrenceBookRow", () => {
  const rows = [
    { id: "r1", workDate: "2026-07-10", occurrenceBookNumber: "1234" },
    { id: "r2", workDate: "2026-07-11", occurrenceBookNumber: "OB-99" },
    { id: "r3", workDate: "2026-07-12", occurrenceBookNumber: null },
  ];

  it("detects a duplicate OB number on another row", () => {
    expect(findDuplicateOccurrenceBookRow(rows, "1234", "r2")).toEqual({
      id: "r1",
      workDate: "2026-07-10",
    });
  });

  it("allows the same OB on the same row", () => {
    expect(findDuplicateOccurrenceBookRow(rows, "1234", "r1")).toBeNull();
  });

  it("allows unused OB numbers", () => {
    expect(findDuplicateOccurrenceBookRow(rows, "5678")).toBeNull();
  });
});
