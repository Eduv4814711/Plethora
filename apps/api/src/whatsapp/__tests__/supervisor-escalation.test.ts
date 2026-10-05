import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  resolveSupervisorPhone,
  dispatchSupervisorEscalation,
} from "../services/supervisor-escalation.service.js";
import { prisma } from "../../lib/prisma.js";
import { sendText } from "../services/send.service.js";
import { createAuditLog } from "../../lib/audit.js";
import { operationalEventBus } from "../../lib/events.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    site: {
      findUnique: vi.fn(),
    },
    employee: {
      findFirst: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    whatsAppMessage: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("../services/send.service.js", () => ({
  sendText: vi.fn().mockResolvedValue({ messages: [{ id: "wam-1" }] }),
}));

vi.mock("../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

describe("Supervisor Escalation Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveSupervisorPhone", () => {
    it("resolves site supervisor employee phone first when site has assigned supervisor", async () => {
      vi.mocked(prisma.site.findUnique).mockResolvedValueOnce({
        supervisorId: "usr-sup-1",
        supervisor: {
          id: "usr-sup-1",
          name: "Sipho Khumalo",
          email: "sipho@security.co.za",
        },
      } as any);

      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
        id: "emp-sup-1",
        firstName: "Sipho",
        lastName: "Khumalo",
        phone: "082 555 1234",
      } as any);

      const result = await resolveSupervisorPhone("co-1", "site-1");

      expect(result.phone).toBe("27825551234");
      expect(result.supervisorName).toBe("Sipho Khumalo");
      expect(result.supervisorUserId).toBe("usr-sup-1");
    });

    it("falls back to company settings designatedSupervisorPhone if site has no supervisor", async () => {
      vi.mocked(prisma.site.findUnique).mockResolvedValueOnce({
        supervisorId: null,
        supervisor: null,
      } as any);

      vi.mocked(prisma.company.findUnique).mockResolvedValueOnce({
        phone: "011 234 5678",
        settings: {
          designatedSupervisorPhone: "083 999 8888",
        },
        ownerUserId: null,
      } as any);

      const result = await resolveSupervisorPhone("co-1", "site-1");

      expect(result.phone).toBe("27839998888");
      expect(result.supervisorName).toBe("Designated Operations Controller");
    });

    it("falls back to emergencyPhone if designatedSupervisorPhone is absent", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValueOnce({
        phone: null,
        settings: {
          emergencyPhone: "+27 84 111 2233",
        },
        ownerUserId: null,
      } as any);

      const result = await resolveSupervisorPhone("co-1", null);

      expect(result.phone).toBe("27841112233");
      expect(result.supervisorName).toBe("Designated Operations Controller");
    });

    it("falls back to company owner employee phone when settings have no supervisor phone", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValueOnce({
        phone: null,
        settings: {},
        ownerUserId: "owner-usr-1",
      } as any);

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: "owner-usr-1",
        name: "David Nkosi",
        email: "david@plethora.co.za",
      } as any);

      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
        phone: "072 333 4444",
        firstName: "David",
        lastName: "Nkosi",
      } as any);

      const result = await resolveSupervisorPhone("co-1", null);

      expect(result.phone).toBe("27723334444");
      expect(result.supervisorName).toBe("David Nkosi");
      expect(result.supervisorUserId).toBe("owner-usr-1");
    });

    it("returns null phone when no supervisor or company phone can be resolved", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValueOnce({
        phone: null,
        settings: {},
        ownerUserId: null,
      } as any);

      const result = await resolveSupervisorPhone("co-1", null);

      expect(result.phone).toBeNull();
      expect(result.supervisorName).toBeNull();
    });
  });

  describe("dispatchSupervisorEscalation", () => {
    it("dispatches WhatsApp message, creates message record and audit log, and emits to operationalEventBus", async () => {
      const busSpy = vi.spyOn(operationalEventBus, "broadcast");

      vi.mocked(prisma.site.findUnique).mockResolvedValueOnce({
        name: "Sandton City Main Gate",
      } as any);

      vi.mocked(prisma.company.findUnique).mockResolvedValueOnce({
        phone: null,
        settings: {
          designatedSupervisorPhone: "082 111 2222",
        },
        ownerUserId: null,
      } as any);

      vi.mocked(prisma.employee.findFirst).mockResolvedValueOnce({
        id: "emp-sup-1",
        phone: "082 111 2222",
      } as any);

      const escalationResult = await dispatchSupervisorEscalation({
        companyId: "co-1",
        siteId: "site-10",
        guardName: "John Dube",
        guardPhone: "27821234567",
        reason: "Perimeter breach detected at zone 4",
        refCode: "SUP-TEST-001",
        severity: "CRITICAL",
      });

      expect(escalationResult.dispatched).toBe(true);
      expect(escalationResult.recipient).toBe("27821112222");
      expect(escalationResult.refCode).toBe("SUP-TEST-001");

      // Verify WhatsApp send
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(sendText).toHaveBeenCalledWith(
        "27821112222",
        expect.stringContaining("PLETHORA — SUPERVISOR ESCALATION")
      );
      expect(sendText).toHaveBeenCalledWith(
        "27821112222",
        expect.stringContaining("Perimeter breach detected at zone 4")
      );
      expect(sendText).toHaveBeenCalledWith(
        "27821112222",
        expect.stringContaining("Sandton City Main Gate")
      );

      // Verify DB message record
      expect(prisma.whatsAppMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: "co-1",
          direction: "outbound",
          type: "text",
        }),
      });

      // Verify Audit Log
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "co-1",
          action: "whatsapp.supervisor_escalation_dispatched",
        })
      );

      // Verify Event Bus broadcast
      expect(busSpy).toHaveBeenCalledWith(
        "SUPERVISOR_ESCALATION",
        "co-1",
        expect.objectContaining({
          refCode: "SUP-TEST-001",
          guardName: "John Dube",
          siteName: "Sandton City Main Gate",
          reason: "Perimeter breach detected at zone 4",
        })
      );

      busSpy.mockRestore();
    });

    it("emits event bus alert even if no supervisor phone is configured so control room is notified", async () => {
      const busSpy = vi.spyOn(operationalEventBus, "broadcast");

      vi.mocked(prisma.company.findUnique).mockResolvedValueOnce({
        phone: null,
        settings: {},
        ownerUserId: null,
      } as any);

      const escalationResult = await dispatchSupervisorEscalation({
        companyId: "co-1",
        guardName: "John Dube",
        guardPhone: "27821234567",
        reason: "Panic button triggered",
      });

      expect(escalationResult.dispatched).toBe(false);
      expect(escalationResult.reason).toContain("No supervisor phone configured");
      expect(sendText).not.toHaveBeenCalled();

      // Operational event bus must still have received the broadcast
      expect(busSpy).toHaveBeenCalledWith(
        "SUPERVISOR_ESCALATION",
        "co-1",
        expect.objectContaining({
          guardName: "John Dube",
          reason: "Panic button triggered",
        })
      );

      busSpy.mockRestore();
    });
  });
});
