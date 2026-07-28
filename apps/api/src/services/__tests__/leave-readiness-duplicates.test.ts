import { describe, expect, it } from "vitest";
import {
  classifyDuplicateLegacyDays,
  type LegacyLeaveRowForReadiness,
} from "../leave-management.service.js";

function row(overrides: Partial<LegacyLeaveRowForReadiness>): LegacyLeaveRowForReadiness {
  return {
    id: "rec-1",
    employeeId: "emp-1",
    date: new Date("2026-07-01T00:00:00.000Z"),
    type: "annual",
    hours: 8,
    employee: { firstName: "Jane", lastName: "Doe", employeeNumber: "E001" },
    ...overrides,
  };
}

describe("classifyDuplicateLegacyDays", () => {
  it("ignores a day with a single legacy row", () => {
    expect(classifyDuplicateLegacyDays([row({})], new Set())).toEqual([]);
  });

  it("ignores a day superseded by an authoritative occurrence", () => {
    const rows = [row({ id: "rec-1" }), row({ id: "rec-2" })];
    // Modern approvals keep legacy compatibility rows; those days are not anomalies.
    const authoritative = new Set(["emp-1:2026-07-01"]);
    expect(classifyDuplicateLegacyDays(rows, authoritative)).toEqual([]);
  });

  it("classifies identical rows as an exact duplicate", () => {
    const rows = [row({ id: "rec-1" }), row({ id: "rec-2" })];
    const [day] = classifyDuplicateLegacyDays(rows, new Set());
    expect(day!.kind).toBe("exact-duplicate");
    expect(day!.recordIds).toEqual(["rec-1", "rec-2"]);
    expect(day!.employeeName).toBe("Jane Doe");
    expect(day!.employeeNumber).toBe("E001");
    expect(day!.date).toBe("2026-07-01");
  });

  it("classifies rows differing in type as conflicting", () => {
    const rows = [row({ id: "rec-1", type: "annual" }), row({ id: "rec-2", type: "sick" })];
    const [day] = classifyDuplicateLegacyDays(rows, new Set());
    expect(day!.kind).toBe("conflicting-rows");
    expect(day!.types).toEqual(["annual", "sick"]);
  });

  it("classifies rows differing only in hours as conflicting", () => {
    // These are the dangerous ones: payroll sums them into a 12-hour leave day.
    const rows = [row({ id: "rec-1", hours: 8 }), row({ id: "rec-2", hours: 4 })];
    const [day] = classifyDuplicateLegacyDays(rows, new Set());
    expect(day!.kind).toBe("conflicting-rows");
    expect(day!.records.map((r) => r.hours)).toEqual([8, 4]);
  });

  it("treats Decimal-like hours values as numbers", () => {
    const rows = [
      row({ id: "rec-1", hours: { toString: () => "8.00" } }),
      row({ id: "rec-2", hours: "8" }),
    ];
    const [day] = classifyDuplicateLegacyDays(rows, new Set());
    expect(day!.kind).toBe("exact-duplicate");
    expect(day!.records.map((r) => r.hours)).toEqual([8, 8]);
  });

  it("keeps separate employees and dates apart", () => {
    const rows = [
      row({ id: "a1", employeeId: "emp-1" }),
      row({ id: "a2", employeeId: "emp-1" }),
      row({ id: "b1", employeeId: "emp-2", employee: { firstName: "Sam", lastName: "Nkosi", employeeNumber: null } }),
      row({ id: "c1", date: new Date("2026-07-02T00:00:00.000Z") }),
    ];
    const days = classifyDuplicateLegacyDays(rows, new Set());
    // Only emp-1 on 2026-07-01 has more than one row.
    expect(days).toHaveLength(1);
    expect(days[0]!.employeeId).toBe("emp-1");
    expect(days[0]!.date).toBe("2026-07-01");
  });
});
