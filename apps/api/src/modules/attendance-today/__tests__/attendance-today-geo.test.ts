import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyShift = vi.fn();
const findManyException = vi.fn();
const findManyEvent = vi.fn();

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    shift: { findMany: (...args: any[]) => findManyShift(...args) },
    attendanceException: { findMany: (...args: any[]) => findManyException(...args) },
    attendanceEvent: { findMany: (...args: any[]) => findManyEvent(...args) },
  },
}));

vi.mock("../../../lib/timezone.js", () => ({
  getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg"),
  parseDateOnly: (d: string) => new Date(`${d}T00:00:00.000Z`),
  localTimeInZone: (d: Date) => d,
}));

import { getTodayAttendance } from "../attendance-today.service.js";

describe("getTodayAttendance GPS & geofence coordinates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyException.mockResolvedValue([]);
    findManyEvent.mockResolvedValue([]);
  });

  it("exposes site geofence and guard clockIn/clockOut coordinates", async () => {
    findManyShift.mockResolvedValue([
      {
        id: "shift-1",
        companyId: "comp-1",
        employeeId: "emp-1",
        siteId: "site-1",
        shiftType: "day",
        startTime: new Date("2026-11-27T04:00:00.000Z"),
        endTime: new Date("2026-11-27T16:00:00.000Z"),
        legacyPostName: "Main Gate",
        employee: {
          id: "emp-1",
          firstName: "Thabo",
          lastName: "Nkosi",
          phone: "27821234567",
          employeeNumber: "EMP001",
        },
        site: {
          id: "site-1",
          name: "Sandton Gate",
          latitude: "-26.1076000",
          longitude: "28.0567000",
          geofenceRadiusMeters: 150,
          supervisor: { id: "sup-1", name: "Sipho" },
        },
        attendances: [
          {
            id: "att-1",
            clockIn: new Date("2026-11-27T04:02:00.000Z"),
            clockOut: null,
            clockInLat: "-26.1077000",
            clockInLng: "28.0568000",
            clockOutLat: null,
            clockOutLng: null,
            hoursWorked: null,
            overtimeHours: null,
            status: "pending",
            source: "clock_in",
            whatsappMessageId: "wamid.123",
            distanceMeters: 15,
            withinGeofence: true,
            validationStatus: "VERIFIED",
          },
        ],
      },
    ]);

    const res = await getTodayAttendance("comp-1", { date: "2026-11-27" });
    expect(res.shifts).toHaveLength(1);
    const site = res.shifts[0]!.sites[0]!;
    expect(site.latitude).toBe(-26.1076);
    expect(site.longitude).toBe(28.0567);
    expect(site.geofenceRadiusMeters).toBe(150);

    const guard = site.guards[0]!;
    expect(guard.clockInLat).toBe(-26.1077);
    expect(guard.clockInLng).toBe(28.0568);
    expect(guard.distanceMeters).toBe(15);
    expect(guard.withinGeofence).toBe(true);
    expect(guard.validationStatus).toBe("VERIFIED");
  });
});
