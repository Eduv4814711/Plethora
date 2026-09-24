import { beforeEach, describe, expect, it, vi } from "vitest";

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
  },
}));

vi.mock("../../lib/audit.js", () => ({
  createAuditLog: (...args: any[]) => createAuditLogMock(...args),
}));

vi.mock("../../lib/timezone.js", () => ({
  getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg"),
}));

describe("Office Staff WhatsApp Clock In & Clock Out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyEmployees.mockResolvedValue([mockOfficeEmployee]);
    findUniqueEmployee.mockResolvedValue(mockOfficeEmployee);
    findFirstLeaveRequest.mockResolvedValue(null);
    countLeaveRequests.mockResolvedValue(0);
    findUniqueStaffAttendance.mockResolvedValue(null);
    findFirstStaffAttendance.mockResolvedValue(null);
  });

  describe("handleOfficeClockIn", () => {
    it("successfully clocks in office employee and records StaffAttendanceDay", async () => {
      upsertStaffAttendance.mockResolvedValueOnce({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        workDate: new Date("2026-09-24T00:00:00.000Z"),
        status: "present",
        timeIn: new Date(),
      });

      const { handleOfficeClockIn } = await import("../services/office-clock.service.js");
      const result = await handleOfficeClockIn(mockOfficeEmployee, "27829998877");

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
    it("successfully clocks out office employee and calculates hours worked", async () => {
      const timeIn = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4 hours ago

      findUniqueStaffAttendance.mockResolvedValueOnce({
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

      const { handleOfficeClockOut } = await import("../services/office-clock.service.js");
      const result = await handleOfficeClockOut(mockOfficeEmployee, "27829998877");

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
    it("routes '1' or 'clock in' from office staff to handleOfficeClockIn", async () => {
      upsertStaffAttendance.mockResolvedValue({
        id: "staff-att-1",
        companyId: "co-101",
        employeeId: "emp-office-1",
        workDate: new Date(),
        status: "present",
        timeIn: new Date(),
      });

      const { processIncomingMessage } = await import("../services/handler.service.js");
      const res1 = await processIncomingMessage("27829998877", "1");
      expect("reply" in res1 ? res1.reply : "").toContain("Good day, Nomsa! 🏢");

      const res2 = await processIncomingMessage("27829998877", "clock in");
      expect("reply" in res2 ? res2.reply : "").toContain("Good day, Nomsa! 🏢");
    });

    it("routes '2' or 'clock out' from office staff to handleOfficeClockOut", async () => {
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

      const { processIncomingMessage } = await import("../services/handler.service.js");
      const res = await processIncomingMessage("27829998877", "2");
      expect("reply" in res ? res.reply : "").toContain("🏢 *Clock Out Confirmed*");
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
});
