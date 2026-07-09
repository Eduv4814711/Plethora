import { describe, expect, it } from "vitest";

/**
 * Mirrors normalizeOccurrenceBookNumber + approve gate in site-timesheets.service.ts
 * so the OB rule stays covered without a full DB harness.
 */
function normalizeOccurrenceBookNumber(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function canApproveRow(args: {
  approvalStatus?: "pending" | "reviewed" | "approved";
  occurrenceBookNumber?: string | null;
  existingOccurrenceBookNumber?: string | null;
}): { ok: true; obNumber: string } | { ok: false; error: string } {
  const approving = args.approvalStatus === "reviewed" || args.approvalStatus === "approved";
  if (!approving) return { ok: true, obNumber: "" };

  const next = normalizeOccurrenceBookNumber(args.occurrenceBookNumber);
  const obNumber =
    next !== undefined
      ? next
      : normalizeOccurrenceBookNumber(args.existingOccurrenceBookNumber) ?? null;

  if (!obNumber) {
    return {
      ok: false,
      error: "Occurrence Book (OB) number is required before you can approve this shift.",
    };
  }
  return { ok: true, obNumber };
}

describe("site timesheet OB number approval gate", () => {
  it("blocks approve when OB number is missing", () => {
    const result = canApproveRow({ approvalStatus: "reviewed" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Occurrence Book/i);
    }
  });

  it("blocks approve when OB number is blank/whitespace", () => {
    const result = canApproveRow({
      approvalStatus: "reviewed",
      occurrenceBookNumber: "   ",
    });
    expect(result.ok).toBe(false);
  });

  it("allows approve when OB number is provided", () => {
    const result = canApproveRow({
      approvalStatus: "reviewed",
      occurrenceBookNumber: " OB-1234 ",
    });
    expect(result).toEqual({ ok: true, obNumber: "OB-1234" });
  });

  it("allows approve using an existing saved OB number", () => {
    const result = canApproveRow({
      approvalStatus: "reviewed",
      existingOccurrenceBookNumber: "OB-99",
    });
    expect(result).toEqual({ ok: true, obNumber: "OB-99" });
  });

  it("does not require OB number for non-approve updates", () => {
    const result = canApproveRow({
      approvalStatus: "pending",
      occurrenceBookNumber: null,
    });
    expect(result.ok).toBe(true);
  });
});
