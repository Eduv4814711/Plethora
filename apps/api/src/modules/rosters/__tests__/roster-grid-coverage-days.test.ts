import { describe, it, expect, vi } from "vitest";

vi.mock("../../../lib/prisma.js", () => ({ prisma: {} }));

import { buildCoverage } from "../rosters.service.js";
import { resolveSiteCoverageDays } from "../../../lib/site-coverage-days.js";

/** 2026-07-27 (Mon) … 2026-08-02 (Sun) — the week from the reported bug. */
const WEEK = [
  "2026-07-27",
  "2026-07-28",
  "2026-07-29",
  "2026-07-30",
  "2026-07-31",
  "2026-08-01",
  "2026-08-02",
];

const WEEKDAYS = [1, 2, 3, 4, 5];

describe("buildCoverage with per-shift weekday cover", () => {
  it("requires nobody on Sat/Sun for a Mon–Fri day shift", () => {
    const coverage = buildCoverage(
      WEEK,
      [],
      1,
      1,
      resolveSiteCoverageDays({
        rosterDayShiftDays: WEEKDAYS,
        rosterNightShiftDays: [0, 1, 2, 3, 4, 5, 6],
      })
    );

    // Saturday and Sunday — the two dates the roster editor wrongly flagged.
    expect(coverage["2026-08-01"]!.requiredDay).toBe(0);
    expect(coverage["2026-08-02"]!.requiredDay).toBe(0);
    // Night still runs all seven days.
    expect(coverage["2026-08-01"]!.requiredNight).toBe(1);
    // Weekdays are unaffected.
    expect(coverage["2026-07-27"]!.requiredDay).toBe(1);
  });

  it("keeps the legacy seven-day behaviour when coverage days are omitted", () => {
    const coverage = buildCoverage(WEEK, [], 1, 1);
    for (const day of WEEK) {
      expect(coverage[day]!.requiredDay).toBe(1);
      expect(coverage[day]!.requiredNight).toBe(1);
    }
  });

  it("still counts staffed cells on covered weekdays", () => {
    const rows = [
      { cells: [{ dateKey: "2026-07-27", shiftCode: "D" }, { dateKey: "2026-08-01", shiftCode: "N" }] },
    ];
    const coverage = buildCoverage(
      WEEK,
      rows,
      1,
      1,
      resolveSiteCoverageDays({ rosterDayShiftDays: WEEKDAYS, rosterNightShiftDays: WEEKDAYS })
    );

    expect(coverage["2026-07-27"]!.day).toBe(1);
    // The Saturday night cell is still counted even though Saturday needs no cover,
    // so an extra shift never reads as a shortfall.
    expect(coverage["2026-08-01"]!.night).toBe(1);
    expect(coverage["2026-08-01"]!.requiredNight).toBe(0);
  });
});
