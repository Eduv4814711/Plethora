import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma.js";

const sendText = vi.fn().mockResolvedValue({ success: true, messageId: "wamid.out" });
const sendInteractiveList = vi.fn().mockResolvedValue({ success: true, messageId: "wamid.out" });
const sendInteractiveButtons = vi.fn().mockResolvedValue({ success: true, messageId: "wamid.out" });
const sendDocument = vi.fn().mockResolvedValue(true);

vi.mock("../services/send.service.js", () => ({
  sendText,
  sendInteractiveList,
  sendInteractiveButtons,
  sendDocument,
}));

const mockOfficeEmployee = {
  id: "emp-office-1",
  companyId: "co-101",
  firstName: "Nomsa",
  lastName: "Khumalo",
  phone: "27829998877",
  employeeType: "general",
  jobRole: "HR Officer",
  ordinaryHours: "40 hours/week (08:00 - 17:00)",
  ordinaryDays: "Monday – Friday",
};

const findManyEmployees = vi.fn();
const findUniqueEmployee = vi.fn();
const findFirstLeaveRequest = vi.fn();
const countLeaveRequests = vi.fn();
const findUniqueStaffAttendance = vi.fn();
const findFirstStaffAttendance = vi.fn();
const upsertStaffAttendance = vi.fn();
const updateStaffAttendance = vi.fn();
const createAuditLogMock = vi.fn().mockResolvedValue({});

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    employee: {
      findMany: (...args: any[]) => findManyEmployees(...args),
      findUnique: (...args: any[]) => findUniqueEmployee(...args),
    },
    staffAttendanceDay: {
      findUnique: (...args: any[]) => findUniqueStaffAttendance(...args),
      findFirst: (...args: any[]) => findFirstStaffAttendance(...args),
      upsert: (...args: any[]) => upsertStaffAttendance(...args),
      update: (...args: any[]) => updateStaffAttendance(...args),
    },
    leaveRequest: {
      findFirst: (...args: any[]) => findFirstLeaveRequest(...args),
      count: (...args: any[]) => countLeaveRequests(...args),
    },
    attendance: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    shift: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    company: {
      findUnique: vi.fn().mockResolvedValue({ name: "SafeCorp Security" }),
    },
    siteAssignment: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    site: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    whatsAppClockPending: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
    },
    operationalAlert: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("../../lib/audit.js", () => ({
  createAuditLog: (...args: any[]) => createAuditLogMock(...args),
}));

vi.mock("../../lib/timezone.js", () => ({
  getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg"),
}));

describe("Office Staff WhatsApp Clock In & Clock Out", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { sessionManager } = await import("../services/session.service.js");
    sessionManager.resetAllSessions();
    findManyEmployees.mockReset().mockResolvedValue([mockOfficeEmployee]);
    findUniqueEmployee.mockReset().mockResolvedValue(mockOfficeEmployee);
    findFirstLeaveRequest.mockReset().mockResolvedValue(null);
    countLeaveRequests.mockReset().mockResolvedValue(0);
    findUniqueStaffAttendance.mockReset().mockResolvedValue(null);
    findFirstStaffAttendance.mockReset().mockResolvedValue(null);
    upsertStaffAttendance.mockReset().mockResolvedValue({});
    updateStaffAttendance.mockReset().mockResolvedValue({});
    createAuditLogMock.mockReset().mockResolvedValue({});
  });

  describe("handleOfficeClockIn", () => {
    it("prompts office employee for location to clock in and completes attendance on location", async () => {
      upsertStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        workDate: new Date("2026-09-24T00:00:00.000Z"),
        status: "present",
        timeIn: new Date(),
      });

      const { handleOfficeClockIn, completeOfficeClockInWithLocation } = await import("../services/office-clock.service.js");
      const initResult = await handleOfficeClockIn(mockOfficeEmployee, "27829998877");

      expect("sendInteractiveLocation" in initResult).toBe(true);
      if ("sendInteractiveLocation" in initResult) {
        expect(initResult.sendInteractiveLocation.body).toContain("Clock in");
      }
      expect(prisma.whatsAppClockPending.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { waFrom: "27829998877" },
          create: expect.objectContaining({
            intent: "office_clock_in",
          }),
        })
      );

      const result = await completeOfficeClockInWithLocation(
        mockOfficeEmployee,
        "27829998877",
        null,
        -26.1,
        28.0
      );

      expect(result.reply).toContain("Good day, Nomsa! 🏢");
      expect(result.reply).toContain("clocked in for today at");
      expect(result.reply).toContain("HR Officer");
      expect(upsertStaffAttendance).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId_employeeId_workDate: expect.objectContaining({
              companyId: "co-101",
              employeeId: "emp-office-1",
            }),
          }),
          create: expect.objectContaining({
            companyId: "co-101",
            employeeId: "emp-office-1",
            status: "present",
          }),
        })
      );
      expect(createAuditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "staff_attendance.clock_in",
          entityType: "StaffAttendanceDay",
        })
      );
    });

    it("immediately clocks in when office employee sent location within 3 minutes (Location First flow)", async () => {
      upsertStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        workDate: new Date(),
        status: "present",
        timeIn: new Date(),
      });

      const { sessionManager } = await import("../services/session.service.js");
      sessionManager.getOrCreateSession("27829998877", "emp-office-1", "co-101");
      sessionManager.updateSession("27829998877", {
        lastLocation: { latitude: -26.1, longitude: 28.0, timestamp: Date.now() },
      });

      const { handleOfficeClockIn } = await import("../services/office-clock.service.js");
      const result = await handleOfficeClockIn(mockOfficeEmployee, "27829998877");

      expect("reply" in result).toBe(true);
      if ("reply" in result) {
        expect(result.reply).toContain("Good day, Nomsa! 🏢");
        expect(result.reply).toContain("Location recorded");
      }
      expect(upsertStaffAttendance).toHaveBeenCalled();
    });

    it("prevents clocking in if office employee has approved leave today", async () => {
      findFirstLeaveRequest.mockResolvedValueOnce({
        id: "leave-1",
        leaveType: "ANNUAL",
        startDate: new Date("2026-09-20T00:00:00.000Z"),
        endDate: new Date("2026-09-25T00:00:00.000Z"),
      });

      const { handleOfficeClockIn } = await import("../services/office-clock.service.js");
      const result = await handleOfficeClockIn(mockOfficeEmployee, "27829998877");

      expect(result.reply).toContain("You are on approved *annual* leave today");
      expect(result.reply).toContain("You cannot clock in while on approved leave");
      expect(upsertStaffAttendance).not.toHaveBeenCalled();
    });

    it("informs office employee if they are already clocked in today", async () => {
      const earlier = new Date();
      earlier.setHours(earlier.getHours() - 3);

      findUniqueStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        status: "present",
        timeIn: earlier,
        timeOut: null,
      });

      const { handleOfficeClockIn } = await import("../services/office-clock.service.js");
      const result = await handleOfficeClockIn(mockOfficeEmployee, "27829998877");

      expect(result.reply).toContain("You are already clocked in for today");
      expect(result.reply).toContain("Reply *2* or *clock out* when your workday ends");
      expect(upsertStaffAttendance).not.toHaveBeenCalled();
    });

    it("informs office employee if workday is already completed today", async () => {
      const earlierIn = new Date();
      earlierIn.setHours(earlierIn.getHours() - 8);
      const earlierOut = new Date();
      earlierOut.setHours(earlierOut.getHours() - 1);

      findUniqueStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        status: "present",
        timeIn: earlierIn,
        timeOut: earlierOut,
        hoursWorked: 7.0,
      });

      const { handleOfficeClockIn } = await import("../services/office-clock.service.js");
      const result = await handleOfficeClockIn(mockOfficeEmployee, "27829998877");

      expect(result.reply).toContain("You have already completed your workday today");
      expect(upsertStaffAttendance).not.toHaveBeenCalled();
    });
  });

  describe("handleOfficeClockOut", () => {
    it("prompts office employee for location to clock out and completes attendance on location", async () => {
      const timeIn = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4 hours ago

      findUniqueStaffAttendance.mockResolvedValue({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        status: "present",
        timeIn,
        timeOut: null,
      });

      updateStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-1",
        timeOut: new Date(),
        hoursWorked: 4,
      });

      const { handleOfficeClockOut, completeOfficeClockOutWithLocation } = await import("../services/office-clock.service.js");
      const initResult = await handleOfficeClockOut(mockOfficeEmployee, "27829998877");

      expect("sendInteractiveLocation" in initResult).toBe(true);
      if ("sendInteractiveLocation" in initResult) {
        expect(initResult.sendInteractiveLocation.body).toContain("Clock out");
      }
      expect(prisma.whatsAppClockPending.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { waFrom: "27829998877" },
          create: expect.objectContaining({
            intent: "office_clock_out",
          }),
        })
      );

      const result = await completeOfficeClockOutWithLocation(
        mockOfficeEmployee,
        "27829998877",
        null,
        -26.1,
        28.0
      );

      expect(result.reply).toContain("🏢 *Clock Out Confirmed*");
      expect(result.reply).toContain("Clock In:");
      expect(result.reply).toContain("Clock Out:");
      expect(result.reply).toContain("Hours Worked:");
      expect(updateStaffAttendance).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "staff-att-1" },
          data: expect.objectContaining({
            hoursWorked: expect.any(Number),
          }),
        })
      );
      expect(createAuditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "staff_attendance.clock_out",
          entityType: "StaffAttendanceDay",
        })
      );
    });

    it("immediately clocks out when office employee sent location within 3 minutes (Location First flow)", async () => {
      const timeIn = new Date(Date.now() - 4 * 60 * 60 * 1000);

      findUniqueStaffAttendance.mockResolvedValue({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        status: "present",
        timeIn,
        timeOut: null,
      });

      updateStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-1",
        timeOut: new Date(),
        hoursWorked: 4,
      });

      const { sessionManager } = await import("../services/session.service.js");
      sessionManager.getOrCreateSession("27829998877", "emp-office-1", "co-101");
      sessionManager.updateSession("27829998877", {
        lastLocation: { latitude: -26.1, longitude: 28.0, timestamp: Date.now() },
      });

      const { handleOfficeClockOut } = await import("../services/office-clock.service.js");
      const result = await handleOfficeClockOut(mockOfficeEmployee, "27829998877");

      expect("reply" in result).toBe(true);
      if ("reply" in result) {
        expect(result.reply).toContain("🏢 *Clock Out Confirmed*");
      }
      expect(updateStaffAttendance).toHaveBeenCalled();
    });

    it("informs office employee if no active clock-in is found", async () => {
      findUniqueStaffAttendance.mockResolvedValueOnce(null);
      findFirstStaffAttendance.mockResolvedValueOnce(null);

      const { handleOfficeClockOut } = await import("../services/office-clock.service.js");
      const result = await handleOfficeClockOut(mockOfficeEmployee, "27829998877");

      expect(result.reply).toContain("No active clock-in found");
      expect(result.reply).toContain("Reply *1* or *clock in*");
      expect(updateStaffAttendance).not.toHaveBeenCalled();
    });

    it("informs office employee if they have already clocked out today", async () => {
      const timeIn = new Date(Date.now() - 8 * 60 * 60 * 1000);
      const timeOut = new Date(Date.now() - 30 * 60 * 1000);

      findUniqueStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        timeIn,
        timeOut,
        hoursWorked: 7.5,
      });

      const { handleOfficeClockOut } = await import("../services/office-clock.service.js");
      const result = await handleOfficeClockOut(mockOfficeEmployee, "27829998877");

      expect(result.reply).toContain("You have already clocked out today");
      expect(updateStaffAttendance).not.toHaveBeenCalled();
    });
  });

  describe("Inbound Message Ingestion Integration", () => {
    it("routes '1' or 'clock in' from office staff to handleOfficeClockIn and completes via location", async () => {
      upsertStaffAttendance.mockResolvedValue({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        workDate: new Date(),
        status: "present",
        timeIn: new Date(),
      });

      const { processIncomingMessage, processIncomingLocation } = await import("../services/handler.service.js");
      const res1 = await processIncomingMessage("27829998877", "1");
      expect("sendInteractiveLocation" in res1).toBe(true);

      vi.mocked(prisma.whatsAppClockPending.findUnique).mockResolvedValueOnce({
        waFrom: "27829998877",
        employeeId: "emp-office-1",
        companyId: "co-101",
        intent: "office_clock_in",
        siteId: null,
        expiresAt: new Date(Date.now() + 600000),
      } as any);

      const locRes = await processIncomingLocation("27829998877", -26.1, 28.0);
      expect(locRes.reply).toContain("Good day, Nomsa! 🏢");
    });

    it("routes '2' or 'clock out' from office staff to handleOfficeClockOut and completes via location", async () => {
      const timeIn = new Date(Date.now() - 3600000);
      findUniqueStaffAttendance.mockResolvedValue({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        timeIn,
        timeOut: null,
      });
      updateStaffAttendance.mockResolvedValue({
        id: "staff-att-1",
        timeOut: new Date(),
        hoursWorked: 1,
      });

      const { processIncomingMessage, processIncomingLocation } = await import("../services/handler.service.js");
      const res = await processIncomingMessage("27829998877", "2");
      expect("sendInteractiveLocation" in res).toBe(true);

      vi.mocked(prisma.whatsAppClockPending.findUnique).mockResolvedValueOnce({
        waFrom: "27829998877",
        employeeId: "emp-office-1",
        companyId: "co-101",
        intent: "office_clock_out",
        siteId: null,
        expiresAt: new Date(Date.now() + 600000),
      } as any);

      const locRes = await processIncomingLocation("27829998877", -26.1, 28.0);
      expect(locRes.reply).toContain("🏢 *Clock Out Confirmed*");
    });

    it("returns office schedule on '4' or 'roster' for office staff", async () => {
      const { processIncomingMessage } = await import("../services/handler.service.js");
      const res = await processIncomingMessage("27829998877", "roster");
      const text = "reply" in res ? res.reply : "";

      expect(text).toContain("📅 *Office Staff Work Schedule*");
      expect(text).toContain("Monday – Friday");
      expect(text).toContain("40 hours/week (08:00 - 17:00)");
      expect(text).toContain("Reply *1* to Clock In or *2* to Clock Out");
    });

    it("returns customized office status on '7' or 'status' for office staff", async () => {
      const timeIn = new Date(Date.now() - 2 * 3600000); // 2 hours ago
      findUniqueStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        timeIn,
        timeOut: null,
      });

      const { processIncomingMessage } = await import("../services/handler.service.js");
      const res = await processIncomingMessage("27829998877", "status");
      const text = "reply" in res ? res.reply : "";

      expect(text).toContain("📊 *Your Office Status*");
      expect(text).toContain("🟢 *Active at Office*");
      expect(text).toContain("2h 0m elapsed");
      expect(text).toContain("Monday – Friday");
    });
  });

  describe("Office Geofencing Clock-In and Clock-Out", () => {
    const mockOfficeSite = {
      id: "site-office-hq",
      companyId: "co-101",
      name: "Sandton Head Office",
      latitude: -26.10756,
      longitude: 28.0567,
      geofenceRadiusMeters: 200,
    };

    it("prompts for location when office employee has a geofenced site assigned", async () => {
      vi.mocked(prisma.siteAssignment.findFirst).mockResolvedValueOnce({
        id: "sa-1",
        employeeId: "emp-office-1",
        siteId: "site-office-hq",
        assignedAt: new Date(),
        isActive: true,
        site: mockOfficeSite as any,
      } as any);

      const { handleOfficeClockIn } = await import("../services/office-clock.service.js");
      const result = await handleOfficeClockIn(mockOfficeEmployee, "27829998877");

      expect("sendInteractiveLocation" in result).toBe(true);
      if ("sendInteractiveLocation" in result) {
        expect(result.sendInteractiveLocation.body).toContain("Sandton Head Office");
        expect(result.sendInteractiveLocation.body).toContain("Send Location");
      }
      expect(prisma.whatsAppClockPending.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { waFrom: "27829998877" },
          create: expect.objectContaining({
            intent: "office_clock_in",
            siteId: "site-office-hq",
          }),
        })
      );
    });

    it("completes office clock-in when location is within geofence", async () => {
      upsertStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-geo-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        workDate: new Date(),
        status: "present",
        timeIn: new Date(),
        clockInLat: -26.10756,
        clockInLng: 28.0567,
        siteId: "site-office-hq",
        clockInDistanceMeters: 15,
      });

      const { completeOfficeClockInWithLocation } = await import("../services/office-clock.service.js");
      const result = await completeOfficeClockInWithLocation(
        mockOfficeEmployee,
        "27829998877",
        mockOfficeSite as any,
        -26.10756,
        28.0567
      );

      expect(result.reply).toContain("Good day, Nomsa! 🏢");
      expect(result.reply).toContain("Verified at *Sandton Head Office*");
      expect(prisma.whatsAppClockPending.delete).toHaveBeenCalledWith({ where: { waFrom: "27829998877" } });
      expect(upsertStaffAttendance).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: "present",
            siteId: "site-office-hq",
            clockInLat: -26.10756,
            clockInLng: 28.0567,
          }),
        })
      );
    });

    it("rejects office clock-in when location is outside geofence", async () => {
      const { completeOfficeClockInWithLocation } = await import("../services/office-clock.service.js");
      const result = await completeOfficeClockInWithLocation(
        mockOfficeEmployee,
        "27829998877",
        mockOfficeSite as any,
        -25.7479,
        28.2293
      );

      expect(result.reply).toContain("❌ *Clock In Failed: Outside Office Geofence*");
      expect(result.reply).toContain("Sandton Head Office");
      expect(result.reply).toContain("within *200m*");
      expect(prisma.whatsAppClockPending.delete).not.toHaveBeenCalled();
      expect(prisma.whatsAppClockPending.update).toHaveBeenCalled();
    });

    it("prompts for location when office employee clocks out of geofenced site", async () => {
      const timeIn = new Date(Date.now() - 4 * 3600000);
      findUniqueStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        timeIn,
        timeOut: null,
      });
      vi.mocked(prisma.siteAssignment.findFirst).mockResolvedValueOnce({
        id: "sa-1",
        employeeId: "emp-office-1",
        siteId: "site-office-hq",
        assignedAt: new Date(),
        isActive: true,
        site: mockOfficeSite as any,
      } as any);

      const { handleOfficeClockOut } = await import("../services/office-clock.service.js");
      const result = await handleOfficeClockOut(mockOfficeEmployee, "27829998877");

      expect("sendInteractiveLocation" in result).toBe(true);
      if ("sendInteractiveLocation" in result) {
        expect(result.sendInteractiveLocation.body).toContain("Sandton Head Office");
        expect(result.sendInteractiveLocation.body).toContain("Send Location");
      }
      expect(prisma.whatsAppClockPending.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            intent: "office_clock_out",
            siteId: "site-office-hq",
          }),
        })
      );
    });

    it("completes office clock-out when location is within geofence", async () => {
      const timeIn = new Date(Date.now() - 4 * 3600000);
      findUniqueStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        timeIn,
        timeOut: null,
      });
      updateStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-1",
        timeOut: new Date(),
        hoursWorked: 4,
      });

      const { completeOfficeClockOutWithLocation } = await import("../services/office-clock.service.js");
      const result = await completeOfficeClockOutWithLocation(
        mockOfficeEmployee,
        "27829998877",
        mockOfficeSite as any,
        -26.10756,
        28.0567
      );

      expect(result.reply).toContain("🏢 *Clock Out Confirmed*");
      expect(result.reply).toContain("Hours Worked:");
      expect(result.reply).toContain("Verified at *Sandton Head Office*");
      expect(prisma.whatsAppClockPending.delete).toHaveBeenCalledWith({ where: { waFrom: "27829998877" } });
    });

    it("bypasses geofence distance check when employee has geofenceExempt set to true", async () => {
      upsertStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-exempt-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        workDate: new Date(),
        status: "present",
        timeIn: new Date(),
        siteId: "site-office-hq",
      });

      const exemptEmployee = { ...mockOfficeEmployee, geofenceExempt: true };
      const { completeOfficeClockInWithLocation } = await import("../services/office-clock.service.js");
      const result = await completeOfficeClockInWithLocation(
        exemptEmployee,
        "27829998877",
        mockOfficeSite as any,
        -25.7479,
        28.2293
      );

      expect(result.reply).toContain("Good day, Nomsa! 🏢");
      expect(upsertStaffAttendance).toHaveBeenCalled();
    });
  });
});
