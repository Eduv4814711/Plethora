import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstEmployee = vi.fn();
const findUniqueCompany = vi.fn();
const findManyUsers = vi.fn();
const findFirstLeave = vi.fn();
const findManyLeave = vi.fn();
const countLeave = vi.fn();
const createLeave = vi.fn();
const updateManyLeave = vi.fn();
const findUniqueOrThrowLeave = vi.fn();
const findManyAdjustment = vi.fn();
const createAudit = vi.fn();
const findUniqueMedCert = vi.fn();
const createMedCert = vi.fn();
const createSupportingDoc = vi.fn();
const createWhatsAppMsg = vi.fn();

const createNotificationMock = vi.fn().mockResolvedValue({ created: true });
const sendTextWithTemplateFallbackMock = vi.fn().mockResolvedValue({
  success: true,
  messageId: "wamid.outcome.123",
  usedTemplate: false,
});
const broadcastMock = vi.fn();

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    employee: {
      findFirst: (...args: any[]) => findFirstEmployee(...args),
    },
    company: {
      findUnique: (...args: any[]) => findUniqueCompany(...args),
    },
    user: {
      findMany: (...args: any[]) => findManyUsers(...args),
    },
    leaveRequest: {
      findFirst: (...args: any[]) => findFirstLeave(...args),
      findMany: (...args: any[]) => findManyLeave(...args),
      count: (...args: any[]) => countLeave(...args),
      create: (...args: any[]) => createLeave(...args),
      updateMany: (...args: any[]) => updateManyLeave(...args),
      findUniqueOrThrow: (...args: any[]) => findUniqueOrThrowLeave(...args),
    },
    leaveAdjustment: {
      findMany: (...args: any[]) => findManyAdjustment(...args),
    },
    leaveAuditLog: {
      create: (...args: any[]) => createAudit(...args),
    },
    medicalCertificate: {
      findUnique: (...args: any[]) => findUniqueMedCert(...args),
      create: (...args: any[]) => createMedCert(...args),
    },
    leaveSupportingDocument: {
      create: (...args: any[]) => createSupportingDoc(...args),
    },
    whatsAppMessage: {
      create: (...args: any[]) => createWhatsAppMsg(...args),
    },
    $transaction: async (fn: (tx: any) => Promise<any>) =>
      fn({
        employee: { findFirst: (...args: any[]) => findFirstEmployee(...args) },
        leaveRequest: {
          findFirst: (...args: any[]) => findFirstLeave(...args),
          findMany: (...args: any[]) => findManyLeave(...args),
          create: (...args: any[]) => createLeave(...args),
          updateMany: (...args: any[]) => updateManyLeave(...args),
          findUniqueOrThrow: (...args: any[]) => findUniqueOrThrowLeave(...args),
        },
        leaveAdjustment: {
          findMany: (...args: any[]) => findManyAdjustment(...args),
        },
      }),
  },
}));

vi.mock("../../modules/notifications/notifications.service.js", () => ({
  createNotification: (...args: any[]) => createNotificationMock(...args),
}));

vi.mock("../../whatsapp/services/send.service.js", () => ({
  sendTextWithTemplateFallback: (...args: any[]) => sendTextWithTemplateFallbackMock(...args),
  templateBodyParameters: (vals: unknown[]) => [{ type: "body", parameters: vals }],
}));

vi.mock("../../lib/events.js", () => ({
  operationalEventBus: {
    broadcast: (...args: any[]) => broadcastMock(...args),
  },
}));

import {
  attachLeaveSupportingDocument,
  createLeaveRequest,
  decideLeaveRequest,
} from "../leave-v3.service.js";

describe("Leave BCEA & Two-Way WhatsApp / HR Communications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstEmployee.mockResolvedValue({
      id: "emp-1",
      companyId: "comp-1",
      firstName: "Thabo",
      lastName: "Mokoena",
      phone: "27821234567",
      employeeType: "security_officer",
      commencementDate: new Date("2024-01-01T00:00:00.000Z"),
      sickLeaveCycleAnchor: null,
    });
    findUniqueCompany.mockResolvedValue({ ownerUserId: "user-owner" });
    findManyUsers.mockResolvedValue([
      {
        id: "user-hr",
        capabilities: { "/employees/leave": ["view", "approve"] },
        accountType: "staff",
      },
      {
        id: "user-guard",
        capabilities: { "/": ["view"] },
        accountType: "staff",
      },
    ]);
    findManyLeave.mockResolvedValue([]);
    findManyAdjustment.mockResolvedValue([]);
    countLeave.mockResolvedValue(0);
    createAudit.mockResolvedValue({});
    createWhatsAppMsg.mockResolvedValue({});
  });

  it("notifies HR approvers and broadcasts LEAVE_REQUEST_CREATED when leave is submitted", async () => {
    findFirstLeave.mockResolvedValue(null);
    createLeave.mockResolvedValue({
      id: "leave-101",
      companyId: "comp-1",
      employeeId: "emp-1",
      leaveType: "STUDY",
      startDate: new Date("2026-12-01T00:00:00.000Z"),
      endDate: new Date("2026-12-02T00:00:00.000Z"),
      unitsRequested: 2,
      status: "PENDING",
    });

    await createLeaveRequest("comp-1", "emp-1", {
      employeeId: "emp-1",
      leaveType: "STUDY",
      startDate: new Date("2026-12-01T00:00:00.000Z"),
      endDate: new Date("2026-12-02T00:00:00.000Z"),
      unitsRequested: 2,
      reason: "PSIRA Grade B Exam",
    });

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "comp-1",
        userId: "user-hr",
        sourceModule: "LEAVE",
        sourceId: "leave-101",
        linkUrl: "/employees/leave?tab=queue",
      })
    );
    expect(broadcastMock).toHaveBeenCalledWith(
      "LEAVE_REQUEST_CREATED",
      "comp-1",
      expect.objectContaining({
        id: "leave-101",
        leaveType: "STUDY",
        documentRequired: true,
      })
    );
  });

  it("sends a WhatsApp outcome message with remaining balance when HR approves or rejects leave", async () => {
    const pendingRow = {
      id: "leave-202",
      companyId: "comp-1",
      employeeId: "emp-1",
      leaveType: "SICK",
      startDate: new Date("2026-12-01T00:00:00.000Z"),
      endDate: new Date("2026-12-03T00:00:00.000Z"),
      unitsRequested: 3,
      status: "PENDING",
      familyResponsibilityReason: null,
      parentalLeaveScenario: null,
    };

    findFirstLeave.mockResolvedValue(pendingRow);
    updateManyLeave.mockResolvedValue({ count: 1 });
    findUniqueOrThrowLeave.mockResolvedValue({
      ...pendingRow,
      status: "REJECTED",
      decisionReason: "Missing valid doctor stamp",
    });

    await decideLeaveRequest({
      companyId: "comp-1",
      actorUserId: "user-hr",
      requestId: "leave-202",
      decision: "REJECTED",
      reason: "Missing valid doctor stamp",
    });

    expect(sendTextWithTemplateFallbackMock).toHaveBeenCalledTimes(1);
    const [phone, text, fallback] = sendTextWithTemplateFallbackMock.mock.calls[0]!;
    expect(phone).toBe("27821234567");
    expect(text).toContain("DECLINED");
    expect(text).toContain("Missing valid doctor stamp");
    expect(text).toContain("Remaining Sick Leave Balance");
    expect(fallback.name).toBe("plethora_leave_decision");
    expect(createWhatsAppMsg).toHaveBeenCalledTimes(1);
    expect(broadcastMock).toHaveBeenCalledWith(
      "LEAVE_REQUEST_DECIDED",
      "comp-1",
      expect.objectContaining({ id: "leave-202", status: "REJECTED" })
    );
  });

  it("attaches supporting study proof and sick notes via attachLeaveSupportingDocument", async () => {
    findFirstLeave.mockResolvedValueOnce({
      id: "leave-study-1",
      employeeId: "emp-1",
      leaveType: "STUDY",
      startDate: new Date("2026-12-01T00:00:00.000Z"),
      endDate: new Date("2026-12-01T00:00:00.000Z"),
    });
    createSupportingDoc.mockResolvedValueOnce({
      id: "doc-1",
      kind: "STUDY_PROOF",
      fileName: "exam-timetable.pdf",
    });

    const studyDoc = await attachLeaveSupportingDocument({
      companyId: "comp-1",
      actorUserId: "emp-1",
      leaveRequestId: "leave-study-1",
      kind: "STUDY_PROOF",
      fileName: "exam-timetable.pdf",
      mimeType: "application/pdf",
      fileReference: "s3://bucket/leave-documents/comp-1/leave-study-1/exam.pdf",
    });

    expect(studyDoc.kind).toBe("STUDY_PROOF");
    expect(createMedCert).not.toHaveBeenCalled();
  });
});
