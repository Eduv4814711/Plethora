import { describe, it, expect } from "vitest";
import {
  allocateLeaveConsumption,
  splitCycleCloseMinutes,
  terminationPayableMinutes,
  type LeaveLedgerFact,
} from "../leave-allocation.js";
import { enumerateLeaveCycles, type LeaveCycleSpec } from "../leave-cycles.js";

const utc = (key: string) => new Date(`${key}T00:00:00.000Z`);
const DAY = 480; // an eight-hour working day in minutes

const annual: LeaveCycleSpec = {
  leaveTypeCode: "annual",
  anchor: utc("2024-03-01"),
  cycleMonths: 12,
  graceMonths: 6,
};

/** Cycles 0, 1 and 2 of the annual spec. */
const cycles = enumerateLeaveCycles(annual, utc("2024-03-01"), utc("2027-01-01"));

const accrual = (date: string, minutes: number, cycleKey?: string): LeaveLedgerFact => ({
  entryType: "ACCRUAL",
  minutes,
  effectiveDate: utc(date),
  cycleKey: cycleKey ?? null,
});

const taken = (date: string, minutes: number): LeaveLedgerFact => ({
  entryType: "TAKEN",
  minutes: -minutes,
  effectiveDate: utc(date),
});

describe("allocateLeaveConsumption", () => {
  it("returns nothing when there are no cycles", () => {
    expect(allocateLeaveConsumption([accrual("2024-04-01", DAY)], [])).toEqual([]);
  });

  it("credits an accrual to the cycle named by its cycle key", () => {
    const result = allocateLeaveConsumption(
      [accrual("2024-04-01", 10 * DAY, "annual:0:2024-03-01")],
      cycles
    );
    expect(result[0].credited).toBe(10 * DAY);
    expect(result[1].credited).toBe(0);
  });

  it("falls back to the cycle containing the effective date when unstamped", () => {
    // Legacy rows written before cycle keys existed still land correctly.
    const result = allocateLeaveConsumption([accrual("2025-06-01", 5 * DAY)], cycles);
    expect(result[0].credited).toBe(0);
    expect(result[1].credited).toBe(5 * DAY);
  });

  it("draws consumption from the oldest cycle first", () => {
    const result = allocateLeaveConsumption(
      [
        accrual("2024-04-01", 10 * DAY, "annual:0:2024-03-01"),
        accrual("2025-04-01", 10 * DAY, "annual:1:2025-03-01"),
        taken("2025-05-01", 12 * DAY),
      ],
      cycles
    );
    // FIFO: the older cycle is exhausted before the newer one is touched.
    expect(result[0].taken).toBe(10 * DAY);
    expect(result[1].taken).toBe(2 * DAY);
    expect(result[0].remaining).toBe(0);
    expect(result[1].remaining).toBe(8 * DAY);
  });

  it("tracks reservations separately from leave actually taken", () => {
    const result = allocateLeaveConsumption(
      [
        accrual("2024-04-01", 10 * DAY, "annual:0:2024-03-01"),
        { entryType: "RESERVATION", minutes: -3 * DAY, effectiveDate: utc("2024-06-01") },
      ],
      cycles
    );
    expect(result[0].reserved).toBe(3 * DAY);
    expect(result[0].taken).toBe(0);
    expect(result[0].remaining).toBe(7 * DAY);
  });

  it("unwinds a release against the reservation it cancels", () => {
    const result = allocateLeaveConsumption(
      [
        accrual("2024-04-01", 10 * DAY, "annual:0:2024-03-01"),
        {
          entryType: "RESERVATION",
          minutes: -3 * DAY,
          effectiveDate: utc("2024-06-01"),
          createdAt: utc("2024-06-01"),
        },
        {
          entryType: "RESERVATION_RELEASE",
          minutes: 3 * DAY,
          effectiveDate: utc("2024-06-01"),
          createdAt: utc("2024-06-02"),
        },
      ],
      cycles
    );
    expect(result[0].reserved).toBe(0);
    expect(result[0].remaining).toBe(10 * DAY);
  });

  it("returns reversed minutes to the cycle the debit drew from", () => {
    const result = allocateLeaveConsumption(
      [
        accrual("2024-04-01", 5 * DAY, "annual:0:2024-03-01"),
        accrual("2025-04-01", 5 * DAY, "annual:1:2025-03-01"),
        { entryType: "TAKEN", minutes: -7 * DAY, effectiveDate: utc("2025-05-01"), createdAt: utc("2025-05-01") },
        { entryType: "REVERSAL", minutes: 2 * DAY, effectiveDate: utc("2025-05-02"), createdAt: utc("2025-05-02") },
      ],
      cycles
    );
    // The debit took 5 from cycle 0 and 2 from cycle 1; the reversal of 2 days
    // unwinds the most recent draw, restoring cycle 1 rather than cycle 0.
    expect(result[0].taken).toBe(5 * DAY);
    expect(result[1].taken).toBe(0);
    expect(result[1].remaining).toBe(5 * DAY);
  });

  it("books an over-draw against the entry's own cycle so totals reconcile", () => {
    const facts = [
      accrual("2024-04-01", 2 * DAY, "annual:0:2024-03-01"),
      taken("2024-06-01", 5 * DAY),
    ];
    const result = allocateLeaveConsumption(facts, cycles);
    expect(result[0].taken).toBe(5 * DAY);
    expect(result[0].remaining).toBe(-3 * DAY);

    const ledgerSum = facts.reduce((sum, f) => sum + f.minutes, 0);
    const allocatedSum = result.reduce((sum, r) => sum + r.remaining, 0);
    expect(allocatedSum).toBe(ledgerSum);
  });

  it("records expiry and payout against their own totals", () => {
    const result = allocateLeaveConsumption(
      [
        accrual("2024-04-01", 10 * DAY, "annual:0:2024-03-01"),
        { entryType: "EXPIRY", minutes: -4 * DAY, effectiveDate: utc("2025-08-29") },
        { entryType: "PAYOUT", minutes: -6 * DAY, effectiveDate: utc("2025-09-01") },
      ],
      cycles
    );
    expect(result[0].expired).toBe(4 * DAY);
    expect(result[0].paidOut).toBe(6 * DAY);
    expect(result[0].remaining).toBe(0);
  });

  it("treats a signed adjustment as a credit or a debit", () => {
    const result = allocateLeaveConsumption(
      [
        accrual("2024-04-01", 5 * DAY, "annual:0:2024-03-01"),
        { entryType: "ADJUSTMENT", minutes: 2 * DAY, effectiveDate: utc("2024-05-01") },
        { entryType: "ADJUSTMENT", minutes: -1 * DAY, effectiveDate: utc("2024-06-01") },
      ],
      cycles
    );
    expect(result[0].remaining).toBe(6 * DAY);
  });

  it("orders same-day entries by creation so a release never precedes its reservation", () => {
    const result = allocateLeaveConsumption(
      [
        {
          entryType: "RESERVATION_RELEASE",
          minutes: DAY,
          effectiveDate: utc("2024-06-01"),
          createdAt: new Date("2024-06-01T12:00:00.000Z"),
        },
        accrual("2024-04-01", 5 * DAY, "annual:0:2024-03-01"),
        {
          entryType: "RESERVATION",
          minutes: -DAY,
          effectiveDate: utc("2024-06-01"),
          createdAt: new Date("2024-06-01T09:00:00.000Z"),
        },
      ],
      cycles
    );
    expect(result[0].reserved).toBe(0);
    expect(result[0].remaining).toBe(5 * DAY);
  });

  it("ignores zero-minute entries", () => {
    const result = allocateLeaveConsumption(
      [accrual("2024-04-01", 5 * DAY, "annual:0:2024-03-01"), accrual("2024-05-01", 0)],
      cycles
    );
    expect(result[0].credited).toBe(5 * DAY);
  });

  it("clamps an entry that falls after the enumerated range to the last cycle", () => {
    const result = allocateLeaveConsumption([accrual("2035-01-01", DAY)], cycles);
    expect(result[result.length - 1].credited).toBe(DAY);
  });
});

describe("splitCycleCloseMinutes", () => {
  it("carries the whole remainder when the policy sets no limit", () => {
    expect(
      splitCycleCloseMinutes({ remainingMinutes: 10 * DAY, carryOverLimitMinutes: null })
    ).toEqual({ carryOverMinutes: 10 * DAY, expiredMinutes: 0 });
  });

  it("forfeits everything above the carry-over limit", () => {
    expect(
      splitCycleCloseMinutes({ remainingMinutes: 10 * DAY, carryOverLimitMinutes: 4 * DAY })
    ).toEqual({ carryOverMinutes: 4 * DAY, expiredMinutes: 6 * DAY });
  });

  it("forfeits the whole remainder at a zero limit, as BCEA s22 sick leave requires", () => {
    expect(
      splitCycleCloseMinutes({ remainingMinutes: 10 * DAY, carryOverLimitMinutes: 0 })
    ).toEqual({ carryOverMinutes: 0, expiredMinutes: 10 * DAY });
  });

  it("does nothing for an empty or negative remainder", () => {
    expect(
      splitCycleCloseMinutes({ remainingMinutes: 0, carryOverLimitMinutes: null })
    ).toEqual({ carryOverMinutes: 0, expiredMinutes: 0 });
    expect(
      splitCycleCloseMinutes({ remainingMinutes: -5 * DAY, carryOverLimitMinutes: null })
    ).toEqual({ carryOverMinutes: 0, expiredMinutes: 0 });
  });
});

describe("terminationPayableMinutes", () => {
  const allocations = [
    { cycleIndex: 0, cycleKey: "annual:0:2024-03-01", remaining: 3 * DAY },
    { cycleIndex: 1, cycleKey: "annual:1:2025-03-01", remaining: 5 * DAY },
    { cycleIndex: 2, cycleKey: "annual:2:2026-03-01", remaining: 7 * DAY },
  ] as Parameters<typeof terminationPayableMinutes>[0]["allocations"];

  it("pays the current cycle and the one immediately before it", () => {
    const result = terminationPayableMinutes({
      allocations,
      currentCycleKey: "annual:2:2026-03-01",
    });
    expect(result.payableMinutes).toBe(12 * DAY);
    expect(result.payableCycleKeys).toEqual([
      "annual:1:2025-03-01",
      "annual:2:2026-03-01",
    ]);
  });

  it("forfeits everything older than the preceding cycle", () => {
    const result = terminationPayableMinutes({
      allocations,
      currentCycleKey: "annual:2:2026-03-01",
    });
    expect(result.forfeitedMinutes).toBe(3 * DAY);
  });

  it("pays only the first cycle when the employee leaves inside it", () => {
    const result = terminationPayableMinutes({
      allocations,
      currentCycleKey: "annual:0:2024-03-01",
    });
    expect(result.payableMinutes).toBe(3 * DAY);
    expect(result.forfeitedMinutes).toBe(0);
  });

  it("never pays out a negative balance", () => {
    const result = terminationPayableMinutes({
      allocations: [
        { cycleIndex: 0, cycleKey: "annual:0:2024-03-01", remaining: -2 * DAY },
      ] as typeof allocations,
      currentCycleKey: "annual:0:2024-03-01",
    });
    expect(result.payableMinutes).toBe(0);
  });

  it("returns nothing when the current cycle is not in the allocation set", () => {
    const result = terminationPayableMinutes({
      allocations,
      currentCycleKey: "annual:9:2033-03-01",
    });
    expect(result).toEqual({
      payableMinutes: 0,
      forfeitedMinutes: 0,
      payableCycleKeys: [],
    });
  });
});
