import { describe, expect, it } from "vitest";
import { expandPatternToCycle, parsePatternNotation, PATTERN_PRESETS } from "../roster-pattern-utils";

describe("roster-pattern-utils SA NBCPSS presets", () => {
  it("provides SA-compliant default presets without unsafe 7-on/7-off or Day->Night alternates", () => {
    const ids = PATTERN_PRESETS.map((p) => p.id);
    expect(ids).toContain("4on4off-day");
    expect(ids).toContain("4on4off-night");
    expect(ids).toContain("5on2off-day");
    expect(ids).toContain("continental-223");
    expect(ids).not.toContain("7on7off-day");
    expect(ids).not.toContain("7on7off-night");
    expect(ids).not.toContain("day-night-alt");
  });

  it("still parses legacy stored pattern notation cleanly", () => {
    expect(parsePatternNotation("D,D,N,O")).toEqual(["D", "D", "N", "O"]);
    expect(expandPatternToCycle(["D", "N", "O"], 6)).toEqual(["D", "N", "O", "D", "N", "O"]);
  });
});
