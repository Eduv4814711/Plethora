import { describe, expect, it } from "vitest";

/** Pure dedupe key helpers used by alert upsert — unit-tested without DB. */
export function buildAlertDedupeKey(
  kind: string,
  sourceId: string,
  extra?: string
): string {
  return extra ? `${kind}:${sourceId}:${extra}` : `${kind}:${sourceId}`;
}

describe("alert dedupe keys", () => {
  it("builds stable keys for missed clock-in", () => {
    expect(buildAlertDedupeKey("missed_clock_in", "shift_1")).toBe(
      "missed_clock_in:shift_1"
    );
  });

  it("includes extra segment when provided", () => {
    expect(buildAlertDedupeKey("contract_expiry", "site_1", "7d")).toBe(
      "contract_expiry:site_1:7d"
    );
  });
});
