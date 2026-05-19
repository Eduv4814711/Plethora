import { describe, it, expect } from "vitest";
import { resolveSiteShiftStaffing } from "../site-shift-staffing.js";

describe("resolveSiteShiftStaffing", () => {
  it("defaults to 1 per shift", () => {
    expect(resolveSiteShiftStaffing({})).toEqual({ day: 1, night: 1 });
  });

  it("clamps values to 1–50", () => {
    expect(
      resolveSiteShiftStaffing({
        rosterDayShiftGuardsRequired: 0,
        rosterNightShiftGuardsRequired: 99,
      })
    ).toEqual({ day: 1, night: 50 });
  });
});
