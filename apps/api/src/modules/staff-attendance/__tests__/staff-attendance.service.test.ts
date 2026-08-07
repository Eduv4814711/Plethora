import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    employee: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
    staffAttendanceDay: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/timezone.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/timezone.js")>();
  return { ...actual, getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg") };
});

import { prisma } from "../../../lib/prisma.js";
import {
  bulkSetStaffAttendanceDay,
  getStaffAttendanceDay,
  setStaffAttendanceDay,
} from "../staff-attendance.service.js";

const actor = { userId: "u-1" };
const DATE = "2026-08-03";

beforeEach(() => {
  vi.mocked(prisma.employee.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(prisma.leaveRequest.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(prisma.staffAttendanceDay.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(prisma.staffAttendanceDay.upsert)
    .mockReset()
    .mockResolvedValue({ id: "sad-1" } as never);
  vi.mocked(prisma.$transaction).mockReset().mockResolvedValue([] as never);
});

describe("setStaffAttendanceDay", () => {
  it("upserts a present day with derived hours in company time", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "e-1", employeeType: "general" },
    ] as never);

    const result = await setStaffAttendanceDay(
      "co-1",
      DATE,
      { employeeId: "e-1", status: "present", timeIn: "08:00", timeOut: "17:00" },
      actor
    );

    expect(result).toMatchObject({ record: { id: "sad-1" } });
    const call = vi.mocked(prisma.staffAttendanceDay.upsert).mock.calls[0][0];
    expect(call.create).toMatchObject({ status: "present", hoursWorked: 9 });
    // SAST is UTC+2, so 08:00 local is 06:00Z wherever the server runs.
    expect((call.create.timeIn as Date).toISOString()).toBe("2026-08-03T06:00:00.000Z");
  });

  it("is idempotent — the same day upserts on the composite key", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "e-1", employeeType: "general" },
    ] as never);

    await setStaffAttendanceDay("co-1", DATE, { employeeId: "e-1", status: "present" }, actor);
    await setStaffAttendanceDay("co-1", DATE, { employeeId: "e-1", status: "absent" }, actor);

    const [first, second] = vi.mocked(prisma.staffAttendanceDay.upsert).mock.calls;
    expect(first[0].where).toEqual(second[0].where);
    expect(second[0].update).toMatchObject({ status: "absent" });
  });

  it("rejects security officers — they belong on the site timesheet", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "e-1", employeeType: "security_officer" },
    ] as never);

    const result = await setStaffAttendanceDay(
      "co-1",
      DATE,
      { employeeId: "e-1", status: "present" },
      actor
    );

    expect(result).toMatchObject({ code: "NOT_OFFICE_STAFF" });
    expect(prisma.staffAttendanceDay.upsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown employee", async () => {
    const result = await setStaffAttendanceDay(
      "co-1",
      DATE,
      { employeeId: "nope", status: "present" },
      actor
    );
    expect(result).toMatchObject({ code: "EMPLOYEE_NOT_FOUND" });
  });

  it("refuses to mark someone present during approved leave", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "e-1", employeeType: "general" },
    ] as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([{ employeeId: "e-1" }] as never);

    const result = await setStaffAttendanceDay(
      "co-1",
      DATE,
      { employeeId: "e-1", status: "present" },
      actor
    );

    expect(result).toMatchObject({ code: "ON_APPROVED_LEAVE" });
  });

  it("still allows recording the leave itself during approved leave", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "e-1", employeeType: "general" },
    ] as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([{ employeeId: "e-1" }] as never);

    const result = await setStaffAttendanceDay(
      "co-1",
      DATE,
      { employeeId: "e-1", status: "leave" },
      actor
    );

    expect(result).toMatchObject({ record: { id: "sad-1" } });
  });

  it("rejects an end time that is not after the start", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "e-1", employeeType: "general" },
    ] as never);

    const result = await setStaffAttendanceDay(
      "co-1",
      DATE,
      { employeeId: "e-1", status: "present", timeIn: "17:00", timeOut: "08:00" },
      actor
    );

    expect(result).toMatchObject({ code: "INVALID_TIMES" });
  });
});

describe("bulkSetStaffAttendanceDay", () => {
  it("saves the valid entries and reports the rest", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "e-1", employeeType: "general" },
      { id: "e-2", employeeType: "security_officer" },
      { id: "e-3", employeeType: "general" },
    ] as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([{ employeeId: "e-3" }] as never);

    const result = await bulkSetStaffAttendanceDay(
      "co-1",
      DATE,
      [
        { employeeId: "e-1", status: "present" },
        { employeeId: "e-2", status: "present" },
        { employeeId: "e-3", status: "present" },
      ],
      actor
    );

    expect(result.ok).toEqual(["e-1"]);
    expect(result.failed).toEqual([
      { employeeId: "e-2", code: "NOT_OFFICE_STAFF", message: expect.any(String) },
      { employeeId: "e-3", code: "ON_APPROVED_LEAVE", message: expect.any(String) },
    ]);
  });

  it("does not open a transaction when nothing is valid", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "e-1", employeeType: "security_officer" },
    ] as never);

    await bulkSetStaffAttendanceDay("co-1", DATE, [{ employeeId: "e-1", status: "present" }], actor);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("writes a duplicated employee only once", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "e-1", employeeType: "general" },
    ] as never);

    const result = await bulkSetStaffAttendanceDay(
      "co-1",
      DATE,
      [
        { employeeId: "e-1", status: "absent" },
        { employeeId: "e-1", status: "present" },
      ],
      actor
    );

    expect(result.ok).toEqual(["e-1"]);
  });
});

describe("getStaffAttendanceDay", () => {
  it("lists office staff only, with capture state and leave flags", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "e-1", firstName: "Ayanda", lastName: "Bell", employeeNumber: "E-1", jobRole: "HR", ordinaryHours: null },
      { id: "e-2", firstName: "Sipho", lastName: "Cele", employeeNumber: "E-2", jobRole: "Admin", ordinaryHours: null },
    ] as never);
    vi.mocked(prisma.staffAttendanceDay.findMany).mockResolvedValue([
      { employeeId: "e-1", status: "present", timeIn: null, timeOut: null, hoursWorked: null, notes: null },
    ] as never);
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      { employeeId: "e-2", leaveType: "ANNUAL" },
    ] as never);

    const result = await getStaffAttendanceDay("co-1", { date: DATE });

    expect(result.totalGeneralEmployees).toBe(2);
    expect(result.counts).toMatchObject({ present: 1, absent: 0, onLeave: 1, notCaptured: 1 });
    expect(result.rows[1]).toMatchObject({
      employeeId: "e-2",
      status: null,
      onApprovedLeave: true,
      approvedLeaveType: "ANNUAL",
    });

    // The query must be scoped to office staff; guards have their own surface.
    expect(vi.mocked(prisma.employee.findMany).mock.calls[0][0]?.where).toMatchObject({
      employeeType: "general",
    });
  });

  it("filters by name or employee number", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "e-1", firstName: "Ayanda", lastName: "Bell", employeeNumber: "E-1", jobRole: null, ordinaryHours: null },
      { id: "e-2", firstName: "Sipho", lastName: "Cele", employeeNumber: "E-2", jobRole: null, ordinaryHours: null },
    ] as never);

    const result = await getStaffAttendanceDay("co-1", { date: DATE, q: "cele" });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].employeeId).toBe("e-2");
    // The unfiltered headcount still drives whether the office tab appears at all.
    expect(result.totalGeneralEmployees).toBe(2);
  });
});
