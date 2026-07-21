import { prisma } from "../lib/prisma.js";
import type { UserRole } from "@prisma/client";
import { reconcileContinuityForEmployee } from "../modules/rosters/roster-continuity.service.js";
import { createLeaveApplication, decideLeaveApplication, LeaveManagementError } from "./leave-management.service.js";

export class LeaveRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaveRequestError";
  }
}

export async function approveLeaveRequest(
  requestId: string,
  companyId: string,
  userId: string,
  userRole: UserRole
): Promise<void> {
  let employeeId: string;
  try {
    employeeId = await prisma.$transaction(async (tx) => {
      const req = await tx.leaveRequest.findFirst({
        where: { id: requestId, employee: { companyId } },
        include: { employee: true },
      });
      if (!req) throw new LeaveRequestError("Leave request not found");
      if (req.status !== "pending") {
        throw new LeaveRequestError(`Cannot approve: request is already ${req.status}`);
      }

      let application = await tx.leaveApplication.findFirst({
        where: { companyId, legacyLeaveRequestId: requestId },
      });
      if (!application) {
        application = await createLeaveApplication({
          companyId,
          employeeId: req.employeeId,
          leaveTypeCode: req.type,
          startDate: req.date.toISOString().slice(0, 10),
          requestedMinutesPerDay: Math.round(Number(req.hours) * 60),
          reason: req.reason ?? "Imported legacy leave request",
          retrospectiveReason: req.date < new Date()
            ? "Legacy request submitted before source-of-truth cutover"
            : undefined,
          idempotencyKey: `legacy-request:${requestId}`,
          source: "LEGACY_IMPORT",
          actorId: userId,
          legacyLeaveRequestId: requestId,
          legacyFullDayCapture: true,
        }, { transaction: tx });
        if (application.legacyLeaveRequestId !== requestId) {
          application = await tx.leaveApplication.update({
            where: { id: application.id },
            data: { legacyLeaveRequestId: requestId },
          });
        }
      }
      await decideLeaveApplication({
        companyId,
        applicationId: application.id,
        actorId: userId,
        actorRole: userRole,
        decision: "approve",
      }, { transaction: tx });
      const changed = await tx.leaveRequest.updateMany({
        where: { id: requestId, status: "pending" },
        data: { status: "approved", reviewedBy: userId, reviewedAt: new Date() },
      });
      if (changed.count !== 1) {
        throw new LeaveRequestError("Leave request changed during approval; refresh and try again");
      }
      return req.employeeId;
    }, { maxWait: 5_000, timeout: 30_000 });
  } catch (error) {
    if (error instanceof LeaveManagementError) throw new LeaveRequestError(error.message);
    throw error;
  }
  await reconcileContinuityForEmployee(employeeId, companyId, "leave_approved").catch(() => undefined);

  // Leave approved – notification removed (email module disabled)
}

export async function rejectLeaveRequest(
  requestId: string,
  companyId: string,
  userId: string,
  userRole: UserRole
): Promise<void> {
  let employeeId: string;
  try {
    employeeId = await prisma.$transaction(async (tx) => {
      const req = await tx.leaveRequest.findFirst({
        where: { id: requestId, employee: { companyId } },
        include: { employee: true },
      });
      if (!req) throw new LeaveRequestError("Leave request not found");
      if (req.status !== "pending") {
        throw new LeaveRequestError(`Cannot reject: request is already ${req.status}`);
      }

      let application = await tx.leaveApplication.findFirst({
        where: { companyId, legacyLeaveRequestId: requestId },
      });
      if (!application) {
        application = await createLeaveApplication({
          companyId,
          employeeId: req.employeeId,
          leaveTypeCode: req.type,
          startDate: req.date.toISOString().slice(0, 10),
          requestedMinutesPerDay: Math.round(Number(req.hours) * 60),
          reason: req.reason ?? "Imported legacy leave request",
          retrospectiveReason: req.date < new Date()
            ? "Legacy request submitted before source-of-truth cutover"
            : undefined,
          idempotencyKey: `legacy-request:${requestId}`,
          source: "LEGACY_IMPORT",
          actorId: userId,
          legacyLeaveRequestId: requestId,
          legacyFullDayCapture: true,
        }, { transaction: tx });
        if (application.legacyLeaveRequestId !== requestId) {
          application = await tx.leaveApplication.update({
            where: { id: application.id },
            data: { legacyLeaveRequestId: requestId },
          });
        }
      }
      await decideLeaveApplication({
        companyId,
        applicationId: application.id,
        actorId: userId,
        actorRole: userRole,
        decision: "reject",
        reason: "Rejected through legacy-compatible endpoint",
      }, { transaction: tx });
      const changed = await tx.leaveRequest.updateMany({
        where: { id: requestId, status: "pending" },
        data: { status: "rejected", reviewedBy: userId, reviewedAt: new Date() },
      });
      if (changed.count !== 1) {
        throw new LeaveRequestError("Leave request changed during rejection; refresh and try again");
      }
      return req.employeeId;
    }, { maxWait: 5_000, timeout: 30_000 });
  } catch (error) {
    if (error instanceof LeaveManagementError) throw new LeaveRequestError(error.message);
    throw error;
  }
  await reconcileContinuityForEmployee(employeeId, companyId, "leave_rejected").catch(() => undefined);

  // Leave rejected – notification removed (email module disabled)
}
