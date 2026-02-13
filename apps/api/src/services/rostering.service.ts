import { prisma } from "../lib/prisma.js";

export class RosteringValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosteringValidationError";
  }
}

export async function validateShiftAssignment(params: {
  companyId: string;
  employeeId: string;
  postId: string;
  startTime: Date;
  endTime: Date;
  excludeShiftId?: string;
}): Promise<void> {
  const { companyId, employeeId, postId, startTime, endTime, excludeShiftId } = params;

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
  });

  if (!employee) {
    throw new RosteringValidationError("Employee not found");
  }

  if (employee.status !== "active") {
    throw new RosteringValidationError(
      `Employee must be active to be assigned. Current status: ${employee.status}`
    );
  }

  const post = await prisma.post.findFirst({
    where: { id: postId },
    include: { site: true },
  });

  if (!post) {
    throw new RosteringValidationError("Post not found");
  }

  if (post.site.companyId !== companyId) {
    throw new RosteringValidationError("Post does not belong to company");
  }

  const overlapping = await prisma.shift.findFirst({
    where: {
      employeeId,
      id: excludeShiftId ? { not: excludeShiftId } : undefined,
      OR: [
        {
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      ],
    },
  });

  if (overlapping) {
    throw new RosteringValidationError(
      "Employee has an overlapping shift in this time range"
    );
  }
}
