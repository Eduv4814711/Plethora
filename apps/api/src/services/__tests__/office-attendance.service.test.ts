import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceValidationError } from "../attendance.service.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
    site: { findFirst: vi.fn() },
    officeAttendance: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../lib/timezone.js", () => ({
  getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg"),
}));

import { prisma } from "../../lib/prisma.js";
import {
  getOfficeAttendanceSettings,
  startOfficeAttendance,
  completeOfficeAttendance,
} from "../office-attendance.service.js";

const employee = {
  id: "emp_1",
  companyId: "co_1",
  employeeType: "office",
  status: "active",
};

describe("office-attendance.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads office attendance settings from company settings JSON", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      settings: {
        attendance: {
          officeNoShiftEnabled: true,
          officeSiteId: "site_1",
          officeOvertimeAfterHours: 9,
        },
      },
    } as never);

    const settings = await getOfficeAttendanceSettings("co_1");
    expect(settings).toMatchObject({
      officeNoShiftEnabled: true,
      officeSiteId: "site_1",
      officeOvertimeAfterHours: 9,
    });
  });

  it("blocks office clock-in when there is already an open session", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      settings: { attendance: { officeNoShiftEnabled: true, officeSiteId: "site_1" } },
    } as never);
    vi.mocked(prisma.site.findFirst).mockResolvedValue({
      id: "site_1",
      companyId: "co_1",
      name: "HQ",
      latitude: null,
      longitude: null,
      geofenceRadiusMeters: null,
    } as never);
    vi.mocked(prisma.officeAttendance.findFirst).mockResolvedValue({
      id: "open_1",
      companyId: "co_1",
      employeeId: "emp_1",
      officeSiteId: "site_1",
      clockIn: new Date(),
      clockOut: null,
      status: "clocked_in",
    } as never);

    await expect(
      startOfficeAttendance(employee, "site_1", { lat: -26.1, lng: 28.0 })
    ).rejects.toBeInstanceOf(AttendanceValidationError);
  });

  it("completes office clock-out and computes worked/overtime hours", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      settings: { attendance: { officeNoShiftEnabled: true, officeSiteId: "site_1", officeOvertimeAfterHours: 8 } },
    } as never);
    vi.mocked(prisma.officeAttendance.findFirst).mockResolvedValue({
      id: "open_1",
      companyId: "co_1",
      employeeId: "emp_1",
      officeSiteId: "site_1",
      clockIn: new Date(Date.now() - 9 * 60 * 60 * 1000),
      clockOut: null,
      status: "clocked_in",
    } as never);
    vi.mocked(prisma.site.findFirst).mockResolvedValue({
      id: "site_1",
      companyId: "co_1",
      name: "HQ",
      latitude: null,
      longitude: null,
      geofenceRadiusMeters: null,
    } as never);
    vi.mocked(prisma.officeAttendance.update).mockResolvedValue({
      id: "open_1",
      officeSiteId: "site_1",
      clockOut: new Date(),
      hoursWorked: 9,
      overtimeHours: 1,
    } as never);

    const done = await completeOfficeAttendance(employee, { lat: -26.1, lng: 28.0 });
    expect(prisma.officeAttendance.update).toHaveBeenCalledOnce();
    expect(done.id).toBe("open_1");
  });
});
