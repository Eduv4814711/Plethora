import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
    employee: { findFirst: vi.fn() },
    post: { findFirst: vi.fn() },
    siteAssignment: { findFirst: vi.fn() },
    shift: { findFirst: vi.fn(), findMany: vi.fn() },
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
    vi.mocked(prisma.post.findFirst).mockReset();
    vi.mocked(prisma.siteAssignment.findFirst).mockReset();
    vi.mocked(prisma.shift.findFirst).mockReset();
    vi.mocked(prisma.shift.findMany).mockReset();

    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      settings: { timezone: "Africa/Johannesburg" },
    } as never);

    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      id: employeeId,
      companyId,
      status: "active",
      gender: "M",
    } as never);

    vi.mocked(prisma.post.findFirst).mockResolvedValue({
      id: postId,
      siteId,
      shiftType: "day",
      site: {
        id: siteId,
        companyId,
        rosterDayShiftGender: null,
        rosterNightShiftGender: null,
      },
    } as never);

    vi.mocked(prisma.shift.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.shift.findMany).mockResolvedValue([]);
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

  it("passes when SiteAssignment exists", async () => {
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
});
