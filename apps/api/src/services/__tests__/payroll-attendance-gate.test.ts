import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
    shift: { findMany: vi.fn() },
    siteTimesheet: { findMany: vi.fn() },
    siteTimesheetRow: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
    publicHoliday: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma.js";
import { findSitesNeedingApproval } from "../payroll.service.js";
import { aggregateTimesheets } from "../timesheet.service.js";

const companyId = "co-1";
const periodStart = new Date("2026-05-01T00:00:00.000Z");
const periodEnd = new Date("2026-05-31T23:59:59.999Z");

describe("findSitesNeedingApproval (payroll attendance gate)", () => {
  beforeEach(() => {
    vi.mocked(prisma.company.findUnique).mockReset();
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      settings: { timezone: "Africa/Johannesburg" },
    } as never);
    vi.mocked(prisma.shift.findMany).mockReset();
    vi.mocked(prisma.siteTimesheetRow.findMany).mockReset();
    vi.mocked(prisma.site.findMany).mockReset();
  });

  it("returns sites whose worked shifts have no approved timesheet row", async () => {
    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      { id: "shift-a", siteId: "A", employeeId: "G1", shiftType: "day", startTime: new Date("2026-05-06T04:00:00.000Z") },
      { id: "shift-b", siteId: "B", employeeId: "G2", shiftType: "day", startTime: new Date("2026-05-06T04:00:00.000Z") },
    ] as never);
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([{
      siteId: "A",
      workDate: new Date("2026-05-06T00:00:00.000Z"),
      actualGuardId: "G1",
      actualShiftType: "day",
      sourceShiftId: "shift-a",
    }] as never);
    vi.mocked(prisma.site.findMany).mockResolvedValue([{ id: "B", name: "Site B" }] as never);

    const result = await findSitesNeedingApproval(companyId, periodStart, periodEnd);
    expect(result).toEqual([{ id: "B", name: "Site B" }]);
  });

  it("only counts worked shifts (completed/verified), matching aggregateTimesheets", async () => {
    vi.mocked(prisma.shift.findMany).mockResolvedValue([] as never);
    await findSitesNeedingApproval(companyId, periodStart, periodEnd);
    expect(prisma.shift.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["completed", "verified"] },
        }),
      })
    );
  });

  it("returns empty when there are no shifts in the period", async () => {
    vi.mocked(prisma.shift.findMany).mockResolvedValue([] as never);
    const result = await findSitesNeedingApproval(companyId, periodStart, periodEnd);
    expect(result).toEqual([]);
    expect(prisma.siteTimesheetRow.findMany).not.toHaveBeenCalled();
  });

  it("returns empty when every worked shift has an approved row", async () => {
    vi.mocked(prisma.shift.findMany).mockResolvedValue([{
      id: "shift-a",
      siteId: "A",
      employeeId: "G1",
      shiftType: "day",
      startTime: new Date("2026-05-06T04:00:00.000Z"),
    }] as never);
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([{
      siteId: "A",
      workDate: new Date("2026-05-06T00:00:00.000Z"),
      actualGuardId: "G1",
      actualShiftType: "day",
      sourceShiftId: "shift-a",
    }] as never);
    const result = await findSitesNeedingApproval(companyId, periodStart, periodEnd);
    expect(result).toEqual([]);
    expect(prisma.site.findMany).not.toHaveBeenCalled();
  });

  it("does not treat an approved sheet as complete when one worked shift row is missing", async () => {
    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      { id: "shift-a", siteId: "A", employeeId: "G1", shiftType: "day", startTime: new Date("2026-05-06T04:00:00.000Z") },
      { id: "shift-missing", siteId: "A", employeeId: "G2", shiftType: "day", startTime: new Date("2026-05-06T04:00:00.000Z") },
    ] as never);
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([{
      siteId: "A",
      workDate: new Date("2026-05-06T00:00:00.000Z"),
      actualGuardId: "G1",
      actualShiftType: "day",
      sourceShiftId: "shift-a",
    }] as never);
    vi.mocked(prisma.site.findMany).mockResolvedValue([{ id: "A", name: "Site A" }] as never);

    await expect(findSitesNeedingApproval(companyId, periodStart, periodEnd)).resolves.toEqual([
      { id: "A", name: "Site A" },
    ]);
  });
});

describe("aggregateTimesheets per-site behaviour", () => {
  beforeEach(() => {
    vi.mocked(prisma.company.findUnique).mockReset();
    vi.mocked(prisma.publicHoliday.findMany).mockReset();
    vi.mocked(prisma.siteTimesheetRow.findMany).mockReset();
    vi.mocked(prisma.siteTimesheet.findMany).mockReset();
    vi.mocked(prisma.shift.findMany).mockReset();
    vi.mocked(prisma.leaveRequest.findMany).mockReset();

    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      settings: { timezone: "Africa/Johannesburg" },
    } as never);
    vi.mocked(prisma.publicHoliday.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never);
  });

  it("counts approved rows for one site AND raw shifts for an unapproved site", async () => {
    // Site A is approved -> contributes via an approved site-timesheet row (guard G1).
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([
      {
        siteId: "A",
        sourceShiftId: "shift-a",
        actualShiftType: "day",
        actualGuardId: "G1",
        workDate: new Date("2026-05-06T00:00:00.000Z"),
        clockIn: null,
        hoursWorked: 8,
        overtimeHours: null,
        attendanceStatus: "present",
      },
    ] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([{
      id: "ts-a",
      siteId: "A",
      periodStart,
      periodEnd,
    }] as never);

    // Site B has no approved timesheet -> raw shift falls back (guard G2).
    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      {
        id: "shift-b",
        siteId: "B",
        employeeId: "G2",
        shiftType: "day",
        startTime: new Date("2026-05-06T04:00:00.000Z"),
        attendances: [{ hoursWorked: 8, overtimeHours: 0 }],
      },
    ] as never);

    const result = await aggregateTimesheets(companyId, periodStart, periodEnd);

    const g1 = result.find((r) => r.employeeId === "G1");
    const g2 = result.find((r) => r.employeeId === "G2");
    expect(g1?.basicHours).toBe(8);
    expect(g2?.basicHours).toBe(8);

    // Raw attendance is suppressed in memory only for exact approved site/date keys.
    const shiftWhere = vi.mocked(prisma.shift.findMany).mock.calls[0][0] as {
      where: { siteId?: { notIn: string[] } };
    };
    expect(shiftWhere.where.siteId).toBeUndefined();
  });

  it("keeps raw attendance when an approved sheet is missing that exact shift row", async () => {
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([{
      id: "ts-a",
      siteId: "A",
      periodStart,
      periodEnd,
    }] as never);
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([{
      siteId: "A",
      sourceShiftId: "shift-covered",
      actualGuardId: "G1",
      actualShiftType: "day",
      workDate: new Date("2026-05-06T00:00:00.000Z"),
      clockIn: null,
      hoursWorked: 8,
      overtimeHours: 0,
      attendanceStatus: "present",
    }] as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      {
        id: "shift-covered",
        siteId: "A",
        employeeId: "G1",
        shiftType: "day",
        startTime: new Date("2026-05-06T04:00:00.000Z"),
        attendances: [{ hoursWorked: 8, overtimeHours: 0 }],
      },
      {
        id: "shift-missing",
        siteId: "A",
        employeeId: "G2",
        shiftType: "day",
        startTime: new Date("2026-05-06T04:00:00.000Z"),
        attendances: [{ hoursWorked: 8, overtimeHours: 0 }],
      },
    ] as never);

    const result = await aggregateTimesheets(companyId, periodStart, periodEnd);
    expect(result.find((row) => row.employeeId === "G1")?.basicHours).toBe(8);
    expect(result.find((row) => row.employeeId === "G2")?.basicHours).toBe(8);
  });

  it("does not restrict raw shifts when no site is approved", async () => {
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([] as never);

    await aggregateTimesheets(companyId, periodStart, periodEnd);

    const shiftWhere = vi.mocked(prisma.shift.findMany).mock.calls[0][0] as {
      where: { siteId?: { notIn: string[] } };
    };
    expect(shiftWhere.where.siteId).toBeUndefined();
  });

  it("excludes absent site-timesheet rows from payroll hours", async () => {
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([
      {
        siteId: "A",
        sourceShiftId: "shift-a",
        actualShiftType: "day",
        actualGuardId: "G1",
        workDate: new Date("2026-05-06T00:00:00.000Z"),
        clockIn: null,
        hoursWorked: 8,
        overtimeHours: null,
        attendanceStatus: "present",
      },
    ] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([{
      id: "ts-a",
      siteId: "A",
      periodStart,
      periodEnd,
    }] as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([] as never);

    await aggregateTimesheets(companyId, periodStart, periodEnd);

    expect(prisma.siteTimesheetRow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          attendanceStatus: {
            in: ["present", "late", "left_early", "reliever", "shift_swapped", "leave", "sick_leave", "training"],
          },
          siteTimesheetId: { in: ["ts-a"] },
        }),
      })
    );
  });

  it("treats locked site timesheets the same as approved for the payroll gate", async () => {
    vi.mocked(prisma.shift.findMany).mockResolvedValue([{
      id: "shift-a",
      siteId: "A",
      employeeId: "G1",
      shiftType: "day",
      startTime: new Date("2026-05-06T04:00:00.000Z"),
    }] as never);
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([{
      siteId: "A",
      workDate: new Date("2026-05-06T00:00:00.000Z"),
      actualGuardId: "G1",
      actualShiftType: "day",
      sourceShiftId: "shift-a",
    }] as never);

    const result = await findSitesNeedingApproval(companyId, periodStart, periodEnd);
    expect(result).toEqual([]);
    expect(prisma.siteTimesheetRow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          siteTimesheet: expect.objectContaining({
            status: { in: ["approved", "locked"] },
          }),
        }),
      })
    );
  });

  it("parental leave is unpaid; UIF and IOD buckets are always zero in the simple leave engine", async () => {
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      {
        employeeId: "G1",
        leaveType: "PARENTAL",
        startDate: new Date("2026-05-05T00:00:00.000Z"),
        endDate: new Date("2026-05-05T00:00:00.000Z"),
        unitsRequested: 1,
        employee: { employeeType: "general" },
      },
    ] as never);

    const result = await aggregateTimesheets(companyId, periodStart, periodEnd);

    expect(result.find((row) => row.employeeId === "G1")?.unpaidLeaveHours).toBe(8);
    expect(result.find((row) => row.employeeId === "G1")?.uifLeaveHours).toBe(0);
    expect(result.find((row) => row.employeeId === "G1")?.iodLeaveHours).toBe(0);
  });

  it("does not count a leave site-timesheet row as worked time when an approved leave request exists", async () => {
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([{
      siteId: "A",
      sourceShiftId: null,
      actualShiftType: "day",
      actualGuardId: "G1",
      workDate: new Date("2026-05-06T00:00:00.000Z"),
      clockIn: null,
      hoursWorked: 8,
      overtimeHours: null,
      attendanceStatus: "leave",
    }] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([{
      id: "ts-a",
      siteId: "A",
      periodStart,
      periodEnd,
    }] as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([{
      employeeId: "G1",
      leaveType: "SICK",
      startDate: new Date("2026-05-06T00:00:00.000Z"),
      endDate: new Date("2026-05-06T00:00:00.000Z"),
      unitsRequested: 1,
      employee: { employeeType: "general" },
    }] as never);

    const result = await aggregateTimesheets(companyId, periodStart, periodEnd);
    expect(result.find((row) => row.employeeId === "G1")).toMatchObject({
      basicHours: 0,
      leaveHours: 8,
    });
  });

  it("uses a leave site-timesheet row as paid-leave fallback when no leave record exists", async () => {
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([{
      siteId: "A",
      sourceShiftId: null,
      actualShiftType: "day",
      actualGuardId: "G1",
      workDate: new Date("2026-05-06T00:00:00.000Z"),
      clockIn: null,
      hoursWorked: null,
      overtimeHours: null,
      attendanceStatus: "sick_leave",
    }] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([{
      id: "ts-a",
      siteId: "A",
      periodStart,
      periodEnd,
    }] as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([] as never);

    const result = await aggregateTimesheets(companyId, periodStart, periodEnd);
    expect(result.find((row) => row.employeeId === "G1")).toMatchObject({
      basicHours: 0,
      leaveHours: 8,
    });
  });

  it("includes raw shifts that start on the final payroll date", async () => {
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([] as never);

    await aggregateTimesheets(companyId, periodStart, periodEnd);

    expect(prisma.shift.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ startTime: { lt: new Date("2026-06-01T00:00:00.000Z") } }),
    }));
  });
});
