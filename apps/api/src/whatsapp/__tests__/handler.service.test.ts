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

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    employee: { findMany },
    whatsAppClockPending: { findUnique: vi.fn(), delete: vi.fn(), upsert: vi.fn() },
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
