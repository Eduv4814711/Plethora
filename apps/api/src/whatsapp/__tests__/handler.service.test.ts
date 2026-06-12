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
