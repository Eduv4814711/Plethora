import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
    shift: { findMany: vi.fn() },
    siteTimesheet: { findMany: vi.fn() },
    siteTimesheetRow: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
    publicHoliday: { findMany: vi.fn() },
    leaveRecord: { findMany: vi.fn() },
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
    vi.mocked(prisma.shift.findMany).mockReset();
    vi.mocked(prisma.siteTimesheet.findMany).mockReset();
    vi.mocked(prisma.site.findMany).mockReset();
  });

  it("returns sites that have shifts but no approved timesheet", async () => {
    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      { siteId: "A" },
      { siteId: "B" },
    ] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([{ siteId: "A" }] as never);
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
    expect(prisma.siteTimesheet.findMany).not.toHaveBeenCalled();
  });

  it("returns empty when every site with shifts is approved", async () => {
    vi.mocked(prisma.shift.findMany).mockResolvedValue([{ siteId: "A" }] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([{ siteId: "A" }] as never);
    const result = await findSitesNeedingApproval(companyId, periodStart, periodEnd);
    expect(result).toEqual([]);
    expect(prisma.site.findMany).not.toHaveBeenCalled();
  });
});

describe("aggregateTimesheets approved-timesheet authority", () => {
  beforeEach(() => {
    vi.mocked(prisma.company.findUnique).mockReset();
    vi.mocked(prisma.publicHoliday.findMany).mockReset();
    vi.mocked(prisma.siteTimesheetRow.findMany).mockReset();
    vi.mocked(prisma.siteTimesheet.findMany).mockReset();
    vi.mocked(prisma.shift.findMany).mockReset();
    vi.mocked(prisma.leaveRecord.findMany).mockReset();

    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      settings: { timezone: "Africa/Johannesburg" },
    } as never);
    vi.mocked(prisma.publicHoliday.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.leaveRecord.findMany).mockResolvedValue([] as never);
  });

  it("counts approved rows and never falls back to raw shifts", async () => {
    // Site A is approved -> contributes via an approved site-timesheet row (guard G1).
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([
      {
        actualGuardId: "G1",
        workDate: new Date("2026-05-06T00:00:00.000Z"),
        clockIn: null,
        hoursWorked: 8,
        overtimeHours: null,
        attendanceStatus: "present",
      },
    ] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([{ siteId: "A" }] as never);

    // Raw attendance is deliberately ignored, even when a site has no approved sheet.
    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      {
        employeeId: "G2",
        startTime: new Date("2026-05-06T04:00:00.000Z"),
        attendances: [{ hoursWorked: 8, overtimeHours: 0 }],
      },
    ] as never);

    const result = await aggregateTimesheets(companyId, periodStart, periodEnd);

    const g1 = result.find((r) => r.employeeId === "G1");
    const g2 = result.find((r) => r.employeeId === "G2");
    expect(g1?.basicHours).toBe(8);
    expect(g2).toBeUndefined();
    expect(prisma.shift.findMany).not.toHaveBeenCalled();
  });

  it("returns no worked hours when there are no approved rows", async () => {
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([] as never);

    const result = await aggregateTimesheets(companyId, periodStart, periodEnd);
    expect(result).toEqual([]);
    expect(prisma.shift.findMany).not.toHaveBeenCalled();
  });

  it("excludes absent site-timesheet rows from payroll hours", async () => {
    vi.mocked(prisma.siteTimesheetRow.findMany).mockResolvedValue([
      {
        actualGuardId: "G1",
        workDate: new Date("2026-05-06T00:00:00.000Z"),
        clockIn: null,
        hoursWorked: 8,
        overtimeHours: null,
        attendanceStatus: "present",
      },
    ] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([{ siteId: "A" }] as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([] as never);

    await aggregateTimesheets(companyId, periodStart, periodEnd);

    expect(prisma.siteTimesheetRow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          attendanceStatus: {
            in: ["present", "late", "left_early", "reliever", "shift_swapped", "leave", "sick_leave", "training"],
          },
          siteTimesheet: expect.objectContaining({
            status: { in: ["approved", "locked"] },
          }),
        }),
      })
    );
  });

  it("treats locked site timesheets the same as approved for the payroll gate", async () => {
    vi.mocked(prisma.shift.findMany).mockResolvedValue([{ siteId: "A" }] as never);
    vi.mocked(prisma.siteTimesheet.findMany).mockResolvedValue([{ siteId: "A" }] as never);

    const result = await findSitesNeedingApproval(companyId, periodStart, periodEnd);
    expect(result).toEqual([]);
    expect(prisma.siteTimesheet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["approved", "locked"] },
        }),
      })
    );
  });
});
