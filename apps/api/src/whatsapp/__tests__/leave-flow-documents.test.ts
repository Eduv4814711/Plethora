import { beforeEach, describe, expect, it, vi } from "vitest";

const previewLeaveRequestMock = vi.fn();
const createLeaveRequestMock = vi.fn();
const attachLeaveSupportingDocumentMock = vi.fn();
const getLeaveBalancesMock = vi.fn();
const findFirstEmployeeMock = vi.fn();

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    employee: {
      findFirst: (...args: any[]) => findFirstEmployeeMock(...args),
    },
  },
}));

vi.mock("../../services/leave-v3.service.js", () => ({
  previewLeaveRequest: (...args: any[]) => previewLeaveRequestMock(...args),
  createLeaveRequest: (...args: any[]) => createLeaveRequestMock(...args),
  attachLeaveSupportingDocument: (...args: any[]) => attachLeaveSupportingDocumentMock(...args),
  getLeaveBalances: (...args: any[]) => getLeaveBalancesMock(...args),
  defaultDocumentKindForLeaveType: (leaveType: string) => {
    if (leaveType === "SICK") return "SICK_NOTE";
    if (leaveType === "STUDY") return "STUDY_PROOF";
    if (leaveType === "FAMILY_RESPONSIBILITY") return "FAMILY_RESPONSIBILITY_PROOF";
    return "OTHER";
  },
  LeaveV3Error: class LeaveV3Error extends Error {
    statusCode = 400;
    code = "ERROR";
  },
}));

import {
  attachDraftDocumentToLeaveSession,
  handleLeaveAwaitingDocumentText,
  handleLeaveConfirm,
  handleLeaveSelectFamilyReason,
  handleLeaveSelectType,
  startLeaveFlow,
  startSmartLeaveFlow,
} from "../services/leave-flow.service.js";
import { sessionManager } from "../services/session.service.js";

describe("WhatsApp BCEA Leave Flow & Mandatory Supporting Documents", () => {
  const phone = "27825550001";

  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager.deleteSession(phone);
    findFirstEmployeeMock.mockResolvedValue({
      employeeType: "security_officer",
      commencementDate: new Date("2024-01-01T00:00:00.000Z"),
    });
    getLeaveBalancesMock.mockResolvedValue([
      { leaveType: "ANNUAL", availableUnits: 21 },
      { leaveType: "SICK", availableUnits: 24 },
      { leaveType: "STUDY", availableUnits: 6 },
    ]);
  });

  it("blocks STUDY leave submission until school/study proof is attached", async () => {
    previewLeaveRequestMock.mockResolvedValue({
      leaveType: "STUDY",
      deductibleUnits: 2,
      availableUnits: 6,
      exceedsBalance: false,
      documentRequired: true,
      documentRequirementReason: "Study leave requires proof of registration or exam timetable.",
      studyProofRequired: true,
      maxDaysForScenario: null,
    });

    const step1 = await startSmartLeaveFlow(phone, "emp-1", "comp-1", {
      leaveType: "STUDY",
      startDateIso: "2026-12-01",
      endDateIso: "2026-12-02",
      reason: "PSIRA Grade A Exam",
    });

    expect(step1.reply).toMatch(/Study \/ School Proof Required/i);
    expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_AWAITING_DOCUMENT");

    // Trying to skip a mandatory study proof keeps user in LEAVE_AWAITING_DOCUMENT
    const skipAttempt = await handleLeaveAwaitingDocumentText(
      phone,
      "skip",
      sessionManager.getSession(phone)!
    );
    expect(skipAttempt.reply).toMatch(/Study \/ School Proof Required/i);
    expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_AWAITING_DOCUMENT");

    // Attaching study proof moves to LEAVE_CONFIRM and persists attachment on submit
    const confirmStep = attachDraftDocumentToLeaveSession(
      phone,
      sessionManager.getSession(phone)!,
      {
        kind: "STUDY_PROOF",
        fileName: "exam-letter.pdf",
        mimeType: "application/pdf",
        fileReference: "s3://bucket/leave-documents/comp-1/drafts/exam-letter.pdf",
      }
    );
    expect(confirmStep.reply).toMatch(/exam-letter\.pdf/);
    expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_CONFIRM");

    createLeaveRequestMock.mockResolvedValue({ id: "study-leave-1", status: "PENDING" });
    const submitted = await handleLeaveConfirm(phone, "yes", sessionManager.getSession(phone)!);
    expect(createLeaveRequestMock).toHaveBeenCalledTimes(1);
    expect(attachLeaveSupportingDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        leaveRequestId: "study-leave-1",
        kind: "STUDY_PROOF",
        fileName: "exam-letter.pdf",
      })
    );
    expect(submitted.reply).toMatch(/HR has been notified/i);
  });

  it("enforces sick note upload when BCEA §23 requires it (>2 consecutive days)", async () => {
    previewLeaveRequestMock.mockResolvedValue({
      leaveType: "SICK",
      deductibleUnits: 3,
      availableUnits: 24,
      exceedsBalance: false,
      documentRequired: true,
      documentRequirementReason: "BCEA §23 requires a medical certificate for sick leave exceeding 2 consecutive work units.",
      studyProofRequired: false,
      maxDaysForScenario: null,
    });

    const step = await startSmartLeaveFlow(phone, "emp-1", "comp-1", {
      leaveType: "SICK",
      startDateIso: "2026-12-01",
      endDateIso: "2026-12-03",
      reason: "Flu",
    });

    expect(step.reply).toMatch(/BCEA §23/i);
    expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_AWAITING_DOCUMENT");

    const skipAttempt = await handleLeaveAwaitingDocumentText(
      phone,
      "skip",
      sessionManager.getSession(phone)!
    );
    expect(skipAttempt.reply).toMatch(/Medical Certificate Required/i);
    expect(createLeaveRequestMock).not.toHaveBeenCalled();
  });

  it("hides Study Leave for general employees and prompts BCEA §27 Family Responsibility reason", async () => {
    findFirstEmployeeMock.mockResolvedValue({
      employeeType: "general",
      commencementDate: new Date("2024-01-01T00:00:00.000Z"),
    });
    getLeaveBalancesMock.mockResolvedValue([
      { leaveType: "ANNUAL", availableUnits: 21 },
      { leaveType: "SICK", availableUnits: 30 },
    ]);

    const menu = await startLeaveFlow(phone, "emp-gen", "comp-1");
    expect(menu.reply).not.toMatch(/Study Leave/i);

    const frStep = await handleLeaveSelectType(phone, "3", sessionManager.getSession(phone)!);
    expect(frStep.reply).toMatch(/BCEA §27/i);
    expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_SELECT_FAMILY_REASON");

    const reasonChosen = await handleLeaveSelectFamilyReason(
      phone,
      "4",
      sessionManager.getSession(phone)!
    );
    expect(sessionManager.getSession(phone)?.data.familyResponsibilityReason).toBe("PARENT_DEATH");
    expect(reasonChosen.reply).toMatch(/Leave Start Date/i);
  });
});
