import { prisma } from "../lib/prisma.js";

export class LeaveRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaveRequestError";
  }
}

export async function approveLeaveRequest(
  requestId: string,
  companyId: string,
  userId: string
): Promise<void> {
  const req = await prisma.leaveRequest.findFirst({
    where: { id: requestId, employee: { companyId } },
    include: { employee: true },
  });

  if (!req) {
    throw new LeaveRequestError("Leave request not found");
  }

  if (req.status !== "pending") {
    throw new LeaveRequestError(`Cannot approve: request is already ${req.status}`);
  }

  const date = new Date(req.date);
  date.setHours(0, 0, 0, 0);

  await prisma.$transaction([
    prisma.leaveRecord.create({
      data: {
        employeeId: req.employeeId,
        date,
        type: req.type,
        hours: req.hours,
      },
    }),
    prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: "approved",
        reviewedBy: userId,
        reviewedAt: new Date(),
      },
    }),
  ]);

  // Leave approved – notification removed (email module disabled)
}

export async function rejectLeaveRequest(
  requestId: string,
  companyId: string,
  userId: string
): Promise<void> {
  const req = await prisma.leaveRequest.findFirst({
    where: { id: requestId, employee: { companyId } },
    include: { employee: true },
  });

  if (!req) {
    throw new LeaveRequestError("Leave request not found");
  }

  if (req.status !== "pending") {
    throw new LeaveRequestError(`Cannot reject: request is already ${req.status}`);
  }

  await prisma.leaveRequest.update({
    where: { id: requestId },
    data: {
      status: "rejected",
      reviewedBy: userId,
      reviewedAt: new Date(),
    },
  });

  // Leave rejected – notification removed (email module disabled)
}
