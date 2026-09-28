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

const mockEmployee = {
  id: "emp-101",
  companyId: "co-101",
  firstName: "Sipho",
  lastName: "Dlamini",
  phone: "27821234567",
  email: "sipho@security.co.za",
};

const mockSite = {
  id: "site-201",
  name: "Sandton City Mall",
  companyId: "co-101",
  supervisorId: "user-sup-1",
};

const mockUser = {
  id: "user-sup-1",
  name: "Supervisor John",
  companyId: "co-101",
};

const mockIncident = {
  id: "inc-301",
  incidentNumber: "INC-20260924-0001",
  companyId: "co-101",
  siteId: "site-201",
  reportedById: "user-sup-1",
  title: "Site Emergency / Safety Risk: Sandton City Mall",
  description: "Gate malfunction causing security breach",
  severity: "CRITICAL",
  status: "SUBMITTED",
  supervisorApprovalStatus: "PENDING",
};

const mockLeaveRequest = {
  id: "leave-req-401",
  companyId: "co-101",
  employeeId: "emp-101",
  leaveType: "ANNUAL",
  startDate: new Date("2026-10-01T00:00:00.000Z"),
  endDate: new Date("2026-10-03T00:00:00.000Z"),
  unitsRequested: 3,
  status: "PENDING",
};

const findManyEmployees = vi.fn().mockResolvedValue([mockEmployee]);
const findUniqueEmployee = vi.fn().mockResolvedValue(mockEmployee);
const findFirstAttendance = vi.fn().mockResolvedValue(null);
const countAttendance = vi.fn().mockResolvedValue(1);
const createAttendance = vi.fn().mockResolvedValue({ id: "att-1" });
const updateAttendance = vi.fn().mockResolvedValue({ id: "att-1" });
const findManyShifts = vi.fn().mockResolvedValue([]);
const findFirstShift = vi.fn().mockResolvedValue(null);
const updateShift = vi.fn().mockResolvedValue({ id: "shift-1" });
const findFirstSite = vi.fn().mockImplementation((args?: any) => {
  const contains = args?.where?.name?.contains;
  if (contains && !String(mockSite.name).toLowerCase().includes(String(contains).toLowerCase())) {
    return Promise.resolve(null);
  }
  return Promise.resolve(mockSite);
});
const findUniqueSite = vi.fn().mockResolvedValue(mockSite);
const findManySites = vi.fn().mockResolvedValue([mockSite]);
const findFirstUser = vi.fn().mockResolvedValue(mockUser);
const createIncident = vi.fn().mockResolvedValue(mockIncident);
const findFirstIncident = vi.fn().mockResolvedValue(mockIncident);
const createIncidentAttachment = vi.fn().mockResolvedValue({ id: "att-doc-1" });
const createLeaveRequestMock = vi.fn().mockResolvedValue(mockLeaveRequest);
const countLeaveRequests = vi.fn().mockResolvedValue(0);
const createAuditLogMock = vi.fn().mockResolvedValue({});
const upsertAlertMock = vi.fn().mockResolvedValue({ id: "alert-1" });

vi.mock("../../services/attendance.service.js", () => ({
  validateClockIn: vi.fn().mockResolvedValue(undefined),
  calculateHours: vi.fn().mockReturnValue({ hoursWorked: 8, overtimeHours: 0 }),
  assertWithinSiteGeofence: vi.fn(),
  AttendanceValidationError: class AttendanceValidationError extends Error {},
}));

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    employee: {
      findMany: (...args: any[]) => findManyEmployees(...args),
      findUnique: (...args: any[]) => findUniqueEmployee(...args),
    },
    attendance: {
      findFirst: (...args: any[]) => findFirstAttendance(...args),
      count: (...args: any[]) => countAttendance(...args),
      create: (...args: any[]) => createAttendance(...args),
      update: (...args: any[]) => updateAttendance(...args),
    },
    shift: {
      findMany: (...args: any[]) => findManyShifts(...args),
      findFirst: (...args: any[]) => findFirstShift(...args),
      update: (...args: any[]) => updateShift(...args),
    },
    site: {
      findFirst: (...args: any[]) => findFirstSite(...args),
      findUnique: (...args: any[]) => findUniqueSite(...args),
      findMany: (...args: any[]) => findManySites(...args),
    },
    user: {
      findFirst: (...args: any[]) => findFirstUser(...args),
    },
    incident: {
      create: (...args: any[]) => createIncident(...args),
      findFirst: (...args: any[]) => findFirstIncident(...args),
    },
    incidentAttachment: {
      create: (...args: any[]) => createIncidentAttachment(...args),
    },
    leaveRequest: {
      count: (...args: any[]) => countLeaveRequests(...args),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    whatsAppClockPending: {
      findUnique: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    staffAttendanceDay: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../../lib/audit.js", () => ({
  createAuditLog: (...args: any[]) => createAuditLogMock(...args),
}));

vi.mock("../../modules/alerts/alerts.service.js", () => ({
  upsertAlert: (...args: any[]) => upsertAlertMock(...args),
}));

vi.mock("../../modules/incidents/incidents.service.js", () => ({
  nextIncidentNumber: vi.fn().mockResolvedValue("INC-20260924-0001"),
  severityToAlertPriority: vi.fn().mockImplementation((sev: string) => (sev === "CRITICAL" ? "CRITICAL" : "MEDIUM")),
}));

vi.mock("../../services/leave-v3.service.js", () => ({
  createLeaveRequest: (...args: any[]) => createLeaveRequestMock(...args),
  getLeaveBalances: vi.fn().mockResolvedValue([]),
  cancelLeaveRequest: vi.fn().mockResolvedValue({}),
  attachMedicalCertificate: vi.fn().mockResolvedValue({}),
  LeaveV3Error: class LeaveV3Error extends Error {},
}));

vi.mock("../../lib/timezone.js", () => ({
  getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg"),
}));

describe("WhatsApp Conversation State Machine & Micro-Prompts", () => {
  const phone = "27821234567";

  beforeEach(async () => {
    vi.clearAllMocks();
    const { sessionManager } = await import("../services/session.service.js");
    sessionManager.resetAllSessions();
  });

  describe("1. Main Menu & Intent Routing", () => {
    it("returns interactive main menu when user sends 'menu' or 'help'", async () => {
      const { processIncomingMessage } = await import("../services/handler.service.js");
      const result = await processIncomingMessage(phone, "menu");

      expect("sendInteractiveList" in result).toBe(true);
      if ("sendInteractiveList" in result) {
        expect(result.sendInteractiveList.rows.length).toBeGreaterThanOrEqual(8);
        expect(result.sendInteractiveList.rows[0]?.title).toMatch(/Clock In/i);
      }
    });

    it("resets conversation to IDLE and confirms when user sends 'cancel'", async () => {
      const { processIncomingMessage } = await import("../services/handler.service.js");
      const { sessionManager } = await import("../services/session.service.js");

      // Place user in an active flow
      sessionManager.setSessionState(phone, "INCIDENT_SELECT_TYPE", { employeeId: "emp-101", companyId: "co-101" });

      const result = await processIncomingMessage(phone, "cancel");
      expect("reply" in result).toBe(true);
      if ("reply" in result) {
        expect(result.reply).toMatch(/cancelled/i);
      }

      const session = sessionManager.getSession(phone);
      expect(session?.state).toBe("IDLE");
    });
  });

  describe("2. Incident Reporting Multi-Step Micro-Prompts", () => {
    it("guides user through complete incident reporting flow step-by-step", async () => {
      const { processIncomingMessage } = await import("../services/handler.service.js");
      const { sessionManager } = await import("../services/session.service.js");

      // Step 0: Trigger incident flow via keyword or number 3
      const step1 = await processIncomingMessage(phone, "3");
      expect("reply" in step1).toBe(true);
      if ("reply" in step1) {
        expect(step1.reply).toMatch(/Report an Incident.*Step 1\/3/i);
        expect(step1.reply).toMatch(/Site Emergency/i);
      }
      expect(sessionManager.getSession(phone)?.state).toBe("INCIDENT_SELECT_TYPE");

      // Step 1: Select category (1: Site Emergency)
      const step2 = await processIncomingMessage(phone, "1");
      expect("reply" in step2).toBe(true);
      if ("reply" in step2) {
        expect(step2.reply).toMatch(/Site (Confirmation|Selection).*Step 2\/3/i);
      }
      expect(sessionManager.getSession(phone)?.state).toBe("INCIDENT_SELECT_SITE");

      // Step 2: Select site (enter site name or 1)
      const step3 = await processIncomingMessage(phone, "Sandton City Mall");
      expect("reply" in step3).toBe(true);
      if ("reply" in step3) {
        expect(step3.reply).toMatch(/Incident Details.*Step 3\/3/i);
      }
      expect(sessionManager.getSession(phone)?.state).toBe("INCIDENT_ENTER_DETAILS");

      // Step 3: Enter details description
      const step4 = await processIncomingMessage(phone, "Intruder attempted to scale perimeter wall at north gate.");
      expect("reply" in step4).toBe(true);
      if ("reply" in step4) {
        expect(step4.reply).toMatch(/Incident Logged Successfully/i);
        expect(step4.reply).toMatch(/INC-20260924-0001/);
        expect(step4.reply).toMatch(/Attach Photo/i);
      }

      // Verify Incident was created in DB and alert was created
      expect(createIncident).toHaveBeenCalledTimes(1);
      expect(upsertAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceModule: "INCIDENTS",
          title: expect.stringContaining("INC-20260924-0001"),
        })
      );

      // Verify session transitions to await photo
      expect(sessionManager.getSession(phone)?.state).toBe("INCIDENT_AWAITING_PHOTO");
    });

    it("presents numbered site selection list in step 2 and selects site by number", async () => {
      const { processIncomingMessage } = await import("../services/handler.service.js");
      const { sessionManager } = await import("../services/session.service.js");

      findManySites.mockResolvedValueOnce([
        mockSite,
        { id: "site-202", name: "Rosebank Link Tower", companyId: "co-101" },
      ]);

      // Step 1: Trigger incident
      await processIncomingMessage(phone, "report");
      const step2 = await processIncomingMessage(phone, "2");

      expect("reply" in step2).toBe(true);
      if ("reply" in step2) {
        expect(step2.reply).toContain("📍 *Site Selection* (Step 2/3)");
        expect(step2.reply).toContain("1️⃣ *Sandton City Mall*");
        expect(step2.reply).toContain("2️⃣ *Rosebank Link Tower*");
        expect(step2.reply).toContain("Reply with the site number (*1–2*)");
        expect(step2.buttons).toHaveLength(2);
        expect(step2.buttons?.[1]?.id).toBe("inc_site_2");
        expect(step2.buttons?.[1]?.title).toContain("Rosebank");
      }

      // Test invalid selection -> re-displays list with warning
      const invalidStep2 = await processIncomingMessage(phone, "99");
      expect("reply" in invalidStep2).toBe(true);
      if ("reply" in invalidStep2) {
        expect(invalidStep2.reply).toContain("⚠️ Site \"99\" not recognized.");
        expect(invalidStep2.reply).toContain("1️⃣ *Sandton City Mall*");
        expect(invalidStep2.reply).toContain("2️⃣ *Rosebank Link Tower*");
      }

      // Step 2: Select site 2 by replying with number "2"
      const step3 = await processIncomingMessage(phone, "2");
      expect("reply" in step3).toBe(true);
      if ("reply" in step3) {
        expect(step3.reply).toContain("📝 *Incident Details* (Step 3/3)");
        expect(step3.reply).toContain("Site: *Rosebank Link Tower*");
      }
      expect(sessionManager.getSession(phone)?.state).toBe("INCIDENT_ENTER_DETAILS");
      expect(sessionManager.getSession(phone)?.data.siteId).toBe("site-202");
    });

    it("rejects invalid incident category with clear user error message", async () => {
      const { processIncomingMessage } = await import("../services/handler.service.js");

      await processIncomingMessage(phone, "incident");
      const badCategory = await processIncomingMessage(phone, "invalid_option");

      expect("reply" in badCategory).toBe(true);
      if ("reply" in badCategory) {
        expect(badCategory.reply).toMatch(/Invalid category selection/i);
        expect(badCategory.reply).toMatch(/1 to 5/i);
      }
    });

    it("rejects short incident description with validation guidance", async () => {
      const { processIncomingMessage } = await import("../services/handler.service.js");
      const { sessionManager } = await import("../services/session.service.js");

      sessionManager.setSessionState(
        phone,
        "INCIDENT_ENTER_DETAILS",
        {
          siteId: "site-201",
          siteName: "Sandton City Mall",
          categoryLabel: "Safety Risk",
          incidentType: "SITE_EMERGENCY",
          severity: "CRITICAL",
        },
        "emp-101",
        "co-101"
      );

      const result = await processIncomingMessage(phone, "bad");
      expect("reply" in result).toBe(true);
      if ("reply" in result) {
        expect(result.reply).toMatch(/at least 5 characters/i);
      }
    });
  });

  describe("3. Leave Application Multi-Step Micro-Prompts", () => {
    it("guides user through complete leave application flow with validation", async () => {
      const { processIncomingMessage } = await import("../services/handler.service.js");
      const { sessionManager } = await import("../services/session.service.js");

      // Step 0: Trigger leave flow via '6' or 'leave'
      const step1 = await processIncomingMessage(phone, "6");
      expect("reply" in step1).toBe(true);
      if ("reply" in step1) {
        expect(step1.reply).toMatch(/Apply for Leave.*Step 1\/4/i);
        expect(step1.reply).toMatch(/Annual Leave/i);
      }
      expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_SELECT_TYPE");

      // Step 1: Select Annual Leave (1)
      const step2 = await processIncomingMessage(phone, "1");
      expect("reply" in step2).toBe(true);
      if ("reply" in step2) {
        expect(step2.reply).toMatch(/Leave Start Date.*Step 2\/4/i);
      }
      expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_ENTER_START_DATE");

      // Step 2: Validate invalid start date format
      const invalidDate = await processIncomingMessage(phone, "next monday");
      expect("reply" in invalidDate).toBe(true);
      if ("reply" in invalidDate) {
        expect(invalidDate.reply).toMatch(/Invalid date format[\s\S]*YYYY-MM-DD/i);
      }

      // Valid start date
      const step3 = await processIncomingMessage(phone, "2026-10-01");
      expect("reply" in step3).toBe(true);
      if ("reply" in step3) {
        expect(step3.reply).toMatch(/Leave End Date.*Step 3\/4/i);
      }
      expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_ENTER_END_DATE");

      // Step 3: Validate end date before start date
      const beforeStart = await processIncomingMessage(phone, "2026-09-25");
      expect("reply" in beforeStart).toBe(true);
      if ("reply" in beforeStart) {
        expect(beforeStart.reply).toMatch(/End date cannot be before start date/i);
      }

      // Valid end date
      const step4 = await processIncomingMessage(phone, "2026-10-03");
      expect("reply" in step4).toBe(true);
      if ("reply" in step4) {
        expect(step4.reply).toMatch(/Reason for Leave.*Step 4\/4/i);
      }
      expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_ENTER_REASON");

      // Step 4: Enter reason
      const step5 = await processIncomingMessage(phone, "Family vacation in Drakensberg");
      expect("reply" in step5).toBe(true);
      if ("reply" in step5) {
        expect(step5.reply).toMatch(/Please Confirm Your Leave Application/i);
        expect(step5.reply).toMatch(/3 day/i);
      }
      expect(sessionManager.getSession(phone)?.state).toBe("LEAVE_CONFIRM");

      // Step 5: Confirm application
      const confirm = await processIncomingMessage(phone, "1");
      expect("reply" in confirm).toBe(true);
      if ("reply" in confirm) {
        expect(confirm.reply).toMatch(/Leave Application Submitted/i);
        expect(confirm.reply).toMatch(/leave-req-401/);
      }

      expect(createLeaveRequestMock).toHaveBeenCalledWith(
        "co-101",
        "emp-101",
        expect.objectContaining({
          leaveType: "ANNUAL",
          unitsRequested: 3,
        })
      );
      expect(sessionManager.getSession(phone)?.state).toBe("IDLE");
    });
  });

  describe("4. Operational Status Inquiry Flow", () => {
    it("reports shift, duty, and leave status when user replies '7' or 'status'", async () => {
      findFirstAttendance.mockResolvedValueOnce({
        id: "att-active",
        clockIn: new Date(Date.now() - 3 * 3600 * 1000), // 3 hours ago
        shift: { site: { name: "Johannesburg Post 1" } },
      });
      countLeaveRequests.mockResolvedValueOnce(2);

      const { processIncomingMessage } = await import("../services/handler.service.js");
      const result = await processIncomingMessage(phone, "7");

      expect("reply" in result).toBe(true);
      if ("reply" in result) {
        expect(result.reply).toMatch(/Your Operational Status/i);
        expect(result.reply).toMatch(/Active Duty/i);
        expect(result.reply).toMatch(/Johannesburg Post 1/i);
        expect(result.reply).toMatch(/2 pending application/i);
      }
    });
  });

  describe("5. Fallback & Supervisor Human Handoff", () => {
    it("gives quick tips on first unrecognized message", async () => {
      const { processIncomingMessage } = await import("../services/handler.service.js");
      const result = await processIncomingMessage(phone, "unrecognized_command_xyz");

      expect("reply" in result).toBe(true);
      if ("reply" in result) {
        expect(result.reply).toMatch(/Unknown command/i);
        expect(result.reply).toMatch(/Quick numbers/i);
        expect(result.reply).toMatch(/1.*Clock In/i);
      }
    });

    it("offers supervisor escalation on second consecutive unrecognized message", async () => {
      const { processIncomingMessage } = await import("../services/handler.service.js");

      // First unrecognized message
      await processIncomingMessage(phone, "gibberish_1");

      // Second unrecognized message
      const secondResult = await processIncomingMessage(phone, "gibberish_2");

      expect("reply" in secondResult).toBe(true);
      if ("reply" in secondResult) {
        expect(secondResult.reply).toMatch(/trouble understanding your request/i);
        expect(secondResult.reply).toMatch(/alert a supervisor/i);
      }
    });

    it("immediately triggers supervisor handoff on explicit keyword 'supervisor' or 'agent'", async () => {
      const { processIncomingMessage } = await import("../services/handler.service.js");
      const result = await processIncomingMessage(phone, "supervisor");

      expect("reply" in result).toBe(true);
      if ("reply" in result) {
        expect(result.reply).toMatch(/Supervisor Assistance Requested/i);
        expect(result.reply).toMatch(/Tracking Ref:.*SUP-/);
      }

      expect(upsertAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceModule: "WHATSAPP",
          priority: "CRITICAL",
          title: expect.stringContaining("WhatsApp Assistance Request"),
        })
      );
    });
  });

  describe("6. Quick Numbered Menus & Backward Compatibility", () => {
    it("handles numbered menu '1' or 'in' to trigger clock in", async () => {
      const now = new Date();
      findManyShifts.mockResolvedValueOnce([
        {
          id: "shift-today-1",
          employeeId: "emp-101",
          companyId: "co-101",
          startTime: new Date(now.getTime() - 5 * 60 * 1000),
          endTime: new Date(now.getTime() + 8 * 3600 * 1000),
          status: "assigned",
          site: { id: "site-201", name: "Sandton City Mall", geofenceLatitude: null, geofenceLongitude: null },
        },
      ]);

      const { processIncomingMessage } = await import("../services/handler.service.js");
      const result = await processIncomingMessage(phone, "1");

      expect("reply" in result).toBe(true);
      if ("reply" in result) {
        expect(result.reply).toMatch(/Clocked in for Sandton City Mall/i);
      }
      expect(createAttendance).toHaveBeenCalled();
    });

    it("handles numbered menu '2' or 'out' to trigger clock out", async () => {
      const mockActiveAttendance = {
        id: "att-clocked-in",
        clockIn: new Date(Date.now() - 4 * 3600 * 1000),
        shiftId: "shift-101",
        shift: { employeeId: "emp-101", companyId: "co-101", siteId: "site-201", site: null },
      };
      findFirstAttendance.mockResolvedValueOnce(mockActiveAttendance).mockResolvedValueOnce(mockActiveAttendance);

      const { processIncomingMessage } = await import("../services/handler.service.js");
      const result = await processIncomingMessage(phone, "2");

      expect("reply" in result).toBe(true);
      if ("reply" in result) {
        expect(result.reply).toMatch(/Clocked out/i);
      }
    });

    it("preserves single-line leave commands (e.g. 'leave YYYY-MM-DD ...')", async () => {
      const { processIncomingMessage } = await import("../services/handler.service.js");
      const result = await processIncomingMessage(phone, "leave 2026-11-01 2026-11-03 annual Summer vacation");

      expect("reply" in result).toBe(true);
      if ("reply" in result) {
        expect(result.reply).toMatch(/Leave leave-req-401 submitted/i);
      }
    });
  });

  describe("7. Media & Attachment Handling", () => {
    it("attaches incident photo when caption contains 'incident <NUMBER>'", async () => {
      const { processLeaveDocumentAndSend } = await import("../services/handler.service.js");

      // Mock Meta media fetch
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/media-123")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ url: "https://lookaside.fbsbx.com/media/download", mime_type: "image/jpeg", file_size: 1024 }),
          });
        }
        if (url.includes("lookaside.fbsbx.com")) {
          // Valid JPEG buffer with magic bytes FF D8 FF
          const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
          return Promise.resolve({
            ok: true,
            headers: new Headers({ "content-type": "image/jpeg" }),
            body: {
              getReader: () => {
                let sent = false;
                return {
                  read: () => {
                    if (sent) return Promise.resolve({ done: true, value: undefined });
                    sent = true;
                    return Promise.resolve({ done: false, value: jpegHeader });
                  },
                  cancel: () => Promise.resolve(),
                };
              },
            },
          });
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });
      globalThis.fetch = mockFetch;

      await processLeaveDocumentAndSend(
        phone,
        "media-123",
        "image/jpeg",
        "gate-damage.jpg",
        "incident INC-20260924-0001"
      );

      expect(createIncidentAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            incidentId: "inc-301",
            mimeType: "image/jpeg",
          }),
        })
      );
      expect(sendText).toHaveBeenCalledWith(
        phone,
        expect.stringMatching(/Photo\/Evidence successfully attached/i)
      );
    });

    it("gives guidance when file is sent without recognized caption", async () => {
      const { processLeaveDocumentAndSend } = await import("../services/handler.service.js");

      await processLeaveDocumentAndSend(
        phone,
        "media-456",
        "image/jpeg",
        "photo.jpg",
        undefined
      );

      expect(sendText).toHaveBeenCalledWith(
        phone,
        expect.stringMatching(/To attach evidence, please caption/i)
      );
    });
  });
});
