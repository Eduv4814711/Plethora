import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    employee: { findMany: vi.fn() },
    shift: { findMany: vi.fn(), findFirst: vi.fn() },
    attendance: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
    whatsAppClockPending: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    officeAttendance: { findFirst: vi.fn() },
  },
}));

vi.mock("../../../lib/config.js", () => ({
  config: { attendance: { clockInWindowMinutes: 15 } },
}));

vi.mock("../../../lib/timezone.js", () => ({
  getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg"),
}));

vi.mock("../../../lib/audit.js", () => ({
  createAuditLog: vi.fn(),
}));

vi.mock("../send.service.js", () => ({
  sendText: vi.fn(),
  sendDocument: vi.fn(),
  sendInteractiveList: vi.fn(),
}));

vi.mock("../../../services/office-attendance.service.js", () => ({
  getOfficeAttendanceSettings: vi.fn().mockResolvedValue({
    officeNoShiftEnabled: true,
    officeSiteId: "site_office",
    officeOvertimeAfterHours: 8,
  }),
  startOfficeAttendance: vi.fn(),
  completeOfficeAttendance: vi.fn(),
}));

import { prisma } from "../../../lib/prisma.js";
import { processIncomingMessage } from "../handler.service.js";

describe("WhatsApp handler location-first flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      {
        id: "emp_1",
        companyId: "co_1",
        firstName: "Jane",
        lastName: "Doe",
        phone: "27820000000",
        employeeType: "security",
        status: "active",
      },
    ] as never);
  });

  it("creates pending intent for security clock-in and does not clock in from text", async () => {
    vi.mocked(prisma.whatsAppClockPending.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      {
        id: "shift_1",
        companyId: "co_1",
        employeeId: "emp_1",
        startTime: new Date(Date.now() - 5 * 60 * 1000),
        endTime: new Date(Date.now() + 7 * 60 * 60 * 1000),
        status: "assigned",
        post: { site: { id: "site_1", name: "Main Site" } },
      },
    ] as never);
    vi.mocked(prisma.shift.findFirst).mockResolvedValue({
      id: "shift_1",
      companyId: "co_1",
      status: "assigned",
      startTime: new Date(),
      endTime: new Date(Date.now() + 60 * 60 * 1000),
    } as never);
    vi.mocked(prisma.attendance.findFirst).mockResolvedValue(null as never);

    const result = await processIncomingMessage("27820000000", "clock in");

    expect(result).toHaveProperty("reply");
    expect(prisma.whatsAppClockPending.upsert).toHaveBeenCalledOnce();
    expect(prisma.attendance.create).not.toHaveBeenCalled();
  });

  it("blocks non-location command while pending intent is active", async () => {
    vi.mocked(prisma.whatsAppClockPending.findUnique).mockResolvedValue({
      waFrom: "27820000000",
      employeeId: "emp_1",
      companyId: "co_1",
      intent: "clock_in",
      shiftId: "shift_1",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    } as never);

    const result = await processIncomingMessage("27820000000", "payslip");
    expect(result).toEqual({
      reply: "You have a pending clock action. Please send your current location to continue.",
    });
  });
});
