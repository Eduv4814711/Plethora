import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstEmployee = vi.fn();
const findUniqueEmployee = vi.fn();
const findFirstAttendance = vi.fn();
const findManyShifts = vi.fn();
const findManyLeaves = vi.fn();
const findFirstSite = vi.fn();
const findManySites = vi.fn();
const findUniqueSite = vi.fn();
const findFirstUser = vi.fn();
const createIncident = vi.fn();

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    employee: {
      findFirst: (...args: any[]) => findFirstEmployee(...args),
      findUnique: (...args: any[]) => findUniqueEmployee(...args),
    },
    attendance: {
      findFirst: (...args: any[]) => findFirstAttendance(...args),
    },
    staffAttendanceDay: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    shift: {
      findMany: (...args: any[]) => findManyShifts(...args),
    },
    leaveRequest: {
      findMany: (...args: any[]) => findManyLeaves(...args),
    },
    site: {
      findFirst: (...args: any[]) => findFirstSite(...args),
      findMany: (...args: any[]) => findManySites(...args),
      findUnique: (...args: any[]) => findUniqueSite(...args),
    },
    user: {
      findFirst: (...args: any[]) => findFirstUser(...args),
    },
    incident: {
      create: (...args: any[]) => createIncident(...args),
    },
  },
}));

vi.mock("../../lib/timezone.js", () => ({
  getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg"),
}));

const getLeaveBalancesMock = vi.fn().mockResolvedValue([
  { leaveType: "ANNUAL", availableUnits: 12 },
  { leaveType: "SICK", availableUnits: 10 },
]);
const createLeaveRequestMock = vi.fn().mockResolvedValue({
  id: "sick-leave-900",
  leaveType: "SICK",
  status: "PENDING",
});

vi.mock("../../services/leave-v3.service.js", () => ({
  getLeaveBalances: (...args: any[]) => getLeaveBalancesMock(...args),
  createLeaveRequest: (...args: any[]) => createLeaveRequestMock(...args),
  previewLeaveRequest: vi.fn().mockResolvedValue({
    leaveType: "SICK",
    deductibleUnits: 2,
    availableUnits: 10,
    exceedsBalance: false,
    documentRequired: false,
    documentRequirementReason: null,
    studyProofRequired: false,
    maxDaysForScenario: null,
  }),
  attachLeaveSupportingDocument: vi.fn().mockResolvedValue({ id: "doc-1" }),
  defaultDocumentKindForLeaveType: vi.fn().mockReturnValue("SICK_NOTE"),
  LeaveV3Error: class LeaveV3Error extends Error {},
}));

vi.mock("../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../modules/alerts/alerts.service.js", () => ({
  upsertAlert: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../modules/incidents/incidents.service.js", () => ({
  nextIncidentNumber: vi.fn().mockResolvedValue("INC-20261126-0042"),
  severityToAlertPriority: vi.fn().mockReturnValue("HIGH"),
}));

vi.mock("../services/supervisor-escalation.service.js", () => ({
  dispatchSupervisorEscalation: vi.fn().mockResolvedValue({ dispatched: true }),
}));

import { classifyWhatsAppIntent } from "../../services/ai/whatsapp-intent.service.js";
import {
  parseUserDate,
  startSmartLeaveFlow,
  handleLeaveAwaitingDocumentText,
  handleLeaveConfirm,
} from "../services/leave-flow.service.js";
import {
  startSmartIncidentFlow,
  handleIncidentConfirm,
} from "../services/incident-flow.service.js";
import { answerEmployeeOperationalQuestion } from "../services/whatsapp-assistant.service.js";
import { sessionManager } from "../services/session.service.js";

describe("AI WhatsApp Upgrade (Kimi K3.1 entity extraction, fast-track flows & grounded Q&A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager.deleteSession("27829990001");
  });

  it("extracts structured leaveParams and coerces null optional fields cleanly", async () => {
    const mockChat = vi.fn(async () => ({
      content: JSON.stringify({
        intent: "LEAVE_APPLY",
        confidence: 0.96,
        reply: null,
        leaveParams: {
          leaveType: "SICK",
          startDateIso: "2026-11-27",
          endDateIso: "2026-11-28",
          reason: "Doctor appointment for flu",
        },
        incidentParams: null,
      }),
      model: "global.moonshotai.kimi-k3.1",
      latencyMs: 420,
    }));

    const res = await classifyWhatsAppIntent(
      "Ngiyagula kusasa noLwesihlanu, need sick leave for clinic",
      { firstName: "Sipho", employeeType: "security_officer", todayIso: "2026-11-26" },
      mockChat
    );

    expect(res).toEqual({
      intent: "LEAVE_APPLY",
      confidence: 0.96,
      reply: undefined,
      leaveParams: {
        leaveType: "SICK",
        startDateIso: "2026-11-27",
        endDateIso: "2026-11-28",
        reason: "Doctor appointment for flu",
      },
      incidentParams: undefined,
    });
  });

  it("parses human date expressions in parseUserDate", () => {
    const ref = new Date("2026-11-26T08:00:00Z"); // Thursday
    expect(parseUserDate("28 Nov 2026", ref)?.getDate()).toBe(28);
    expect(parseUserDate("28/11/2026", ref)?.getMonth()).toBe(10);
    const friday = parseUserDate("friday", ref);
    expect(friday?.getDay()).toBe(5);
  });

  it("routes SICK leave through LEAVE_AWAITING_DOCUMENT (optional <=2d BCEA) to LEAVE_CONFIRM and LEAVE_AWAITING_CERTIFICATE", async () => {
    const phone = "27829990001";
    const step = await startSmartLeaveFlow(phone, "emp-1", "co-1", {
      leaveType: "SICK",
      startDateIso: "2026-11-27",
      endDateIso: "2026-11-28",
      reason: "Medical clinic visit",
    });

    expect(step.reply).toMatch(/Attach Sick Note/i);
    expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_AWAITING_DOCUMENT");
    expect(createLeaveRequestMock).not.toHaveBeenCalled();

    const afterSkip = await handleLeaveAwaitingDocumentText(
      phone,
      "skip",
      sessionManager.getSession(phone)!
    );
    expect(afterSkip.reply).toMatch(/AI Pre-Filled Leave Application/i);
    expect(afterSkip.reply).toMatch(/2 days/i);
    expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_CONFIRM");

    const session = sessionManager.getSession(phone)!;
    const confirmed = await handleLeaveConfirm(phone, "leave_confirm_yes", session);
    expect(createLeaveRequestMock).toHaveBeenCalledTimes(1);
    expect(confirmed.reply).toMatch(/Leave Application Submitted/i);
    expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_AWAITING_CERTIFICATE");
    expect(sessionManager.getSession(phone)?.data.leaveRequestId).toBe("sick-leave-900");
  });

  it("stages INCIDENT_CONFIRM on one-shot incident report and preserves both OB summary and verbatim report", async () => {
    const phone = "27829990001";
    findFirstAttendance.mockResolvedValue({
      id: "att-1",
      clockIn: new Date(),
      shift: { site: { id: "site-sandton", name: "Sandton Gate" } },
    });
    findManySites.mockResolvedValue([{ id: "site-sandton", name: "Sandton Gate" }]);
    findUniqueEmployee.mockResolvedValue({
      id: "emp-1",
      firstName: "Sipho",
      lastName: "Dlamini",
      phone,
      email: "sipho@test.co.za",
    });
    findFirstUser.mockResolvedValue({ id: "user-1" });
    findUniqueSite.mockResolvedValue({ id: "site-sandton", name: "Sandton Gate", supervisorId: "user-1" });
    createIncident.mockImplementation(async ({ data }: any) => ({
      id: "inc-99",
      incidentNumber: data.incidentNumber,
      title: data.title,
      description: data.description,
      severity: data.severity,
      status: data.status,
      incidentDateTime: data.incidentDateTime,
      siteId: data.siteId,
      assignedSupervisorId: data.assignedSupervisorId,
      createdAt: new Date(),
    }));

    const preview = await startSmartIncidentFlow(phone, "emp-1", "co-1", {
      categoryKey: "4",
      details: "north perimeter electric fence wire cut near gate 2 at 02h10",
    });

    expect(preview.reply).toMatch(/Confirm Incident Report/i);
    expect(preview.reply).toMatch(/Sandton Gate/i);
    expect(createIncident).not.toHaveBeenCalled();

    const session = sessionManager.getSession(phone)!;
    session.data.polishedSummary =
      "At 02:10, a cut wire was discovered on the north perimeter electric fence near Gate 2.";

    const logged = await handleIncidentConfirm(phone, "inc_confirm_yes", session);
    expect(logged.reply).toMatch(/INC-20261126-0042/);
    expect(createIncident).toHaveBeenCalledTimes(1);
    const createdDesc = createIncident.mock.calls[0]![0].data.description as string;
    expect(createdDesc).toContain("[AI Structured OB Summary]");
    expect(createdDesc).toContain("[Verbatim Guard Report]");
    expect(createdDesc).toContain("north perimeter electric fence wire cut near gate 2 at 02h10");
  });

  it("answers grounded compliance questions strictly from verified tenant/employee records", async () => {
    findFirstEmployee.mockResolvedValue({
      psiraGrade: "B",
      psiraRegistrationNumber: "PSIRA-884120",
      psiraRegistrationExpiry: new Date("2027-06-30T00:00:00.000Z"),
      armedGuard: true,
      firearmCompetency: true,
      firearmCompetencyExpiry: new Date("2027-03-15T00:00:00.000Z"),
    });
    findFirstAttendance.mockResolvedValue(null);
    findManyShifts.mockResolvedValue([]);
    findManyLeaves.mockResolvedValue([]);

    const mockChat = vi.fn(async ({ messages }: any) => {
      expect(messages[1].content).toContain("PSIRA-884120");
      return {
        content:
          "Your PSIRA Grade B registration (PSIRA-884120) expires on 2027-06-30, and your firearm competency expires on 2027-03-15.",
        model: "global.moonshotai.kimi-k3.1",
        latencyMs: 310,
      };
    });

    const answer = await answerEmployeeOperationalQuestion(
      {
        id: "emp-1",
        companyId: "co-1",
        firstName: "Sipho",
        lastName: "Dlamini",
      },
      "When does my PSIRA and firearm expire?",
      "COMPLIANCE_STATUS",
      mockChat,
      true
    );

    expect(answer.aiUsed).toBe(true);
    expect(answer.reply).toContain("PSIRA-884120");
    expect(findFirstEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "emp-1", companyId: "co-1" },
      })
    );
  });
});
