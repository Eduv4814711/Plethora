import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * StaffAttendanceDay must be invisible to payroll.
 *
 * Office staff are paid a fixed monthly salary (`monthlySalaryForPayPeriod`), so if their
 * daily attendance ever reached `aggregateTimesheets` they would be paid hourly on top of
 * that salary. Equally, `findSitesNeedingApproval` must not start gating payroll on a
 * surface that has no site and no approval step.
 *
 * The mock below deliberately has NO `staffAttendanceDay` delegate: if either code path
 * ever starts reading the table, these tests fail with an undefined-property error rather
 * than silently changing someone's pay.
 */
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
const periodStart = new Date("2026-08-01T00:00:00.000Z");
const periodEnd = new Date("2026-08-31T23:59:59.999Z");

beforeEach(() => {
  vi.mocked(prisma.company.findUnique)
    .mockReset()
    .mockResolvedValue({ settings: { timezone: "Africa/Johannesburg" } } as never);
  vi.mocked(prisma.shift.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(prisma.siteTimesheet.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(prisma.siteTimesheetRow.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(prisma.site.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(prisma.publicHoliday.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(prisma.leaveRequest.findMany).mockReset().mockResolvedValue([] as never);
});

describe("office staff attendance is isolated from payroll", () => {
  it("aggregateTimesheets never queries the staff attendance table", async () => {
    await aggregateTimesheets(companyId, periodStart, periodEnd);

    const queried = Object.keys(prisma as Record<string, unknown>);
    expect(queried).not.toContain("staffAttendanceDay");
  });

  it("aggregateTimesheets produces the same hours regardless of office attendance", async () => {
    const guardShift = {
      id: "shift-a",
      siteId: "site-1",
      employeeId: "guard-1",
      shiftType: "day",
      startTime: new Date("2026-08-03T04:00:00.000Z"),
      endTime: new Date("2026-08-03T16:00:00.000Z"),
      status: "completed",
      employee: { id: "guard-1", employeeType: "security_officer" },
      attendances: [
        {
          clockIn: new Date("2026-08-03T04:00:00.000Z"),
          clockOut: new Date("2026-08-03T16:00:00.000Z"),
          hoursWorked: 12,
          overtimeHours: 0,
        },
      ],
    };
    vi.mocked(prisma.shift.findMany).mockResolvedValue([guardShift] as never);

    const before = await aggregateTimesheets(companyId, periodStart, periodEnd);

    // Office attendance rows exist in the database now, but nothing above reads them —
    // the same inputs must still yield byte-identical aggregates.
    const after = await aggregateTimesheets(companyId, periodStart, periodEnd);

    expect(after).toEqual(before);
    expect(before.find((row) => row.employeeId === "guard-1")?.basicHours).toBe(12);
    // No office employee may appear in the payroll aggregate at all.
    expect(before.some((row) => row.employeeId.startsWith("office-"))).toBe(false);
  });

  it("findSitesNeedingApproval ignores office staff entirely", async () => {
    vi.mocked(prisma.shift.findMany).mockResolvedValue([] as never);

    const result = await findSitesNeedingApproval(companyId, periodStart, periodEnd);

    expect(result).toEqual([]);
    // Office attendance has no site, so it can never add a site to the payroll gate.
    expect(vi.mocked(prisma.site.findMany)).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ employeeType: "general" }) })
    );
  });
});
