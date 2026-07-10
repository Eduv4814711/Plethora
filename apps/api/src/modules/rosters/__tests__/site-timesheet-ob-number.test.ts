import { describe, expect, it } from "vitest";
import {
  isRowPendingReview,
  normalizeObNumber,
  rowNeedsObNumbers,
} from "../site-timesheets.service.js";

function canApproveRow(args: {
  approvalStatus?: "pending" | "partially_reviewed" | "reviewed" | "approved";
  dutyOnObNumber?: string | null;
  dutyOffObNumber?: string | null;
  existingDutyOnObNumber?: string | null;
  existingDutyOffObNumber?: string | null;
  attendanceStatus?: string;
}): { ok: true } | { ok: false; error: string } {
  const approving = args.approvalStatus === "reviewed" || args.approvalStatus === "approved";
  if (!approving) return { ok: true };

  const attendanceStatus = (args.attendanceStatus ?? "present") as Parameters<typeof rowNeedsObNumbers>[0];
  if (!rowNeedsObNumbers(attendanceStatus)) return { ok: true };

  const dutyOn =
    normalizeObNumber(args.dutyOnObNumber) ??
    normalizeObNumber(args.existingDutyOnObNumber) ??
    null;
  const dutyOff =
    normalizeObNumber(args.dutyOffObNumber) ??
    normalizeObNumber(args.existingDutyOffObNumber) ??
    null;

  if (!dutyOn) {
    return { ok: false, error: "Duty ON OB number is required before you can approve this shift." };
  }
  if (!dutyOff) {
    return { ok: false, error: "Duty OFF OB number is required before you can approve this shift." };
  }
  return { ok: true };
}

describe("site timesheet duty ON/OFF approval gate", () => {
  it("blocks approve when Duty ON is missing", () => {
    const result = canApproveRow({ approvalStatus: "reviewed" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Duty ON/i);
    }
  });

  it("blocks approve when Duty OFF is missing", () => {
    const result = canApproveRow({
      approvalStatus: "reviewed",
      dutyOnObNumber: "0232",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Duty OFF/i);
    }
  });

  it("allows approve when both duty numbers are provided", () => {
    const result = canApproveRow({
      approvalStatus: "reviewed",
      dutyOnObNumber: " 0232 ",
      dutyOffObNumber: " 0233 ",
    });
    expect(result).toEqual({ ok: true });
  });

  it("allows approve using existing saved duty numbers", () => {
    const result = canApproveRow({
      approvalStatus: "reviewed",
      existingDutyOnObNumber: "0232",
      existingDutyOffObNumber: "0233",
    });
    expect(result).toEqual({ ok: true });
  });

  it("does not require duty numbers for off-day rows", () => {
    const result = canApproveRow({
      approvalStatus: "reviewed",
      attendanceStatus: "off",
    });
    expect(result).toEqual({ ok: true });
  });

  it("does not require duty numbers for non-approve updates", () => {
    const result = canApproveRow({
      approvalStatus: "pending",
      dutyOnObNumber: null,
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("rowNeedsObNumbers", () => {
  it("requires OB for working attendance", () => {
    expect(rowNeedsObNumbers("present")).toBe(true);
    expect(rowNeedsObNumbers("late")).toBe(true);
    expect(rowNeedsObNumbers("reliever")).toBe(true);
  });

  it("skips OB for off, leave, and pending", () => {
    expect(rowNeedsObNumbers("off")).toBe(false);
    expect(rowNeedsObNumbers("leave")).toBe(false);
    expect(rowNeedsObNumbers("pending")).toBe(false);
  });
});

describe("isRowPendingReview", () => {
  it("treats partially_reviewed as pending", () => {
    expect(isRowPendingReview("pending")).toBe(true);
    expect(isRowPendingReview("partially_reviewed")).toBe(true);
    expect(isRowPendingReview("reviewed")).toBe(false);
    expect(isRowPendingReview("approved")).toBe(false);
  });
});

describe("normalizeObNumber", () => {
  it("trims and nullifies blank values", () => {
    expect(normalizeObNumber("  OB-1  ")).toBe("OB-1");
    expect(normalizeObNumber("   ")).toBeNull();
    expect(normalizeObNumber(null)).toBeNull();
    expect(normalizeObNumber(undefined)).toBeUndefined();
  });
});
