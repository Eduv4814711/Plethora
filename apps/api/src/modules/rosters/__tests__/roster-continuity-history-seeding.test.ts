import { describe, expect, it, vi } from "vitest";
import { seedGuardWorkHistory } from "../roster-continuity.service.js";

function fakeTx(rows: Array<{ guardId: string; rosterDate: Date; shiftCode: string }>) {
  return {
    siteRosterGeneratedShift: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as never;
}

const START = new Date("2026-07-10T00:00:00.000Z"); // reconciliation window begins here

describe("seedGuardWorkHistory", () => {
  it("seeds a night shift worked the day before the window as the guard's previous working type", async () => {
    const tx = fakeTx([
      { guardId: "guard-1", rosterDate: new Date("2026-07-09T00:00:00.000Z"), shiftCode: "N" },
    ]);

    const { previousWorkingTypeByGuard } = await seedGuardWorkHistory(tx, "co-1", "site-1", ["guard-1"], START);

    expect(previousWorkingTypeByGuard.get("guard-1")).toBe("night");
  });

  it("does not seed a previous working type when yesterday was a rest/leave/off day", async () => {
    const tx = fakeTx([
      { guardId: "guard-1", rosterDate: new Date("2026-07-09T00:00:00.000Z"), shiftCode: "O" },
    ]);

    const { previousWorkingTypeByGuard } = await seedGuardWorkHistory(tx, "co-1", "site-1", ["guard-1"], START);

    expect(previousWorkingTypeByGuard.has("guard-1")).toBe(false);
  });

  it("counts a real consecutive-day streak ending the day before the window", async () => {
    const tx = fakeTx([
      { guardId: "guard-1", rosterDate: new Date("2026-07-09T00:00:00.000Z"), shiftCode: "D" },
      { guardId: "guard-1", rosterDate: new Date("2026-07-08T00:00:00.000Z"), shiftCode: "D" },
      { guardId: "guard-1", rosterDate: new Date("2026-07-07T00:00:00.000Z"), shiftCode: "D" },
      { guardId: "guard-1", rosterDate: new Date("2026-07-06T00:00:00.000Z"), shiftCode: "O" }, // streak breaks here
    ]);

    const { consecutiveWorkingDaysByGuard } = await seedGuardWorkHistory(tx, "co-1", "site-1", ["guard-1"], START);

    expect(consecutiveWorkingDaysByGuard.get("guard-1")).toBe(3);
  });

  it("stops counting the streak at the first gap, even if further-back days were also worked", async () => {
    const tx = fakeTx([
      { guardId: "guard-1", rosterDate: new Date("2026-07-09T00:00:00.000Z"), shiftCode: "D" },
      { guardId: "guard-1", rosterDate: new Date("2026-07-08T00:00:00.000Z"), shiftCode: "O" },
      { guardId: "guard-1", rosterDate: new Date("2026-07-07T00:00:00.000Z"), shiftCode: "D" },
    ]);

    const { consecutiveWorkingDaysByGuard } = await seedGuardWorkHistory(tx, "co-1", "site-1", ["guard-1"], START);

    expect(consecutiveWorkingDaysByGuard.get("guard-1")).toBe(1);
  });

  it("returns empty maps for a guard with no shifts in the lookback window", async () => {
    const tx = fakeTx([]);

    const { previousWorkingTypeByGuard, consecutiveWorkingDaysByGuard } = await seedGuardWorkHistory(
      tx,
      "co-1",
      "site-1",
      ["guard-1"],
      START
    );

    expect(previousWorkingTypeByGuard.has("guard-1")).toBe(false);
    expect(consecutiveWorkingDaysByGuard.has("guard-1")).toBe(false);
  });

  it("short-circuits without querying when there are no guards", async () => {
    const tx = fakeTx([]);

    await seedGuardWorkHistory(tx, "co-1", "site-1", [], START);

    expect((tx as { siteRosterGeneratedShift: { findMany: ReturnType<typeof vi.fn> } }).siteRosterGeneratedShift.findMany).not.toHaveBeenCalled();
  });
});
