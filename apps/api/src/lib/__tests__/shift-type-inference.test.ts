import { describe, expect, it } from "vitest";
import { inferShiftTypeFromStartTime } from "../timezone.js";

const TZ = "Africa/Johannesburg";

describe("inferShiftTypeFromStartTime", () => {
  it("classifies 06:00 SA as day", () => {
    // 06:00 SAST = 04:00 UTC
    const start = new Date("2026-06-10T04:00:00.000Z");
    expect(inferShiftTypeFromStartTime(start, TZ)).toBe("day");
  });

  it("classifies 12:00 SA as day (not night — fixes legacy >=12 server-hour bug)", () => {
    const start = new Date("2026-06-10T10:00:00.000Z");
    expect(inferShiftTypeFromStartTime(start, TZ)).toBe("day");
  });

  it("classifies 18:00 SA as night", () => {
    const start = new Date("2026-06-10T16:00:00.000Z");
    expect(inferShiftTypeFromStartTime(start, TZ)).toBe("night");
  });

  it("classifies 02:00 SA as night (after midnight portion of night shift)", () => {
    const start = new Date("2026-06-11T00:00:00.000Z");
    expect(inferShiftTypeFromStartTime(start, TZ)).toBe("night");
  });
});
