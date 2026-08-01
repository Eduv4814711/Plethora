import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    leaveRequest: { findMany: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma.js";
import {
  LeaveAvailabilityError,
  getLeaveDateKeysByEmployee,
  normalizeLeaveDate,
} from "../leave-availability.service.js";

describe("leave-availability.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("normalizeLeaveDate", () => {
    it("parses yyyy-MM-dd as UTC midnight (not local)", () => {
      const d = normalizeLeaveDate("2026-07-20");
      expect(d.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    });

    it("normalizes Date objects via ISO date key", () => {
      const d = normalizeLeaveDate(new Date("2026-07-20T00:00:00.000Z"));
      expect(d.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    });

    it("rejects malformed dates", () => {
      expect(() => normalizeLeaveDate("not-a-date")).toThrow(/YYYY-MM-DD/);
      expect(() => normalizeLeaveDate("2026-02-30")).toThrow(/Invalid leave date/);
    });
  });

  describe("getLeaveDateKeysByEmployee", () => {
    it("expands approved leave requests into date keys grouped by employee", async () => {
      vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
        { employeeId: "emp-1", startDate: normalizeLeaveDate("2026-07-20"), endDate: normalizeLeaveDate("2026-07-21") },
        { employeeId: "emp-2", startDate: normalizeLeaveDate("2026-07-20"), endDate: normalizeLeaveDate("2026-07-20") },
      ] as never);

      const map = await getLeaveDateKeysByEmployee(
        ["emp-1", "emp-2"],
        normalizeLeaveDate("2026-07-01"),
        normalizeLeaveDate("2026-07-31")
      );

      expect(map.get("emp-1")).toEqual(new Set(["2026-07-20", "2026-07-21"]));
      expect(map.get("emp-2")).toEqual(new Set(["2026-07-20"]));
    });

    it("returns empty map for no employees", async () => {
      const map = await getLeaveDateKeysByEmployee(
        [],
        normalizeLeaveDate("2026-07-01"),
        normalizeLeaveDate("2026-07-31")
      );
      expect(map.size).toBe(0);
      expect(prisma.leaveRequest.findMany).not.toHaveBeenCalled();
    });

    it("clips a request's date keys to the requested window", async () => {
      vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
        { employeeId: "emp-1", startDate: normalizeLeaveDate("2026-06-28"), endDate: normalizeLeaveDate("2026-07-02") },
      ] as never);

      const map = await getLeaveDateKeysByEmployee(
        ["emp-1"],
        normalizeLeaveDate("2026-07-01"),
        normalizeLeaveDate("2026-07-31")
      );

      expect(map.get("emp-1")).toEqual(new Set(["2026-07-01", "2026-07-02"]));
    });
  });

  it("exports LeaveAvailabilityError for callers to catch", () => {
    expect(new LeaveAvailabilityError("x")).toBeInstanceOf(Error);
  });
});
