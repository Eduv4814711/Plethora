import { beforeEach, describe, expect, it, vi } from "vitest";
import { rosteringModuleService, isRosteringServiceError } from "../rostering.service.js";

vi.mock("../rostering.repository.js", () => ({
  rosteringRepository: {
    findPostWithSite: vi.fn(),
    deleteShifts: vi.fn(),
    createShift: vi.fn(),
    findSiteWithPostsForBulk: vi.fn(),
  },
}));

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    shift: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../../lib/timezone.js", () => ({
  getCompanyTimezone: vi.fn().mockResolvedValue("Africa/Johannesburg"),
  getShiftTimes: vi.fn((date: Date) => {
    const shiftStart = new Date(date);
    shiftStart.setUTCHours(6, 0, 0, 0);
    const shiftEnd = new Date(date);
    shiftEnd.setUTCHours(18, 0, 0, 0);
    return { shiftStart, shiftEnd };
  }),
  dateKeyInTimeZone: (date: Date) => date.toISOString().slice(0, 10),
  parseDateOnly: (s: string) => new Date(`${s}T00:00:00.000Z`),
  parseDateOnlyEnd: (s: string) => new Date(`${s}T23:59:59.999Z`),
}));

vi.mock("../../../services/rostering.service.js", () => ({
  validateShiftAssignment: vi.fn().mockResolvedValue(undefined),
  RosteringValidationError: class RosteringValidationError extends Error {
    name = "RosteringValidationError";
  },
  computeDatesFromPattern: vi.fn().mockReturnValue([
    new Date("2026-06-01T00:00:00.000Z"),
    new Date("2026-06-02T00:00:00.000Z"),
  ]),
  computeDatesFromPatternDual: vi.fn(),
  meetsSiteShiftGenderRule: vi.fn(),
  buildEmployeePostAssignmentMap: vi.fn(),
  resolvePostForShiftSlot: vi.fn(),
}));

vi.mock("../../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { rosteringRepository } from "../rostering.repository.js";
import {
  RosteringValidationError,
  validateShiftAssignment,
} from "../../../services/rostering.service.js";
import { prisma } from "../../../lib/prisma.js";

describe("rosteringModuleService.bulkCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.shift.findMany).mockResolvedValue([
      { id: "old-shift-1" },
      { id: "old-shift-2" },
    ] as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        leaveRequest: { findMany: vi.fn().mockResolvedValue([]) },
        shift: {
          deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
          createMany: vi.fn().mockImplementation(({ data }) =>
            Promise.resolve({ count: data.length })
          ),
        },
      })
    );
  });

  it("bulk-creates shifts for a post after clearing overlapping assigned shifts", async () => {
    vi.mocked(rosteringRepository.findPostWithSite).mockResolvedValue({
      id: "post-1",
      siteId: "site-1",
      coverageRequirements: [{ shiftTypeCode: "day", isEnabled: true }],
      site: { companyId: "co-1" },
    } as never);

    const result = await rosteringModuleService.bulkCreate("co-1", "user-1", {
      employeeId: "emp-1",
      postId: "post-1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      pattern: "all_days",
    });

    expect(isRosteringServiceError(result)).toBe(false);
    if (isRosteringServiceError(result)) return;

    expect(result.deleted).toBe(2);
    expect(result.created).toBe(2);
    expect(prisma.shift.findMany).toHaveBeenCalledWith({
      select: { id: true },
      where: expect.objectContaining({
        companyId: "co-1",
        employeeId: "emp-1",
        siteId: "site-1",
        shiftType: "day",
        status: { in: ["created", "assigned"] },
      }),
    });
    expect(validateShiftAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeShiftIds: ["old-shift-1", "old-shift-2"],
      })
    );
    expect(validateShiftAssignment).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when post is not found for company", async () => {
    vi.mocked(rosteringRepository.findPostWithSite).mockResolvedValue(null);

    const result = await rosteringModuleService.bulkCreate("co-1", "user-1", {
      employeeId: "emp-1",
      postId: "missing-post",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      pattern: "weekdays",
    });

    expect(isRosteringServiceError(result)).toBe(true);
    if (!isRosteringServiceError(result)) return;
    expect(result.status).toBe(404);
    expect(result.body.error).toBe("Post not found");
  });

  it("requires postId or siteId", async () => {
    const result = await rosteringModuleService.bulkCreate("co-1", "user-1", {
      employeeId: "emp-1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      pattern: "all_days",
    });

    expect(isRosteringServiceError(result)).toBe(true);
    if (!isRosteringServiceError(result)) return;
    expect(result.status).toBe(400);
  });

  it("rejects endDate before startDate", async () => {
    const result = await rosteringModuleService.bulkCreate("co-1", "user-1", {
      employeeId: "emp-1",
      postId: "post-1",
      startDate: "2026-06-10",
      endDate: "2026-06-01",
      pattern: "all_days",
    });

    expect(isRosteringServiceError(result)).toBe(true);
    if (!isRosteringServiceError(result)) return;
    expect(result.status).toBe(400);
    expect(result.body.message).toMatch(/endDate/);
  });

  it("does not delete existing shifts when any replacement entry is invalid", async () => {
    vi.mocked(rosteringRepository.findPostWithSite).mockResolvedValue({
      id: "post-1",
      siteId: "site-1",
      coverageRequirements: [{ shiftTypeCode: "day", isEnabled: true }],
      site: { companyId: "co-1" },
    } as never);
    vi.mocked(validateShiftAssignment)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new RosteringValidationError("Approved leave conflict"));

    const result = await rosteringModuleService.bulkCreate("co-1", "user-1", {
      employeeId: "emp-1",
      postId: "post-1",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      pattern: "all_days",
    });

    expect(isRosteringServiceError(result)).toBe(true);
    if (!isRosteringServiceError(result)) return;
    expect(result.status).toBe(409);
    expect(result.body.message).toBe("No existing shifts were replaced.");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
