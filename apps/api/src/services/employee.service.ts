import { prisma } from "../lib/prisma.js";
import { canTransitionEmployee } from "../lib/state-machines.js";
import type { EmployeeStatus } from "@prisma/client";

export class EmployeeServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmployeeServiceError";
  }
}

export async function transitionEmployeeStatus(
  employeeId: string,
  companyId: string,
  newStatus: EmployeeStatus
): Promise<{ success: boolean; error?: string }> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
  });

  if (!employee) {
    return { success: false, error: "Employee not found" };
  }

  if (!canTransitionEmployee(employee.status, newStatus)) {
    return {
      success: false,
      error: `Invalid transition from ${employee.status} to ${newStatus}`,
    };
  }

  const deactivatesAssignments = newStatus === "suspended" || newStatus === "offboarded";

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.employee.updateMany({
      where: { id: employeeId, companyId, status: employee.status },
      data: { status: newStatus },
    });
    if (result.count > 0 && deactivatesAssignments) {
      // A guard who is no longer active must not stay in any site's rosterable pool.
      await tx.siteAssignment.updateMany({
        where: { employeeId, isActive: true },
        data: { isActive: false },
      });
    }
    return result;
  });

  if (updated.count === 0) {
    return {
      success: false,
      error: "Employee status changed while this request was processed; refresh and try again",
    };
  }

  return { success: true };
}
