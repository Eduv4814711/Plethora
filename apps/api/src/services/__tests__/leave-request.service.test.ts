import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: { $transaction: vi.fn() },
}));

vi.mock("../../modules/rosters/roster-continuity.service.js", () => ({
  reconcileContinuityForEmployee: vi.fn(),
}));

vi.mock("../leave-management.service.js", () => {
  class LeaveManagementError extends Error {}
  return {
    createLeaveApplication: vi.fn(),
    decideLeaveApplication: vi.fn(),
    LeaveManagementError,
  };
});

import { prisma } from "../../lib/prisma.js";
import { reconcileContinuityForEmployee } from "../../modules/rosters/roster-continuity.service.js";
import {
  createLeaveApplication,
  decideLeaveApplication,
  LeaveManagementError,
} from "../leave-management.service.js";
import {
  approveLeaveRequest,
  LeaveRequestError,
  rejectLeaveRequest,
} from "../leave-request.service.js";

describe("legacy leave request compatibility transaction", () => {
  const request = {
    id: "request-1",
    employeeId: "employee-1",
    date: new Date("2026-11-21T00:00:00.000Z"),
    type: "maternity",
    hours: 8,
    status: "pending",
    reason: "Birth-parent leave",
    employee: { id: "employee-1", companyId: "company-1" },
  };
  const tx = {
    leaveRequest: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    leaveApplication: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tx.leaveRequest.findFirst.mockResolvedValue(request);
    tx.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.leaveApplication.findFirst.mockResolvedValue(null);
    tx.leaveApplication.update.mockImplementation(async ({ data }) => ({
      id: "application-1",
      legacyLeaveRequestId: data.legacyLeaveRequestId,
    }));
    vi.mocked(createLeaveApplication).mockResolvedValue({
      id: "application-1",
      legacyLeaveRequestId: "request-1",
    } as never);
    vi.mocked(decideLeaveApplication).mockResolvedValue({ id: "application-1" } as never);
    vi.mocked(reconcileContinuityForEmployee).mockResolvedValue(undefined);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));
  });

  it("rejects the whole approval transaction when the v2 decision fails", async () => {
    vi.mocked(decideLeaveApplication).mockRejectedValue(
      new LeaveManagementError("A verified supporting document is required")
    );

    await expect(
      approveLeaveRequest("request-1", "company-1", "user-1", "admin")
    ).rejects.toBeInstanceOf(LeaveRequestError);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(createLeaveApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        legacyLeaveRequestId: "request-1",
        legacyFullDayCapture: true,
      }),
      { transaction: tx }
    );
    expect(decideLeaveApplication).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: "application-1", decision: "approve" }),
      { transaction: tx }
    );
    expect(tx.leaveRequest.updateMany).not.toHaveBeenCalled();
    expect(reconcileContinuityForEmployee).not.toHaveBeenCalled();
  });

  it("updates both representations in one rejection transaction", async () => {
    await rejectLeaveRequest("request-1", "company-1", "user-1", "admin");

    expect(decideLeaveApplication).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: "application-1", decision: "reject" }),
      { transaction: tx }
    );
    expect(tx.leaveRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "request-1", status: "pending" },
      data: {
        status: "rejected",
        reviewedBy: "user-1",
        reviewedAt: expect.any(Date),
      },
    });
    expect(reconcileContinuityForEmployee).toHaveBeenCalledWith(
      "employee-1",
      "company-1",
      "leave_rejected"
    );
    expect(vi.mocked(prisma.$transaction).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(reconcileContinuityForEmployee).mock.invocationCallOrder[0]!
    );
  });
});
