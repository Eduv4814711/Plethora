import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  company: {
    findUnique: vi.fn(),
  },
  employee: {
    findUnique: vi.fn(),
  },
  shift: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  attendance: {
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  attendanceEvent: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  attendanceException: {
    create: vi.fn(),
  },
  siteTimesheetRow: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
};

vi.mock("../../lib/prisma.js", () => ({
  prisma: mockPrisma,
}));

const mockTriggerPostClockExceptionSync = vi.fn();
vi.mock("../../modules/attendance-exceptions/post-clock-sync.js", () => ({
  triggerPostClockExceptionSync: mockTriggerPostClockExceptionSync,
}));

const mockCreateAuditLog = vi.fn();
vi.mock("../../lib/audit.js", () => ({
  createAuditLog: mockCreateAuditLog,
}));

const mockCalculateHours = vi.fn().mockReturnValue({ hoursWorked: 8, overtimeHours: 0 });
vi.mock("../../services/attendance.service.js", () => ({
  calculateHours: mockCalculateHours,
}));

describe("operationalAttendanceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.company.findUnique.mockResolvedValue({ id: "comp-1", settings: { timezone: "Africa/Johannesburg" } });
    mockPrisma.attendanceException.create.mockResolvedValue({});
    mockPrisma.attendanceEvent.create.mockResolvedValue({});
    mockPrisma.attendanceEvent.findFirst.mockResolvedValue(null);
    mockPrisma.shift.update.mockResolvedValue({});
    (mockPrisma.shift as any).updateMany = vi.fn().mockResolvedValue({ count: 1 });
    mockPrisma.attendance.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.siteTimesheetRow.findFirst.mockResolvedValue(null);
    mockPrisma.siteTimesheetRow.update.mockResolvedValue({});
    mockCreateAuditLog.mockResolvedValue({});
  });

  describe("findActiveRosterShift", () => {
    it("returns null when no shifts are found within the ±2 hour operating window", async () => {
      const { findActiveRosterShift } = await import("../services/operational-attendance.service.js");
      mockPrisma.shift.findMany.mockResolvedValueOnce([]);

      const result = await findActiveRosterShift("emp-1", new Date("2026-09-29T08:00:00Z"));
      expect(result).toBeNull();
      expect(mockPrisma.shift.findMany).toHaveBeenCalledWith({
        where: {
          employeeId: "emp-1",
          startTime: { lte: new Date("2026-09-29T10:00:00Z") },
          endTime: { gte: new Date("2026-09-29T06:00:00Z") },
        },
        include: {
          site: true,
          employee: true,
          attendances: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: { startTime: "asc" },
      });
    });

    it("returns the shift when exactly one shift is in window", async () => {
      const { findActiveRosterShift } = await import("../services/operational-attendance.service.js");
      const mockShift = {
        id: "shift-1",
        employeeId: "emp-1",
        startTime: new Date("2026-09-29T08:00:00Z"),
        endTime: new Date("2026-09-29T17:00:00Z"),
        site: { id: "site-1", name: "Site Alpha" },
      };
      mockPrisma.shift.findMany.mockResolvedValueOnce([mockShift]);

      const result = await findActiveRosterShift("emp-1", new Date("2026-09-29T08:05:00Z"));
      expect(result).toEqual(mockShift);
    });

    it("selects the closest shift when multiple overlapping shifts are returned", async () => {
      const { findActiveRosterShift } = await import("../services/operational-attendance.service.js");
      const shiftFar = {
        id: "shift-far",
        employeeId: "emp-1",
        startTime: new Date("2026-09-29T06:00:00Z"),
        endTime: new Date("2026-09-29T14:00:00Z"),
      };
      const shiftNear = {
        id: "shift-near",
        employeeId: "emp-1",
        startTime: new Date("2026-09-29T11:45:00Z"),
        endTime: new Date("2026-09-29T20:00:00Z"),
      };
      mockPrisma.shift.findMany.mockResolvedValueOnce([shiftFar, shiftNear]);

      const result = await findActiveRosterShift("emp-1", new Date("2026-09-29T12:00:00Z"));
      expect(result?.id).toBe("shift-near");
    });
  });

  describe("validateAndRecordOperationalAttendance", () => {
    const activeEmployee = {
      id: "emp-1",
      companyId: "comp-1",
      firstName: "John",
      lastName: "Doe",
      status: "ACTIVE",
    };

    const mockShift = {
      id: "shift-1",
      companyId: "comp-1",
      siteId: "site-1",
      employeeId: "emp-1",
      startTime: new Date("2026-09-29T08:00:00Z"),
      endTime: new Date("2026-09-29T17:00:00Z"),
      status: "assigned",
      site: {
        id: "site-1",
        companyId: "comp-1",
        name: "Headquarters",
        latitude: -26.195246,
        longitude: 28.034088,
        geofenceRadiusMeters: 100,
      },
    };

    it("rejects when employee is not found or not active", async () => {
      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );
      mockPrisma.employee.findUnique.mockResolvedValueOnce({
        id: "emp-inactive",
        status: "TERMINATED",
      });

      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-inactive",
        latitude: -26.195246,
        longitude: 28.034088,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("REJECTED");
      expect(result.message).toContain("not active");
    });

    it("rejects when no active roster shift is found in operating window", async () => {
      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );
      mockPrisma.employee.findUnique.mockResolvedValueOnce(activeEmployee);
      mockPrisma.shift.findMany.mockResolvedValueOnce([]);

      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-1",
        latitude: -26.195246,
        longitude: 28.034088,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("NO_SHIFT");
      expect(result.message).toContain("No rostered shift found");
    });

    it("rejects duplicate clock-in when guard is already clocked in", async () => {
      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );
      mockPrisma.employee.findUnique.mockResolvedValueOnce(activeEmployee);
      mockPrisma.shift.findMany.mockResolvedValueOnce([mockShift]);
      mockPrisma.attendance.findFirst.mockResolvedValueOnce({
        id: "att-1",
        shiftId: mockShift.id,
        clockIn: new Date("2026-09-29T08:00:00Z"),
        clockOut: null,
        validationStatus: "VERIFIED",
      });

      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-1",
        latitude: -26.195246,
        longitude: 28.034088,
        intent: "clock_in",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("DUPLICATE");
      expect(result.message).toContain("already clocked in");
    });

    it("rejects duplicate clock-in when guard already completed the shift", async () => {
      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );
      mockPrisma.employee.findUnique.mockResolvedValueOnce(activeEmployee);
      mockPrisma.shift.findMany.mockResolvedValueOnce([mockShift]);
      mockPrisma.attendance.findFirst.mockResolvedValueOnce({
        id: "att-1",
        shiftId: mockShift.id,
        clockIn: new Date("2026-09-29T08:00:00Z"),
        clockOut: new Date("2026-09-29T17:00:00Z"),
        validationStatus: "VERIFIED",
      });

      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-1",
        latitude: -26.195246,
        longitude: 28.034088,
        intent: "clock_in",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("DUPLICATE");
      expect(result.message).toContain("already completed this shift");
    });

    it("rejects clock-out when no clock-in exists", async () => {
      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );
      mockPrisma.employee.findUnique.mockResolvedValueOnce(activeEmployee);
      mockPrisma.shift.findMany.mockResolvedValueOnce([mockShift]);
      mockPrisma.attendance.findFirst.mockResolvedValueOnce(null);

      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-1",
        latitude: -26.195246,
        longitude: 28.034088,
        intent: "clock_out",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("NOT_CLOCKED_IN");
      expect(result.message).toContain("no active clock-in was recorded");
    });

    it("rejects clock-out when shift has already been clocked out", async () => {
      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );
      mockPrisma.employee.findUnique.mockResolvedValueOnce(activeEmployee);
      mockPrisma.shift.findMany.mockResolvedValueOnce([mockShift]);
      mockPrisma.attendance.findFirst.mockResolvedValueOnce({
        id: "att-1",
        shiftId: mockShift.id,
        clockIn: new Date("2026-09-29T08:00:00Z"),
        clockOut: new Date("2026-09-29T17:00:00Z"),
        validationStatus: "VERIFIED",
      });

      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-1",
        latitude: -26.195246,
        longitude: 28.034088,
        intent: "clock_out",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("DUPLICATE");
      expect(result.message).toContain("already clocked out");
    });

    it("records FLAGGED_NO_GEOFENCE when site has no coordinates, but marks attendance VERIFIED and triggers sync", async () => {
      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );
      const shiftNoCoords = {
        ...mockShift,
        site: {
          ...mockShift.site,
          latitude: null,
          longitude: null,
          geofenceRadiusMeters: null,
        },
      };

      mockPrisma.employee.findUnique.mockResolvedValueOnce(activeEmployee);
      mockPrisma.shift.findMany.mockResolvedValueOnce([shiftNoCoords]);
      mockPrisma.attendance.findFirst.mockResolvedValueOnce(null);
      mockPrisma.attendance.create.mockResolvedValueOnce({
        id: "att-flagged",
        shiftId: shiftNoCoords.id,
        validationStatus: "FLAGGED_NO_GEOFENCE",
        status: "VERIFIED",
        withinGeofence: false,
      });

      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-1",
        latitude: -26.195246,
        longitude: 28.034088,
        intent: "clock_in",
        whatsappMessageId: "wamid-123",
        whatsappNumber: "27821234567",
      });

      expect(result.success).toBe(true);
      expect(result.validationStatus).toBe("FLAGGED_NO_GEOFENCE");
      expect(result.status).toBe("VERIFIED");
      expect(result.message).toContain("no GPS geofence configured");
      expect(mockTriggerPostClockExceptionSync).toHaveBeenCalledWith("comp-1", "site-1");
      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "comp-1",
          action: "attendance.clock_in",
          metadata: expect.objectContaining({
            validationStatus: "FLAGGED_NO_GEOFENCE",
          }),
        }),
        expect.anything()
      );
    });

    it("accepts clock-in inside geofence radius, sets withinGeofence true, updates shift, syncs timesheet, and triggers post-clock sync", async () => {
      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );

      mockPrisma.employee.findUnique.mockResolvedValueOnce(activeEmployee);
      mockPrisma.shift.findMany.mockResolvedValueOnce([mockShift]);
      mockPrisma.attendance.findFirst.mockResolvedValueOnce(null);
      mockPrisma.attendance.create.mockResolvedValueOnce({
        id: "att-verified",
        shiftId: mockShift.id,
        validationStatus: "VERIFIED",
        status: "VERIFIED",
        withinGeofence: true,
        distanceMeters: 25,
        geofenceRadiusMeters: 100,
      });
      mockPrisma.siteTimesheetRow.findFirst.mockResolvedValueOnce({
        id: "row-1",
        siteId: "site-1",
        approvalStatus: "pending",
      });

      // Very small delta coordinates (roughly 25m away)
      const guardLat = -26.195246 + 0.0002;
      const guardLon = 28.034088 + 0.0001;

      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-1",
        latitude: guardLat,
        longitude: guardLon,
        intent: "clock_in",
        whatsappMessageId: "wamid-inside",
        whatsappNumber: "27821234567",
      });

      expect(result.success).toBe(true);
      expect(result.validationStatus).toBe("VERIFIED");
      expect(result.status).toBe("VERIFIED");
      expect(mockPrisma.shift.update).toHaveBeenCalledWith({
        where: { id: mockShift.id },
        data: { status: "active" },
      });
      expect(mockPrisma.siteTimesheetRow.update).toHaveBeenCalledWith({
        where: { id: "row-1" },
        data: expect.objectContaining({
          attendanceStatus: "present",
          actualGuardId: "emp-1",
        }),
      });
      expect(mockTriggerPostClockExceptionSync).toHaveBeenCalledWith("comp-1", "site-1");
      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "attendance.clock_in",
          metadata: expect.objectContaining({
            source: "whatsapp",
          }),
        }),
        expect.anything()
      );
    });

    it("rejects clock-in outside geofence radius, creates AttendanceException, and DOES NOT trigger post-clock sync", async () => {
      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );

      mockPrisma.employee.findUnique.mockResolvedValueOnce(activeEmployee);
      mockPrisma.shift.findMany.mockResolvedValueOnce([mockShift]);
      mockPrisma.attendance.findFirst.mockResolvedValueOnce(null);
      mockPrisma.attendance.create.mockResolvedValueOnce({
        id: "att-rejected",
        shiftId: mockShift.id,
        status: "REJECTED_GEOFENCE",
        validationStatus: "REJECTED_GEOFENCE",
        withinGeofence: false,
      });

      // Guard is far away (e.g. Pretoria ~50km from Johannesburg)
      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-1",
        latitude: -25.747868,
        longitude: 28.229271,
        intent: "clock_in",
        whatsappMessageId: "wamid-outside",
        whatsappNumber: "27821234567",
      });

      expect(result.success).toBe(false);
      expect(result.validationStatus).toBe("REJECTED_GEOFENCE");
      expect(result.status).toBe("REJECTED_GEOFENCE");
      expect(result.message).toContain("Clock-in failed. You are");
      expect(result.message).toContain("away. Allowed: 100m.");
      // Invariant check: MUST NOT trigger post-clock sync for rejected geofence
      expect(mockTriggerPostClockExceptionSync).not.toHaveBeenCalled();
      // Verifies AttendanceException created with severity CRITICAL
      expect(mockPrisma.attendanceException.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: "comp-1",
          shiftId: mockShift.id,
          employeeId: "emp-1",
          siteId: "site-1",
          exceptionType: "OUTSIDE_GEOFENCE",
          severity: "CRITICAL",
          status: "OPEN",
        }),
      });
      // Verifies audit log
      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "attendance.rejected_geofence",
        })
      );
    });

    it("handles boundary condition where distance equals allowedRadius exactly as VERIFIED", async () => {
      // Mock geo module to return exact boundary distance
      const geoModule = await import("../../lib/geo.js");
      const haversineSpy = vi.spyOn(geoModule, "haversineDistance").mockReturnValueOnce(100);

      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );

      mockPrisma.employee.findUnique.mockResolvedValueOnce(activeEmployee);
      mockPrisma.shift.findMany.mockResolvedValueOnce([mockShift]);
      mockPrisma.attendance.findFirst.mockResolvedValueOnce(null);
      mockPrisma.attendance.create.mockResolvedValueOnce({
        id: "att-boundary",
        shiftId: mockShift.id,
        validationStatus: "VERIFIED",
        status: "VERIFIED",
        withinGeofence: true,
        distanceMeters: 100,
        geofenceRadiusMeters: 100,
      });

      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-1",
        latitude: -26.195246,
        longitude: 28.034088,
        intent: "clock_in",
      });

      expect(result.success).toBe(true);
      expect(result.validationStatus).toBe("VERIFIED");
      expect(result.distanceMeters).toBe(100);
      expect(mockTriggerPostClockExceptionSync).toHaveBeenCalledWith("comp-1", "site-1");

      haversineSpy.mockRestore();
    });

    it("handles boundary condition where distance is allowedRadius + 1 meter as REJECTED_GEOFENCE", async () => {
      const geoModule = await import("../../lib/geo.js");
      const haversineSpy = vi.spyOn(geoModule, "haversineDistance").mockReturnValueOnce(101);

      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );

      mockPrisma.employee.findUnique.mockResolvedValueOnce(activeEmployee);
      mockPrisma.shift.findMany.mockResolvedValueOnce([mockShift]);
      mockPrisma.attendance.findFirst.mockResolvedValueOnce(null);
      mockPrisma.attendance.create.mockResolvedValueOnce({
        id: "att-boundary-fail",
        shiftId: mockShift.id,
        validationStatus: "REJECTED_GEOFENCE",
        status: "REJECTED_GEOFENCE",
        withinGeofence: false,
        distanceMeters: 101,
        geofenceRadiusMeters: 100,
      });

      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-1",
        latitude: -26.195246,
        longitude: 28.034088,
        intent: "clock_in",
      });

      expect(result.success).toBe(false);
      expect(result.validationStatus).toBe("REJECTED_GEOFENCE");
      expect(result.distanceMeters).toBe(101);
      expect(mockTriggerPostClockExceptionSync).not.toHaveBeenCalled();

      haversineSpy.mockRestore();
    });

    it("updates existing rejected attendance when officer retries inside geofence", async () => {
      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );

      mockPrisma.employee.findUnique.mockResolvedValueOnce(activeEmployee);
      mockPrisma.shift.findMany.mockResolvedValueOnce([mockShift]);
      // Existing attendance was previously REJECTED_GEOFENCE
      const existingRejectedAttendance = {
        id: "att-previously-rejected",
        shiftId: mockShift.id,
        clockIn: null,
        clockOut: null,
        status: "REJECTED_GEOFENCE",
        validationStatus: "REJECTED_GEOFENCE",
        withinGeofence: false,
      };
      mockPrisma.attendance.findFirst.mockResolvedValueOnce(existingRejectedAttendance);
      mockPrisma.attendance.update.mockResolvedValueOnce({
        ...existingRejectedAttendance,
        status: "VERIFIED",
        validationStatus: "VERIFIED",
        withinGeofence: true,
        clockIn: new Date("2026-09-29T08:00:00Z"),
      });

      // Officer has now walked onto site (exact coords)
      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-1",
        latitude: -26.195246,
        longitude: 28.034088,
        intent: "clock_in",
      });

      expect(result.success).toBe(true);
      expect(result.validationStatus).toBe("VERIFIED");
      expect(mockPrisma.attendance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: existingRejectedAttendance.id },
          data: expect.objectContaining({
            status: "clocked_in",
            validationStatus: "VERIFIED",
            withinGeofence: true,
            rejectionReason: null,
          }),
        })
      );
      expect(mockTriggerPostClockExceptionSync).toHaveBeenCalledWith("comp-1", "site-1");
    });

    it("successfully clocks out inside geofence, calculates hours, and marks shift completed", async () => {
      const { validateAndRecordOperationalAttendance } = await import(
        "../services/operational-attendance.service.js"
      );

      mockPrisma.employee.findUnique.mockResolvedValueOnce(activeEmployee);
      mockPrisma.shift.findMany.mockResolvedValueOnce([mockShift]);
      const existingAttendance = {
        id: "att-1",
        shiftId: mockShift.id,
        clockIn: new Date("2026-09-29T08:00:00Z"),
        clockOut: null,
        status: "VERIFIED",
        validationStatus: "VERIFIED",
        withinGeofence: true,
      };
      mockPrisma.attendance.findFirst.mockResolvedValueOnce(existingAttendance);
      mockPrisma.attendance.update.mockResolvedValueOnce({
        ...existingAttendance,
        clockOut: new Date("2026-09-29T16:00:00Z"),
        hoursWorked: 8,
        overtimeHours: 0,
      });

      const result = await validateAndRecordOperationalAttendance({
        employeeId: "emp-1",
        latitude: -26.195246,
        longitude: 28.034088,
        intent: "clock_out",
        timestamp: new Date("2026-09-29T16:00:00Z"),
      });

      expect(result.success).toBe(true);
      expect(result.validationStatus).toBe("VERIFIED");
      expect(result.message).toContain("Clock-out successful");
      expect(mockPrisma.shift.update).toHaveBeenCalledWith({
        where: { id: mockShift.id },
        data: { status: "completed" },
      });
      expect(mockCalculateHours).toHaveBeenCalled();
      expect(mockTriggerPostClockExceptionSync).toHaveBeenCalledWith("comp-1", "site-1");
    });
  });
});
