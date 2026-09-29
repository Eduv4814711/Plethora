import { beforeEach, describe, expect, it, vi } from "vitest";

const sendText = vi.fn();
const sendInteractiveList = vi.fn();
const sendDocument = vi.fn();

vi.mock("../services/send.service.js", () => ({
  sendText,
  sendInteractiveList,
  sendDocument,
}));

const findMany = vi.fn();
const findEmployeeUnique = vi.fn();
const clockPendingFindUnique = vi.fn();
const clockPendingDelete = vi.fn();
const clockPendingDeleteMany = vi.fn();

const recordOfficeAttendance = vi.fn();
vi.mock("../services/office-clock.service.js", () => ({
  officeClockService: {
    recordOfficeAttendance,
  },
}));

const validateAndRecordOperationalAttendance = vi.fn();
vi.mock("../services/operational-attendance.service.js", () => ({
  operationalAttendanceService: {
    validateAndRecordOperationalAttendance,
  },
}));

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    employee: { findMany, findUnique: findEmployeeUnique },
    whatsAppClockPending: {
      findUnique: clockPendingFindUnique,
      delete: clockPendingDelete,
      deleteMany: clockPendingDeleteMany,
      upsert: vi.fn(),
    },
    attendance: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    shift: { findMany: vi.fn() },
    leaveRequest: { create: vi.fn() },
    payslip: { findFirst: vi.fn() },
  },
}));

vi.mock("../../services/attendance.service.js", () => ({
  validateClockIn: vi.fn(),
  calculateHours: vi.fn(),
  assertWithinSiteGeofence: vi.fn(),
  AttendanceValidationError: class AttendanceValidationError extends Error {},
}));

vi.mock("../../lib/geo.js", () => ({ siteHasGeofence: vi.fn() }));
vi.mock("../../services/payslip-data.service.js", () => ({
  fetchPayslipData: vi.fn(),
  buildPayslipTemplateData: vi.fn(),
}));
vi.mock("../../services/payslip-pdf.service.js", () => ({
  generatePayslipPDFFromTemplate: vi.fn(),
}));
vi.mock("../../services/roster-pdf.service.js", () => ({ generateRosterPDF: vi.fn() }));
vi.mock("../../lib/audit.js", () => ({ createAuditLog: vi.fn() }));
vi.mock("../../lib/timezone.js", () => ({ getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg") }));

describe("processAndSend", () => {
  beforeEach(() => {
    sendText.mockReset();
    sendInteractiveList.mockReset();
    sendDocument.mockReset();
    findMany.mockReset();
  });

  it("throws when WhatsApp text send fails", async () => {
    findMany.mockResolvedValue([]);
    sendText.mockResolvedValueOnce({ success: false, error: "token expired" });

    const { processAndSend } = await import("../services/handler.service.js");
    await expect(processAndSend("27821234567", "hello")).rejects.toThrow("token expired");
  });

  it("falls back to text when interactive list send fails", async () => {
    findMany.mockResolvedValue([
      {
        id: "emp-1",
        companyId: "co-1",
        firstName: "Test",
        lastName: "User",
        phone: "27821234567",
      },
    ]);
    sendInteractiveList.mockResolvedValueOnce({ success: false, error: "interactive rejected" });
    sendText.mockResolvedValueOnce({ success: true, messageId: "wamid.out" });

    const { processAndSend } = await import("../services/handler.service.js");
    await processAndSend("27821234567", "help");

    expect(sendInteractiveList).toHaveBeenCalled();
    expect(sendText).toHaveBeenCalled();
  });
});

describe("findEmployeeByPhone", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it("returns the one active employee whose normalized phone matches", async () => {
    const employee = { id: "emp-1", companyId: "co-1", firstName: "Test", lastName: "User", phone: "082 123 4567" };
    findMany.mockResolvedValue([employee]);
    const { findEmployeeByPhone } = await import("../services/handler.service.js");
    await expect(findEmployeeByPhone("27821234567")).resolves.toEqual(employee);
  });

  it("fails closed when the normalized phone matches active employees in two tenants", async () => {
    findMany.mockResolvedValue([
      { id: "emp-1", companyId: "co-1", firstName: "First", lastName: "User", phone: "+27 82 123 4567" },
      { id: "emp-2", companyId: "co-2", firstName: "Second", lastName: "User", phone: "0821234567" },
    ]);
    const { findEmployeeByPhone } = await import("../services/handler.service.js");
    await expect(findEmployeeByPhone("27821234567")).resolves.toBeNull();
  });
});

describe("readResponseBodyWithLimit", () => {
  it("stops reading when a WhatsApp media response exceeds the hard byte limit", async () => {
    const { readResponseBodyWithLimit } = await import("../services/handler.service.js");
    const response = new Response(new Uint8Array([1, 2, 3, 4]));
    await expect(readResponseBodyWithLimit(response, 3)).rejects.toThrow("FILE_TOO_LARGE");
  });

  it("returns the body when it is within the byte limit", async () => {
    const { readResponseBodyWithLimit } = await import("../services/handler.service.js");
    const response = new Response(new Uint8Array([1, 2, 3]));
    await expect(readResponseBodyWithLimit(response, 3)).resolves.toEqual(Buffer.from([1, 2, 3]));
  });
});

describe("processIncomingLocation", () => {
  beforeEach(() => {
    findMany.mockReset();
    findEmployeeUnique.mockReset();
    clockPendingFindUnique.mockReset();
    clockPendingDelete.mockReset();
    clockPendingDeleteMany.mockReset();
    recordOfficeAttendance.mockReset();
    validateAndRecordOperationalAttendance.mockReset();
  });

  it("returns error message when phone number is not registered", async () => {
    findMany.mockResolvedValue([]);
    const { processIncomingLocation } = await import("../services/handler.service.js");
    const result = await processIncomingLocation("27829999999", -26.1, 28.0);
    expect(result.reply).toContain("Phone number not registered");
  });

  it("routes office employees (employeeType === 'general') to officeClockService", async () => {
    const officeEmp = { id: "emp-office", companyId: "co-1", phone: "0821234567" };
    findMany.mockResolvedValue([officeEmp]);
    findEmployeeUnique.mockResolvedValue({ id: "emp-office", employeeType: "general", status: "ACTIVE" });
    recordOfficeAttendance.mockResolvedValue({
      success: true,
      message: "✅ Office attendance recorded. Clock-in at 08:30.",
    });

    const { processIncomingLocation } = await import("../services/handler.service.js");
    const result = await processIncomingLocation("27821234567", -26.1, 28.0);

    expect(recordOfficeAttendance).toHaveBeenCalledWith("emp-office", -26.1, 28.0);
    expect(validateAndRecordOperationalAttendance).not.toHaveBeenCalled();
    expect(clockPendingDeleteMany).toHaveBeenCalledWith({ where: { waFrom: "27821234567" } });
    expect(result.reply).toBe("✅ Office attendance recorded. Clock-in at 08:30.");
  });

  it("handles expired pending clock request for operational guards", async () => {
    const guardEmp = { id: "emp-guard", companyId: "co-1", phone: "0821234567" };
    findMany.mockResolvedValue([guardEmp]);
    findEmployeeUnique.mockResolvedValue({ id: "emp-guard", employeeType: "guard", status: "ACTIVE" });
    clockPendingFindUnique.mockResolvedValue({
      waFrom: "27821234567",
      employeeId: "emp-guard",
      companyId: "co-1",
      intent: "clock_in",
      expiresAt: new Date(Date.now() - 60000), // Expired 1 min ago
    });

    const { processIncomingLocation } = await import("../services/handler.service.js");
    const result = await processIncomingLocation("27821234567", -26.1, 28.0);

    expect(clockPendingDelete).toHaveBeenCalledWith({ where: { waFrom: "27821234567" } });
    expect(validateAndRecordOperationalAttendance).not.toHaveBeenCalled();
    expect(result.reply).toContain("That request expired");
  });

  it("routes operational guards to operationalAttendanceService with intent and messageId", async () => {
    const guardEmp = { id: "emp-guard", companyId: "co-1", phone: "0821234567" };
    findMany.mockResolvedValue([guardEmp]);
    findEmployeeUnique.mockResolvedValue({ id: "emp-guard", employeeType: "guard", status: "ACTIVE" });
    clockPendingFindUnique.mockResolvedValue({
      waFrom: "27821234567",
      employeeId: "emp-guard",
      companyId: "co-1",
      intent: "clock_in",
      expiresAt: new Date(Date.now() + 600000), // Valid for 10 mins
    });
    validateAndRecordOperationalAttendance.mockResolvedValue({
      success: true,
      status: "VERIFIED",
      message: "✅ Clock-in successful. Distance: 15m (Allowed: 100m).",
    });

    const { processIncomingLocation } = await import("../services/handler.service.js");
    const result = await processIncomingLocation("27821234567", -26.1952, 28.0341, "wamid.msg123");

    expect(clockPendingDeleteMany).toHaveBeenCalledWith({ where: { waFrom: "27821234567" } });
    expect(validateAndRecordOperationalAttendance).toHaveBeenCalledWith({
      employeeId: "emp-guard",
      latitude: -26.1952,
      longitude: 28.0341,
      intent: "clock_in",
      whatsappMessageId: "wamid.msg123",
      whatsappNumber: "27821234567",
    });
    expect(result.reply).toContain("Clock-in successful");
  });
});

