import { describe, expect, it } from "vitest";
import {
  partitionGuardsForRotation,
  recommendSiteRotationPattern,
} from "../roster-pattern-recommendation.js";

const period = {
  rosterPeriodStart: new Date("2026-05-01T00:00:00.000Z"),
  rosterPeriodEnd: new Date("2026-05-31T23:59:59.999Z"),
};

const baseDual = {
  dayPostCount: 1,
  nightPostCount: 1,
  staffing: { day: 1, night: 1 },
  relieverCount: 0,
  ...period,
};

describe("recommendSiteRotationPattern", () => {
  it("recommends 3D-3N-3O for 3 guards at 1 day + 1 night post", () => {
    const rec = recommendSiteRotationPattern({
      ...baseDual,
      guardCount: 3,
      rosterableGuardCount: 3,
    });
    expect(rec.recommendedPatternLabel).toBe("3D-3N-3O");
    expect(rec.strategy).toBe("equal_rotation");
    expect(rec.canFullyCover).toBe(true);
    expect(rec.coreGuardCount).toBe(3);
    expect(rec.relieverGuardCount).toBe(0);
    expect(rec.warnings).toHaveLength(0);
    expect(rec.blocks).toEqual([
      { type: "day", count: 3 },
      { type: "night", count: 3 },
      { type: "off", count: 3 },
    ]);
  });

  it("recommends 2D-2N-4O for 4 guards at 1 day + 1 night post", () => {
    const rec = recommendSiteRotationPattern({
      ...baseDual,
      guardCount: 4,
      rosterableGuardCount: 4,
    });
    expect(rec.recommendedPatternLabel).toBe("2D-2N-4O");
    expect(rec.strategy).toBe("equal_rotation");
    expect(rec.canFullyCover).toBe(true);
  });

  it("recommends 4 core + 1 reliever for 5 guards by default", () => {
    const rec = recommendSiteRotationPattern({
      ...baseDual,
      guardCount: 5,
      rosterableGuardCount: 5,
    });
    expect(rec.recommendedPatternLabel).toBe("2D-2N-4O");
    expect(rec.strategy).toBe("core_with_relievers");
    expect(rec.coreGuardCount).toBe(4);
    expect(rec.relieverGuardCount).toBe(1);
    expect(rec.canFullyCover).toBe(true);
  });

  it("recommends equal 2D-2N-6O when rotateAllGuards is true for 5 guards", () => {
    const rec = recommendSiteRotationPattern({
      ...baseDual,
      guardCount: 5,
      rosterableGuardCount: 5,
      rotateAllGuards: true,
    });
    expect(rec.recommendedPatternLabel).toBe("2D-2N-6O");
    expect(rec.strategy).toBe("equal_rotation");
    expect(rec.coreGuardCount).toBe(5);
    expect(rec.relieverGuardCount).toBe(0);
  });

  it("recommends 4 core + 2 relievers for 6 guards by default", () => {
    const rec = recommendSiteRotationPattern({
      ...baseDual,
      guardCount: 6,
      rosterableGuardCount: 6,
    });
    expect(rec.recommendedPatternLabel).toBe("2D-2N-4O");
    expect(rec.strategy).toBe("core_with_relievers");
    expect(rec.coreGuardCount).toBe(4);
    expect(rec.relieverGuardCount).toBe(2);
  });

  it("warns for 2 guards on dual-shift site", () => {
    const rec = recommendSiteRotationPattern({
      ...baseDual,
      guardCount: 2,
      rosterableGuardCount: 2,
    });
    expect(rec.strategy).toBe("understaffed");
    expect(rec.canFullyCover).toBe(false);
    expect(rec.warnings.some((w) => /2 guards|at least 1 more guard/i.test(w))).toBe(true);
  });

  it("warns when guards cannot meet daily demand", () => {
    const rec = recommendSiteRotationPattern({
      ...baseDual,
      guardCount: 2,
      rosterableGuardCount: 2,
      staffing: { day: 2, night: 2 },
      dayPostCount: 2,
      nightPostCount: 2,
    });
    expect(rec.strategy).toBe("understaffed");
    expect(rec.canFullyCover).toBe(false);
    expect(rec.warnings.some((w) => w.includes("daily demand"))).toBe(true);
  });

  it("recommends day/off pattern for day-only sites", () => {
    const rec = recommendSiteRotationPattern({
      guardCount: 3,
      rosterableGuardCount: 3,
      relieverCount: 0,
      dayPostCount: 1,
      nightPostCount: 0,
      staffing: { day: 1, night: 0 },
      ...period,
    });
    expect(rec.strategy).toBe("day_only");
    expect(rec.blocks[0]?.type).toBe("day");
    expect(rec.blocks.some((b) => b.type === "off")).toBe(true);
    expect(rec.recommendedPatternLabel).toMatch(/^\d+D-\d+O$/);
  });

  it("recommends night/off pattern for night-only sites", () => {
    const rec = recommendSiteRotationPattern({
      guardCount: 4,
      rosterableGuardCount: 4,
      relieverCount: 0,
      dayPostCount: 0,
      nightPostCount: 1,
      staffing: { day: 0, night: 1 },
      ...period,
    });
    expect(rec.strategy).toBe("night_only");
    expect(rec.blocks[0]?.type).toBe("night");
    expect(rec.blocks.some((b) => b.type === "off")).toBe(true);
  });

  it("recommends core + reliever pool for 7+ guards", () => {
    const rec = recommendSiteRotationPattern({
      ...baseDual,
      guardCount: 8,
      rosterableGuardCount: 8,
    });
    expect(rec.strategy).toBe("core_with_relievers");
    expect(rec.coreGuardCount).toBe(4);
    expect(rec.relieverGuardCount).toBe(4);
    expect(
      rec.warnings.some((w) => /more guards than needed|only needs 1 day and 1 night/i.test(w))
    ).toBe(true);
  });
});

describe("partitionGuardsForRotation", () => {
  it("puts 5th guard in reliever pool for core_with_relievers strategy", () => {
    const guards = [
      { id: "g1", status: "active" },
      { id: "g2", status: "active" },
      { id: "g3", status: "active" },
      { id: "g4", status: "active" },
      { id: "g5", status: "active" },
    ];
    const rec = recommendSiteRotationPattern({
      ...baseDual,
      guardCount: 5,
      rosterableGuardCount: 5,
    });
    const { coreGuardIds, relieverGuardIds } = partitionGuardsForRotation(guards, rec);
    expect(coreGuardIds).toHaveLength(4);
    expect(relieverGuardIds).toHaveLength(1);
    expect(relieverGuardIds[0]).toBe("g5");
  });
});
