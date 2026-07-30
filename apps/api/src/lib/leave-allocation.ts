/**
 * Attributes leave ledger movements to the entitlement cycle that funded them.
 *
 * The ledger is a flat, immutable list of signed minute movements. That is
 * enough to answer "what is the balance?", but not "which cycle does this
 * balance belong to?" — and every South African forfeiture and payout rule is
 * cycle-scoped:
 *
 *   - BCEA s20(4): annual leave from a cycle must be granted within six months
 *     of that cycle ending, after which it is forfeited. Only the *unconsumed
 *     portion of that particular cycle* expires.
 *   - BCEA s22: sick leave resets on the 36-month boundary.
 *   - BCEA s40: on termination an employee is paid the pro-rata current cycle
 *     plus the immediately preceding cycle. Earlier cycles are already gone.
 *
 * Consumption is attributed oldest-cycle-first (FIFO), which is both the
 * employee-favourable reading and the one that makes forfeiture meaningful —
 * consuming the newest credit first would let stale entitlement sit forever.
 *
 * Refunds (a cancelled application releasing its reservation, or an amended
 * application reversing what it took) unwind the most recent consumption first,
 * so a reverse-then-replay lands exactly back where it started.
 *
 * Pure and database-free so the arithmetic can be unit-tested directly.
 */

import type { LeaveCycleWindow } from "./leave-cycles.js";

/** Ledger entry types that grant entitlement. */
const CREDIT_TYPES = new Set(["ACCRUAL", "OPENING_BALANCE", "CARRY_OVER"]);

/** Ledger entry types that hand minutes back to the cycle they came from. */
const REFUND_TYPES = new Set(["RESERVATION_RELEASE", "REVERSAL"]);

export type LeaveLedgerFact = {
  entryType: string;
  /** Signed minutes: credits positive, debits negative. */
  minutes: number;
  effectiveDate: Date;
  /** Tie-breaker when several entries share an effective date. */
  createdAt?: Date | null;
  /** Cycle the entry was stamped with, when known. */
  cycleKey?: string | null;
};

export type LeaveCycleAllocation = {
  cycleKey: string;
  cycleIndex: number;
  start: Date;
  end: Date;
  graceEnd: Date;
  /** Entitlement granted into this cycle (accrual, opening balance, carry-in). */
  credited: number;
  /** Minutes taken as leave and attributed to this cycle. */
  taken: number;
  /** Minutes held by submitted-but-undecided applications. */
  reserved: number;
  /** Minutes already forfeited out of this cycle. */
  expired: number;
  /** Minutes already paid out of this cycle on termination. */
  paidOut: number;
  /** Signed manual adjustments attributed to this cycle. */
  adjusted: number;
  /** credited + adjusted − taken − reserved − expired − paidOut. May go negative. */
  remaining: number;
};

/**
 * Adjustments are the one signed category, so credits and debits are counted
 * separately while allocating and netted into `adjusted` at the end. Keeping
 * every debit total positive lets the running-balance arithmetic stay uniform.
 */
type Bucket = LeaveCycleAllocation & { adjustedCredit: number; adjustedDebit: number };

type DebitField = "taken" | "reserved" | "expired" | "paidOut" | "adjustedDebit";

type ConsumptionRecord = {
  bucketIndex: number;
  minutes: number;
  field: DebitField;
};

function toTime(date: Date | null | undefined): number {
  if (!(date instanceof Date)) return 0;
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function newBucket(cycle: LeaveCycleWindow): Bucket {
  return {
    cycleKey: cycle.cycleKey,
    cycleIndex: cycle.cycleIndex,
    start: cycle.start,
    end: cycle.end,
    graceEnd: cycle.graceEnd,
    credited: 0,
    taken: 0,
    reserved: 0,
    expired: 0,
    paidOut: 0,
    adjusted: 0,
    adjustedCredit: 0,
    adjustedDebit: 0,
    remaining: 0,
  };
}

/** Which running total a debit should be recorded against. */
function debitField(entryType: string): DebitField {
  switch (entryType) {
    case "RESERVATION":
      return "reserved";
    case "EXPIRY":
      return "expired";
    case "PAYOUT":
      return "paidOut";
    case "TAKEN":
      return "taken";
    default:
      return "adjustedDebit";
  }
}

/**
 * Index of the bucket an entry belongs to when it carries no cycle key, or
 * carries one that no longer resolves (a policy's cycle length was changed
 * after the entry was written). Falls back to the cycle containing the
 * effective date, clamped to the enumerated range.
 */
function bucketIndexForDate(buckets: Bucket[], date: Date): number {
  const time = toTime(date);
  for (let index = 0; index < buckets.length; index += 1) {
    if (time <= toTime(buckets[index].end)) return index;
  }
  return buckets.length - 1;
}

/**
 * Bucket the ledger into cycles.
 *
 * `cycles` must be contiguous and oldest-first — use `enumerateLeaveCycles`.
 * Entries falling outside the enumerated range are clamped to the nearest end,
 * so the returned totals always reconcile to the flat ledger sum.
 */
export function allocateLeaveConsumption(
  facts: LeaveLedgerFact[],
  cycles: LeaveCycleWindow[]
): LeaveCycleAllocation[] {
  if (cycles.length === 0) return [];

  const buckets = cycles.map(newBucket);
  const indexByKey = new Map<string, number>();
  buckets.forEach((bucket, index) => indexByKey.set(bucket.cycleKey, index));

  // Stable chronological order. Entries sharing an effective date are ordered
  // by creation so a release never precedes the reservation it cancels.
  const ordered = facts
    .map((fact, index) => ({ fact, index }))
    .sort((a, b) => {
      const byDate = toTime(a.fact.effectiveDate) - toTime(b.fact.effectiveDate);
      if (byDate !== 0) return byDate;
      const byCreated =
        toTime(a.fact.createdAt ?? a.fact.effectiveDate) -
        toTime(b.fact.createdAt ?? b.fact.effectiveDate);
      if (byCreated !== 0) return byCreated;
      return a.index - b.index;
    });

  const history: ConsumptionRecord[] = [];

  const resolveBucket = (fact: LeaveLedgerFact): number => {
    if (fact.cycleKey) {
      const known = indexByKey.get(fact.cycleKey);
      if (known != null) return known;
    }
    return bucketIndexForDate(buckets, fact.effectiveDate);
  };

  const availableIn = (bucket: Bucket): number =>
    bucket.credited +
    bucket.adjustedCredit -
    bucket.adjustedDebit -
    bucket.taken -
    bucket.reserved -
    bucket.expired -
    bucket.paidOut;

  for (const { fact } of ordered) {
    const minutes = Math.round(fact.minutes);
    if (minutes === 0) continue;
    const type = fact.entryType.toUpperCase();

    if (minutes > 0 && REFUND_TYPES.has(type)) {
      // Unwind the most recent consumption first so a reversal restores the
      // exact cycles the original debit drew from.
      let outstanding = minutes;
      while (outstanding > 0 && history.length > 0) {
        const last = history[history.length - 1];
        const restored = Math.min(outstanding, last.minutes);
        buckets[last.bucketIndex][last.field] -= restored;
        last.minutes -= restored;
        outstanding -= restored;
        if (last.minutes === 0) history.pop();
      }
      // A refund with nothing left to unwind (imported or hand-corrected data)
      // still has to land somewhere, so credit it to its own cycle.
      if (outstanding > 0) buckets[resolveBucket(fact)].credited += outstanding;
      continue;
    }

    if (minutes > 0) {
      const bucketIndex = resolveBucket(fact);
      if (CREDIT_TYPES.has(type)) buckets[bucketIndex].credited += minutes;
      else buckets[bucketIndex].adjustedCredit += minutes;
      continue;
    }

    // Debit: draw FIFO from the oldest cycle that still has entitlement.
    const field = debitField(type);
    let outstanding = -minutes;
    for (let index = 0; index < buckets.length && outstanding > 0; index += 1) {
      const spare = availableIn(buckets[index]);
      if (spare <= 0) continue;
      const drawn = Math.min(spare, outstanding);
      buckets[index][field] += drawn;
      history.push({ bucketIndex: index, minutes: drawn, field });
      outstanding -= drawn;
    }
    if (outstanding > 0) {
      // Nothing left to draw on — the policy allows a negative balance, or the
      // debit is a forfeiture of an already-empty cycle. Book the overflow
      // against the entry's own cycle so the totals still reconcile.
      const bucketIndex = resolveBucket(fact);
      buckets[bucketIndex][field] += outstanding;
      history.push({ bucketIndex, minutes: outstanding, field });
    }
  }

  return buckets.map((bucket) => {
    const { adjustedCredit, adjustedDebit, ...allocation } = bucket;
    return {
      ...allocation,
      adjusted: adjustedCredit - adjustedDebit,
      remaining: availableIn(bucket),
    };
  });
}

/**
 * Minutes in a cycle that should be carried over and forfeited at close.
 *
 * `carryOverLimitMinutes` of `null` means the policy places no cap, so the
 * whole remainder carries. A limit of `0` forfeits everything, which is the
 * correct BCEA s22 behaviour for sick leave.
 */
export function splitCycleCloseMinutes(params: {
  remainingMinutes: number;
  carryOverLimitMinutes: number | null;
}): { carryOverMinutes: number; expiredMinutes: number } {
  const remaining = Math.max(0, Math.round(params.remainingMinutes));
  if (remaining === 0) return { carryOverMinutes: 0, expiredMinutes: 0 };
  const limit = params.carryOverLimitMinutes;
  if (limit == null) return { carryOverMinutes: remaining, expiredMinutes: 0 };
  const carryOverMinutes = Math.max(0, Math.min(remaining, Math.round(limit)));
  return { carryOverMinutes, expiredMinutes: remaining - carryOverMinutes };
}

/**
 * Minutes payable on termination under BCEA s40.
 *
 * Only the cycle in which employment ends and the one immediately before it are
 * payable; anything older was already forfeited under s20(4). The caller
 * supplies the pro-rated entitlement for the incomplete final cycle.
 */
export function terminationPayableMinutes(params: {
  allocations: LeaveCycleAllocation[];
  currentCycleKey: string;
}): {
  payableMinutes: number;
  forfeitedMinutes: number;
  payableCycleKeys: string[];
} {
  const ordered = [...params.allocations].sort(
    (a, b) => a.cycleIndex - b.cycleIndex
  );
  const currentIndex = ordered.findIndex(
    (allocation) => allocation.cycleKey === params.currentCycleKey
  );
  if (currentIndex === -1) {
    return { payableMinutes: 0, forfeitedMinutes: 0, payableCycleKeys: [] };
  }

  const payableFrom = Math.max(0, currentIndex - 1);
  let payableMinutes = 0;
  let forfeitedMinutes = 0;
  const payableCycleKeys: string[] = [];

  ordered.forEach((allocation, index) => {
    const remaining = Math.max(0, allocation.remaining);
    if (index >= payableFrom && index <= currentIndex) {
      payableMinutes += remaining;
      payableCycleKeys.push(allocation.cycleKey);
    } else if (index < payableFrom) {
      forfeitedMinutes += remaining;
    }
  });

  return { payableMinutes, forfeitedMinutes, payableCycleKeys };
}
