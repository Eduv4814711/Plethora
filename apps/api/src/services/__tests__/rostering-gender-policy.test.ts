import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    employee: { findFirst: vi.fn() },
    post: { findFirst: vi.fn() },
    shift: { findFirst: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma.js";
import { validateShiftAssignment, RosteringValidationError } from "../rostering.service.js";

describe("validateShiftAssignment — site gender policy", () => {
  const startTime = new Date("2026-06-01T06:00:00.000Z");
  const endTime = new Date("2026-06-01T18:00:00.000Z");

  beforeEach(() => {
    vi.mocked(prisma.employee.findFirst).mockReset();
    vi.mocked(prisma.post.findFirst).mockReset();
    vi.mocked(prisma.shift.findFirst).mockReset();
  });

  it("throws RosteringValidationError when assignee gender violates site day policy", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      id: "e1",
      companyId: "c1",
      status: "active",
      gender: "M",
    } as Awaited<ReturnType<typeof prisma.employee.findFirst>>);

    vi.mocked(prisma.post.findFirst).mockResolvedValue({
      id: "p1",
      siteId: "s1",
      shiftType: "day",
      site: {
        companyId: "c1",
        rosterShiftGenderPolicy: { day: "female" },
      },
    } as Awaited<ReturnType<typeof prisma.post.findFirst>>);

    vi.mocked(prisma.shift.findFirst).mockResolvedValue(null);

    await expect(
      validateShiftAssignment({
        companyId: "c1",
        employeeId: "e1",
        postId: "p1",
        startTime,
        endTime,
      })
    ).rejects.toThrow(RosteringValidationError);
  });

  it("allows assignee when gender matches policy", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      id: "e1",
      companyId: "c1",
      status: "active",
      gender: "F",
    } as Awaited<ReturnType<typeof prisma.employee.findFirst>>);

    vi.mocked(prisma.post.findFirst).mockResolvedValue({
      id: "p1",
      siteId: "s1",
      shiftType: "day",
      site: {
        companyId: "c1",
        rosterShiftGenderPolicy: { day: "female" },
      },
    } as Awaited<ReturnType<typeof prisma.post.findFirst>>);

    vi.mocked(prisma.shift.findFirst).mockResolvedValue(null);

    await expect(
      validateShiftAssignment({
        companyId: "c1",
        employeeId: "e1",
        postId: "p1",
        startTime,
        endTime,
      })
    ).resolves.toBeUndefined();
  });
});
