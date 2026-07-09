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

function canChangeSavedObNumber(args: {
  existingOccurrenceBookNumber?: string | null;
  occurrenceBookNumber?: string | null;
  actorRole: string;
}): { ok: true } | { ok: false; error: string } {
  const next = normalizeOccurrenceBookNumber(args.occurrenceBookNumber);
  const existing =
    normalizeOccurrenceBookNumber(args.existingOccurrenceBookNumber) ?? null;
  if (next === undefined || !existing) return { ok: true };
  if (next !== existing && args.actorRole !== "admin") {
    return {
      ok: false,
      error:
        "Occurrence Book (OB) number can only be changed by an administrator once it has been entered.",
    };
  }
  return { ok: true };
}

describe("site timesheet OB number admin lock", () => {
  it("allows first-time OB entry by non-admin", () => {
    expect(
      canChangeSavedObNumber({
        existingOccurrenceBookNumber: null,
        occurrenceBookNumber: "OB-1",
        actorRole: "supervisor",
      })
    ).toEqual({ ok: true });
  });

  it("blocks non-admin from changing a saved OB number", () => {
    const result = canChangeSavedObNumber({
      existingOccurrenceBookNumber: "OB-1",
      occurrenceBookNumber: "OB-2",
      actorRole: "supervisor",
    });
    expect(result.ok).toBe(false);
  });

  it("allows admin to change a saved OB number", () => {
    expect(
      canChangeSavedObNumber({
        existingOccurrenceBookNumber: "OB-1",
        occurrenceBookNumber: "OB-2",
        actorRole: "admin",
      })
    ).toEqual({ ok: true });
  });

  it("allows re-submitting the same saved OB number", () => {
    expect(
      canChangeSavedObNumber({
        existingOccurrenceBookNumber: "OB-1",
        occurrenceBookNumber: " OB-1 ",
        actorRole: "supervisor",
      })
    ).toEqual({ ok: true });
  });
});

function occurrenceBookNumbersMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function findDuplicateOccurrenceBookRow(
  rows: Array<{ id: string; workDate: string; occurrenceBookNumber?: string | null }>,
  occurrenceBookNumber: string,
  excludeRowId?: string
): { id: string; workDate: string } | null {
  const needle = occurrenceBookNumber.trim();
  if (!needle) return null;
  const match = rows.find(
    (r) =>
      r.id !== excludeRowId &&
      r.occurrenceBookNumber != null &&
      r.occurrenceBookNumber.trim().length > 0 &&
      occurrenceBookNumbersMatch(r.occurrenceBookNumber, needle)
  );
  return match ? { id: match.id, workDate: match.workDate } : null;
}

describe("site timesheet OB number uniqueness", () => {
  const rows = [
    { id: "r1", workDate: "2026-07-10", occurrenceBookNumber: "1234" },
    { id: "r2", workDate: "2026-07-11", occurrenceBookNumber: "OB-99" },
    { id: "r3", workDate: "2026-07-12", occurrenceBookNumber: null },
  ];

  it("detects a duplicate OB number on another row", () => {
    expect(findDuplicateOccurrenceBookRow(rows, "1234", "r2")).toEqual({
      id: "r1",
      workDate: "2026-07-10",
    });
  });

  it("treats OB numbers as case-insensitive", () => {
    expect(findDuplicateOccurrenceBookRow(rows, " ob-99 ", "r1")).toEqual({
      id: "r2",
      workDate: "2026-07-11",
    });
  });

  it("allows the same OB on the same row (self)", () => {
    expect(findDuplicateOccurrenceBookRow(rows, "1234", "r1")).toBeNull();
  });

  it("allows a new unused OB number", () => {
    expect(findDuplicateOccurrenceBookRow(rows, "5678")).toBeNull();
  });

  it("ignores blank OB numbers", () => {
    expect(findDuplicateOccurrenceBookRow(rows, "   ")).toBeNull();
  });
});
