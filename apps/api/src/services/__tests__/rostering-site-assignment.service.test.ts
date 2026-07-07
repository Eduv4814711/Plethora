import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
    employee: { findFirst: vi.fn() },
    sitePost: { findFirst: vi.fn() },
    siteAssignment: { findFirst: vi.fn() },
    shift: { findFirst: vi.fn(), findMany: vi.fn() },
    leaveRecord: { findFirst: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma.js";
import {
  validateShiftAssignment,
  RosteringValidationError,
} from "../rostering.service.js";

const companyId = "co-1";
const employeeId = "emp-1";
const postId = "post-1";
const siteId = "site-1";
const startTime = new Date("2026-05-10T04:00:00.000Z");
const endTime = new Date("2026-05-10T16:00:00.000Z");

describe("validateShiftAssignment site assignment", () => {
  beforeEach(() => {
    vi.mocked(prisma.company.findUnique).mockReset();
    vi.mocked(prisma.employee.findFirst).mockReset();
    vi.mocked(prisma.sitePost.findFirst).mockReset();
    vi.mocked(prisma.siteAssignment.findFirst).mockReset();
    vi.mocked(prisma.shift.findFirst).mockReset();
    vi.mocked(prisma.shift.findMany).mockReset();
    vi.mocked(prisma.leaveRecord.findFirst).mockReset();

    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      settings: { timezone: "Africa/Johannesburg" },
    } as never);

    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      id: employeeId,
      companyId,
      status: "active",
      gender: "M",
    } as never);

    vi.mocked(prisma.sitePost.findFirst).mockResolvedValue({
      id: postId,
      siteId,
      coverageRequirements: [{ shiftTypeCode: "day", isEnabled: true }],
      site: {
        id: siteId,
        companyId,
        rosterDayShiftGender: null,
        rosterNightShiftGender: null,
      },
    } as never);

    vi.mocked(prisma.shift.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([]);
    vi.mocked(prisma.leaveRecord.findFirst).mockResolvedValue(null);
  });

  it("requires SiteAssignment by default", async () => {
    vi.mocked(prisma.siteAssignment.findFirst).mockResolvedValue(null);

    await expect(
      validateShiftAssignment({
        companyId,
        employeeId,
        postId,
        startTime,
        endTime,
      })
    ).rejects.toThrow(RosteringValidationError);

    await expect(
      validateShiftAssignment({
        companyId,
        employeeId,
        postId,
        startTime,
        endTime,
      })
    ).rejects.toThrow(/not assigned to this site/i);
  });

  it("passes when an active SiteAssignment exists", async () => {
    vi.mocked(prisma.siteAssignment.findFirst).mockResolvedValue({
      id: "sa-1",
      siteId,
      employeeId,
    } as never);

    await expect(
      validateShiftAssignment({
        companyId,
        employeeId,
        postId,
        startTime,
        endTime,
        allowRosterable: true,
      })
    ).resolves.toBeUndefined();

    // Only active site assignments make a guard rosterable for the site.
    const where = vi.mocked(prisma.siteAssignment.findFirst).mock.calls[0][0] as {
      where: { isActive?: boolean };
    };
    expect(where.where.isActive).toBe(true);
  });

  it("skips SiteAssignment check when allowUnassigned is true", async () => {
    vi.mocked(prisma.siteAssignment.findFirst).mockResolvedValue(null);

    await expect(
      validateShiftAssignment({
        companyId,
        employeeId,
        postId,
        startTime,
        endTime,
        allowUnassigned: true,
      })
    ).resolves.toBeUndefined();

    expect(prisma.siteAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("rejects shift assignment when employee is on approved leave", async () => {
    vi.mocked(prisma.siteAssignment.findFirst).mockResolvedValue({
      id: "sa-1",
      siteId,
      employeeId,
    } as never);
    vi.mocked(prisma.leaveRecord.findFirst).mockResolvedValue({ id: "lr-1" } as never);

    await expect(
      validateShiftAssignment({
        companyId,
        employeeId,
        postId,
        startTime,
        endTime,
        allowRosterable: true,
      })
    ).rejects.toThrow(/on approved leave/i);
  });
});
