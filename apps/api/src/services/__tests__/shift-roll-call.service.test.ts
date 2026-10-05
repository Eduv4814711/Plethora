import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  aggregateShiftRollCall,
  formatRollCallWhatsAppMessage,
  resolveDesignatedOfficePhones,
  dispatchShiftRollCall,
  type ShiftRollCallSummary,
} from "../shift-roll-call.service.js";
import { prisma } from "../../lib/prisma.js";
import { sendText } from "../../whatsapp/services/send.service.js";
import { createAuditLog } from "../../lib/audit.js";
import { operationalEventBus } from "../../lib/events.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    company: {
      findUnique: vi.fn(),
    },
    shift: {
      findMany: vi.fn(),
    },
    whatsAppMessage: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("../../whatsapp/services/send.service.js", () => ({
  sendText: vi.fn().mockResolvedValue({ messages: [{ id: "wam-rc-1" }] }),
}));

vi.mock("../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue({}),
}));

describe("Shift Attendance Roll-Call Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("aggregateShiftRollCall", () => {
    it("aggregates shift attendance across sites into verified, flagged, and absent guards", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValueOnce({
        name: "Apex Tactical Security",
        settings: { timezone: "Africa/Johannesburg" },
      } as any);

      const fixedDate = new Date("2026-10-05T08:00:00.000Z");

      vi.mocked(prisma.shift.findMany).mockResolvedValueOnce([
        // Site A - Guard 1: Verified GPS
        {
          id: "shift-1",
          siteId: "site-a",
          employeeId: "emp-1",
          startTime: new Date("2026-10-05T06:00:00.000Z"),
          site: {
            id: "site-a",
            name: "Site Alpha",
            supervisor: { id: "sup-1", name: "Sipho Khumalo" },
          },
          employee: {
            id: "emp-1",
            firstName: "Themba",
            lastName: "Ndlovu",
            phone: "0821111111",
          },
          attendances: [
            {
              id: "att-1",
              clockIn: new Date("2026-10-05T05:58:00.000Z"),
              clockOut: null,
              validationStatus: "VERIFIED",
              withinGeofence: true,
              distanceMeters: 12,
            },
          ],
        },
        // Site A - Guard 2: Flagged No GPS
        {
          id: "shift-2",
          siteId: "site-a",
          employeeId: "emp-2",
          startTime: new Date("2026-10-05T06:00:00.000Z"),
          site: {
            id: "site-a",
            name: "Site Alpha",
            supervisor: { id: "sup-1", name: "Sipho Khumalo" },
          },
          employee: {
            id: "emp-2",
            firstName: "Kagiso",
            lastName: "Mokoena",
            phone: "0822222222",
          },
          attendances: [
            {
              id: "att-2",
              clockIn: new Date("2026-10-05T06:05:00.000Z"),
              clockOut: null,
              validationStatus: "FLAGGED_NO_GEOFENCE",
              withinGeofence: false,
              distanceMeters: null,
            },
          ],
        },
        // Site B - Guard 3: Absent (No attendance)
        {
          id: "shift-3",
          siteId: "site-b",
          employeeId: "emp-3",
          startTime: new Date("2026-10-05T06:00:00.000Z"),
          site: {
            id: "site-b",
            name: "Site Bravo",
            supervisor: null,
          },
          employee: {
            id: "emp-3",
            firstName: "Bongani",
            lastName: "Zuma",
            phone: "0823333333",
          },
          attendances: [],
        },
      ] as any);

      const summary = await aggregateShiftRollCall("co-1", {
        shiftType: "day",
        date: fixedDate,
      });

      expect(summary.companyName).toBe("Apex Tactical Security");
      expect(summary.shiftType).toBe("day");
      expect(summary.totalSites).toBe(2);
      expect(summary.totalRostered).toBe(3);
      expect(summary.totalVerified).toBe(1);
      expect(summary.totalFlagged).toBe(1);
      expect(summary.totalAbsent).toBe(1);
      // 1 verified out of 3 = 33%
      expect(summary.coveragePercentage).toBe(33);

      // Verify Site Alpha breakdown
      const siteAlpha = summary.sites.find((s) => s.siteId === "site-a");
      expect(siteAlpha).toBeDefined();
      expect(siteAlpha?.rosteredCount).toBe(2);
      expect(siteAlpha?.verifiedCount).toBe(1);
      expect(siteAlpha?.flaggedCount).toBe(1);
      expect(siteAlpha?.absentCount).toBe(0);
      expect(siteAlpha?.coveragePercentage).toBe(50);
      expect(siteAlpha?.supervisorName).toBe("Sipho Khumalo");

      // Verify Site Bravo breakdown
      const siteBravo = summary.sites.find((s) => s.siteId === "site-b");
      expect(siteBravo).toBeDefined();
      expect(siteBravo?.rosteredCount).toBe(1);
      expect(siteBravo?.verifiedCount).toBe(0);
      expect(siteBravo?.absentCount).toBe(1);
      expect(siteBravo?.coveragePercentage).toBe(0);
      expect(siteBravo?.guards[0].status).toBe("ABSENT");
    });

    it("handles zero scheduled shifts with 100% baseline coverage", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValueOnce({
        name: "Empty Security Co",
        settings: {},
      } as any);

      vi.mocked(prisma.shift.findMany).mockResolvedValueOnce([]);

      const summary = await aggregateShiftRollCall("co-empty", { shiftType: "night" });
      expect(summary.totalSites).toBe(0);
      expect(summary.totalRostered).toBe(0);
      expect(summary.totalVerified).toBe(0);
      expect(summary.coveragePercentage).toBe(100);
      expect(summary.sites).toHaveLength(0);
    });
  });

  describe("formatRollCallWhatsAppMessage", () => {
    it("formats a readable parade-state WhatsApp message with emojis and site details", () => {
      const mockSummary: ShiftRollCallSummary = {
        companyId: "co-1",
        companyName: "Apex Tactical Security",
        shiftType: "day",
        shiftLabel: "Day Shift (06:00 – 18:00)",
        dateStr: "2026-10-05",
        generatedAt: "2026-10-05 08:30:00",
        totalSites: 1,
        totalRostered: 2,
        totalVerified: 1,
        totalFlagged: 0,
        totalAbsent: 1,
        coveragePercentage: 50,
        sites: [
          {
            siteId: "site-a",
            siteName: "Site Alpha",
            supervisorName: "Sipho Khumalo",
            rosteredCount: 2,
            verifiedCount: 1,
            flaggedCount: 0,
            absentCount: 1,
            coveragePercentage: 50,
            guards: [
              {
                employeeId: "emp-1",
                name: "Themba Ndlovu",
                phone: "0821111111",
                shiftId: "shift-1",
                status: "VERIFIED",
                clockInTime: "05:58",
                clockOutTime: null,
                distanceMeters: 12,
              },
              {
                employeeId: "emp-2",
                name: "Bongani Zuma",
                phone: "0823333333",
                shiftId: "shift-2",
                status: "ABSENT",
                clockInTime: null,
                clockOutTime: null,
                distanceMeters: null,
              },
            ],
          },
        ],
      };

      const formatted = formatRollCallWhatsAppMessage(mockSummary);

      expect(formatted).toContain("PLETHORA — SHIFT ROLL-CALL SUMMARY");
      expect(formatted).toContain("Apex Tactical Security");
      expect(formatted).toContain("Overall Post Coverage: *50%*");
      expect(formatted).toContain("Verified on Duty: *1* guards ✅");
      expect(formatted).toContain("Absent / Unaccounted: *1* guards ❌");
      expect(formatted).toContain("*Site Alpha* (1/2)");
      expect(formatted).toContain("Supervisor: Sipho Khumalo");
      expect(formatted).toContain("Themba Ndlovu (Verified 05:58)");
      expect(formatted).toContain("❌ *ABSENT*: Bongani Zuma (No clock-in)");
    });
  });

  describe("resolveDesignatedOfficePhones", () => {
    it("resolves array of designatedOfficePhones and normalizes to South African E.164", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValueOnce({
        phone: "011 000 0000",
        settings: {
          designatedOfficePhones: ["082 111 2222", "+27 83 444 5555"],
        },
      } as any);

      const phones = await resolveDesignatedOfficePhones("co-1");
      expect(phones).toEqual(["27821112222", "27834445555"]);
    });

    it("resolves comma-separated string of rollCallPhones", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValueOnce({
        phone: null,
        settings: {
          rollCallPhones: "071 123 4567, 082 987 6543",
        },
      } as any);

      const phones = await resolveDesignatedOfficePhones("co-1");
      expect(phones).toEqual(["27711234567", "27829876543"]);
    });

    it("falls back to company.phone when no settings phones exist", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValueOnce({
        phone: "082 999 8888",
        settings: {},
      } as any);

      const phones = await resolveDesignatedOfficePhones("co-1");
      expect(phones).toEqual(["27829998888"]);
    });
  });

  describe("dispatchShiftRollCall", () => {
    it("aggregates, formats, and dispatches roll-call to designated office numbers with event broadcast and audit log", async () => {
      const busSpy = vi.spyOn(operationalEventBus, "broadcast");

      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        name: "Apex Tactical",
        phone: "082 123 4567",
        settings: {
          designatedOfficePhones: ["082 123 4567", "083 765 4321"],
        },
      } as any);

      vi.mocked(prisma.shift.findMany).mockResolvedValue([]);

      const result = await dispatchShiftRollCall("co-1", {
        shiftType: "day",
      });

      expect(result.success).toBe(true);
      expect(result.recipientCount).toBe(2);
      expect(sendText).toHaveBeenCalledTimes(2);
      expect(sendText).toHaveBeenCalledWith("27821234567", expect.stringContaining("PLETHORA — SHIFT ROLL-CALL SUMMARY"));
      expect(sendText).toHaveBeenCalledWith("27837654321", expect.stringContaining("PLETHORA — SHIFT ROLL-CALL SUMMARY"));

      // Audit log
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "co-1",
          action: "whatsapp.roll_call_dispatched",
        })
      );

      // Event bus broadcast
      expect(busSpy).toHaveBeenCalledWith(
        "ROLL_CALL_DISPATCHED",
        "co-1",
        expect.objectContaining({
          sentCount: 2,
        })
      );

      busSpy.mockRestore();
    });

    it("honors overrideRecipients when provided from control room modal", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        name: "Apex Tactical",
        settings: {},
      } as any);

      vi.mocked(prisma.shift.findMany).mockResolvedValue([]);

      const result = await dispatchShiftRollCall("co-1", {
        shiftType: "day",
        overrideRecipients: ["084 555 1212"],
      });

      expect(result.success).toBe(true);
      expect(result.recipientCount).toBe(1);
      expect(sendText).toHaveBeenCalledWith("27845551212", expect.any(String));
    });

    it("returns success=false without error when no recipient phones are configured", async () => {
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        name: "Apex Tactical",
        phone: null,
        settings: {},
      } as any);

      vi.mocked(prisma.shift.findMany).mockResolvedValue([]);

      const result = await dispatchShiftRollCall("co-1");
      expect(result.success).toBe(false);
      expect(result.recipientCount).toBe(0);
      expect(sendText).not.toHaveBeenCalled();
    });
  });
});
