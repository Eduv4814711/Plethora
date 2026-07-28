import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    leaveRecord: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createManyAndReturn: vi.fn(),
      deleteMany: vi.fn(),
    },
    employee: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../lib/prisma.js";
import {
  LeaveAvailabilityError,
  createLeaveRecordsForRange,
  deleteLeaveRecordsForRange,
  enumerateLeaveDates,
  formatLeaveDateKey,
  getLeaveDateKeysByEmployee,
  isEmployeeOnLeave,
  leaveTypeToRosterShiftCode,
  normalizeLeaveDate,
  replaceLeaveRecordRange,
  resolveDuplicateLeaveDay,
  validateLeaveDateRange,
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
  });

  describe("enumerateLeaveDates", () => {
    it("returns inclusive calendar days for a range", () => {
      const dates = enumerateLeaveDates(
        normalizeLeaveDate("2026-06-30"),
        normalizeLeaveDate("2026-07-02")
      );
      expect(dates.map((d) => formatLeaveDateKey(d))).toEqual([
        "2026-06-30",
        "2026-07-01",
        "2026-07-02",
      ]);
    });

    it("returns one day for same start and end", () => {
      const dates = enumerateLeaveDates(
        normalizeLeaveDate("2026-07-20"),
        normalizeLeaveDate("2026-07-20")
      );
      expect(dates).toHaveLength(1);
      expect(formatLeaveDateKey(dates[0]!)).toBe("2026-07-20");
    });
  });

  describe("validateLeaveDateRange", () => {
    it("rejects end before start", () => {
      expect(() => validateLeaveDateRange("2026-07-20", "2026-07-19")).toThrow(
        LeaveAvailabilityError
      );
    });

    it("accepts single-day range", () => {
      const { dates } = validateLeaveDateRange("2026-07-20");
      expect(dates).toHaveLength(1);
    });

    it("rejects malformed and impossible dates", () => {
      expect(() => validateLeaveDateRange("not-a-date")).toThrow(/YYYY-MM-DD/);
      expect(() => validateLeaveDateRange("2026-02-30")).toThrow(/Invalid leave date/);
    });
  });

  describe("leaveTypeToRosterShiftCode", () => {
    it("maps sick to SL and others to L", () => {
      expect(leaveTypeToRosterShiftCode("sick")).toBe("SL");
      expect(leaveTypeToRosterShiftCode("annual")).toBe("L");
      expect(leaveTypeToRosterShiftCode("unpaid")).toBe("L");
    });
  });

  describe("isEmployeeOnLeave", () => {
    it("returns true when a record exists for the UTC date", async () => {
      vi.mocked(prisma.leaveRecord.findFirst).mockResolvedValue({ id: "lr-1" } as never);
      const onLeave = await isEmployeeOnLeave("emp-1", normalizeLeaveDate("2026-07-20"));
      expect(onLeave).toBe(true);
      expect(prisma.leaveRecord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            employeeId: "emp-1",
            date: normalizeLeaveDate("2026-07-20"),
          },
        })
      );
    });

    it("returns false when no record exists", async () => {
      vi.mocked(prisma.leaveRecord.findFirst).mockResolvedValue(null);
      expect(await isEmployeeOnLeave("emp-1", normalizeLeaveDate("2026-07-20"))).toBe(false);
    });
  });

  describe("getLeaveDateKeysByEmployee", () => {
    it("groups leave dates by employee id", async () => {
      vi.mocked(prisma.leaveRecord.findMany).mockResolvedValue([
        { employeeId: "emp-1", date: normalizeLeaveDate("2026-07-20") },
        { employeeId: "emp-1", date: normalizeLeaveDate("2026-07-21") },
        { employeeId: "emp-2", date: normalizeLeaveDate("2026-07-20") },
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
      expect(prisma.leaveRecord.findMany).not.toHaveBeenCalled();
    });
  });

  describe("createLeaveRecordsForRange", () => {
    it("creates one record per day in a transaction", async () => {
      const created = [
        { id: "lr-1", date: normalizeLeaveDate("2026-07-20") },
        { id: "lr-2", date: normalizeLeaveDate("2026-07-21") },
      ];
      const createManyAndReturn = vi.fn().mockResolvedValue(created);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
        fn({
          leaveRecord: {
            findMany: vi.fn().mockResolvedValue([]),
            createManyAndReturn,
          },
        } as never)
      );

      const result = await createLeaveRecordsForRange({
        employeeId: "emp-1",
        startDate: "2026-07-20",
        endDate: "2026-07-21",
        type: "annual",
        hours: 8,
      });

      expect(result.days).toBe(2);
      expect(result.records).toHaveLength(2);
      expect(prisma.$transaction).toHaveBeenCalledOnce();
      expect(createManyAndReturn).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ date: normalizeLeaveDate("2026-07-20") }),
          expect.objectContaining({ date: normalizeLeaveDate("2026-07-21") }),
        ],
      });
    });

    it("rejects a range that overlaps existing leave", async () => {
      const createManyAndReturn = vi.fn();
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
        fn({
          leaveRecord: {
            findMany: vi.fn().mockResolvedValue([
              { date: normalizeLeaveDate("2026-07-21") },
            ]),
            createManyAndReturn,
          },
        } as never)
      );

      await expect(
        createLeaveRecordsForRange({
          employeeId: "emp-1",
          startDate: "2026-07-20",
          endDate: "2026-07-22",
          type: "annual",
          hours: 8,
        })
      ).rejects.toThrow(/already exists.*2026-07-21/);
      expect(createManyAndReturn).not.toHaveBeenCalled();
    });
  });

  describe("deleteLeaveRecordsForRange", () => {
    it("deletes using UTC-normalized date bounds", async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1" } as never);
      vi.mocked(prisma.leaveRecord.deleteMany).mockResolvedValue({ count: 1 });

      const deleted = await deleteLeaveRecordsForRange({
        companyId: "co-1",
        employeeId: "emp-1",
        type: "annual",
        startDate: "2026-07-20",
        endDate: "2026-07-20",
      });

      expect(deleted).toBe(1);
      expect(prisma.leaveRecord.deleteMany).toHaveBeenCalledWith({
        where: {
          employeeId: "emp-1",
          type: "annual",
          date: {
            gte: normalizeLeaveDate("2026-07-20"),
            lte: normalizeLeaveDate("2026-07-20"),
          },
        },
      });
    });

    it("throws when employee not in company", async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValue(null);
      await expect(
        deleteLeaveRecordsForRange({
          companyId: "co-1",
          employeeId: "emp-1",
          type: "annual",
          startDate: "2026-07-20",
          endDate: "2026-07-20",
        })
      ).rejects.toThrow(/Employee not found/);
    });
  });

  describe("replaceLeaveRecordRange", () => {
    it("replaces old range with new records in a transaction", async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1" } as never);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const tx = {
          leaveRecord: {
            deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
            findMany: vi.fn().mockResolvedValue([]),
            createManyAndReturn: vi.fn().mockResolvedValue([
              { id: "lr-new-1" },
              { id: "lr-new-2" },
            ]),
          },
        };
        return fn(tx as never);
      });

      const result = await replaceLeaveRecordRange({
        companyId: "co-1",
        employeeId: "emp-1",
        type: "annual",
        startDate: "2026-07-20",
        endDate: "2026-07-21",
        newStartDate: "2026-07-22",
        newEndDate: "2026-07-23",
        newType: "sick",
        hours: 8,
      });

      expect(result.days).toBe(2);
      expect(result.records).toHaveLength(2);
    });

    it("throws when old range not found", async () => {
      vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1" } as never);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        const tx = {
          leaveRecord: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            create: vi.fn(),
          },
        };
        return fn(tx as never);
      });

      await expect(
        replaceLeaveRecordRange({
          companyId: "co-1",
          employeeId: "emp-1",
          type: "annual",
          startDate: "2026-07-20",
          endDate: "2026-07-20",
          newStartDate: "2026-07-22",
          newType: "sick",
          hours: 8,
        })
      ).rejects.toThrow(/Leave record not found/);
    });
  });
});

describe("resolveDuplicateLeaveDay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1" } as never);
  });

  function mockDayRows(rows: Array<{ id: string }>) {
    const deleteMany = vi.fn().mockResolvedValue({ count: rows.length - 1 });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        leaveRecord: { findMany: vi.fn().mockResolvedValue(rows), deleteMany },
      } as never)
    );
    return deleteMany;
  }

  it("keeps the chosen record and deletes only the others", async () => {
    const deleteMany = mockDayRows([{ id: "lr-1" }, { id: "lr-2" }, { id: "lr-3" }]);

    const result = await resolveDuplicateLeaveDay({
      companyId: "co-1",
      employeeId: "emp-1",
      date: "2026-07-11",
      keepRecordId: "lr-2",
    });

    expect(result).toEqual({ kept: "lr-2", deleted: ["lr-1", "lr-3"] });
    // The kept row must never appear in the delete set — that would strip the leave day.
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["lr-1", "lr-3"] } } });
  });

  it("deletes every row for the day when no record is kept", async () => {
    const deleteMany = mockDayRows([{ id: "lr-1" }, { id: "lr-2" }]);

    const result = await resolveDuplicateLeaveDay({
      companyId: "co-1",
      employeeId: "emp-1",
      date: "2026-07-11",
      keepRecordId: null,
    });

    expect(result).toEqual({ kept: null, deleted: ["lr-1", "lr-2"] });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["lr-1", "lr-2"] } } });
  });

  it("treats an omitted keepRecordId as delete-the-day", async () => {
    const deleteMany = mockDayRows([{ id: "lr-1" }, { id: "lr-2" }]);

    const result = await resolveDuplicateLeaveDay({
      companyId: "co-1",
      employeeId: "emp-1",
      date: "2026-07-11",
    });

    expect(result.kept).toBeNull();
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["lr-1", "lr-2"] } } });
  });

  it("refuses a record that does not belong to the day", async () => {
    const deleteMany = mockDayRows([{ id: "lr-1" }, { id: "lr-2" }]);
    await expect(
      resolveDuplicateLeaveDay({
        companyId: "co-1",
        employeeId: "emp-1",
        date: "2026-07-11",
        keepRecordId: "lr-999",
      })
    ).rejects.toThrow(LeaveAvailabilityError);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("refuses when the day has only one record", async () => {
    const deleteMany = mockDayRows([{ id: "lr-1" }]);
    await expect(
      resolveDuplicateLeaveDay({
        companyId: "co-1",
        employeeId: "emp-1",
        date: "2026-07-11",
        keepRecordId: "lr-1",
      })
    ).rejects.toThrow(/single leave record/);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("refuses when the day has no records", async () => {
    mockDayRows([]);
    await expect(
      resolveDuplicateLeaveDay({
        companyId: "co-1",
        employeeId: "emp-1",
        date: "2026-07-11",
        keepRecordId: "lr-1",
      })
    ).rejects.toThrow(/No leave records found/);
  });

  it("refuses an employee outside the company", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null as never);
    await expect(
      resolveDuplicateLeaveDay({
        companyId: "co-1",
        employeeId: "emp-other",
        date: "2026-07-11",
        keepRecordId: "lr-1",
      })
    ).rejects.toThrow("Employee not found");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
